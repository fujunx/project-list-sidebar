import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/** Build a filesystem-safe identifier from a path's basename, for .code-workspace names. */
function slugify(s: string): string {
	return (
		s
			.replace(/\.code-workspace$/i, "")
			.replace(/[^a-zA-Z0-9\u4e00-\u9fa5\-_.]+/g, "_")
			.replace(/[_]+$/g, "") || "project"
	)
		.slice(0, 40)
		.replace(/[._]+$/g, "");
}

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

interface ProjectEntry {
	/** Absolute path to the folder or .code-workspace file. */
	path: string;
	/** Optional user-given nickname (二次命名). */
	name?: string;
	/** Pin to the top of the list. */
	priority?: boolean;
	/** Manual sort position (higher = further down). Persisted for drag-to-reorder. */
	order?: number;
	/** Timestamp (ms) when added, used as a stable secondary sort key. */
	addedAt?: number;
}

interface ProjectListFile {
	entries: ProjectEntry[];
}

interface ProjectListConfig {
	showOnStartup: boolean;
	preferNamedFirst: boolean;
	configPath: string;
}

// ---------------------------------------------------------------------------
// Store: reads/writes the JSON file, emits change events
// ---------------------------------------------------------------------------

class ProjectStore {
	private entries: ProjectEntry[] = [];
	private readonly fileUri: vscode.Uri;
	private readonly _onDidChangeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChange = this._onDidChangeEmitter.event;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.fileUri = vscode.Uri.file(this.resolveConfigPath());
		this.load();
	}

	private resolveConfigPath(): string {
		const cfg = vscode.workspace.getConfiguration("projectList");
		const raw = cfg.get<string>("configPath") || "~/.vscode-project-list.json";
		const home = os.homedir();
		const p = raw.startsWith("~/") ? path.join(home, raw.slice(2)) : raw;
		return path.isAbsolute(p) ? p : path.join(home, p);
	}

	private load(): void {
		this.entries = [];
		try {
			if (fs.existsSync(this.fileUri.fsPath)) {
				const text = fs.readFileSync(this.fileUri.fsPath, "utf-8");
				const data = JSON.parse(text) as ProjectListFile;
				if (Array.isArray(data.entries)) {
					this.entries = data.entries
						.map((e) => this.normalize(e))
						.filter((e): e is ProjectEntry => e !== null);
				}
			}
		} catch (err) {
			if (err instanceof SyntaxError) {
				void vscode.window.showWarningMessage(
					`项目列表配置文件格式错误：${this.fileUri.fsPath}\n${(err as Error).message}`
				);
			} else {
				void vscode.window.showWarningMessage(
					`无法读取项目列表配置：${(err as Error).message}`
				);
			}
		}
	}

	/**
	 * Re-read the config file from disk. Used by "refresh" so that changes made
	 * in OTHER windows (each window keeps its own in-memory copy) appear here.
	 */
	reload(): void {
		this.load();
	}

	private normalize(e: Partial<ProjectEntry>): ProjectEntry | null {
		if (!e || typeof e.path !== "string" || e.path.length === 0) {
			return null;
		}
		return {
			path: e.path,
			name: typeof e.name === "string" && e.name.trim().length > 0 ? e.name : undefined,
			priority: e.priority === true,
			order: typeof e.order === "number" ? e.order : undefined,
			addedAt: typeof e.addedAt === "number" ? e.addedAt : Date.now(),
		};
	}

	private save(): void {
		try {
			const dir = path.dirname(this.fileUri.fsPath);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}
			const data: ProjectListFile = { entries: this.entries };
			fs.writeFileSync(this.fileUri.fsPath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
		} catch (err) {
			void vscode.window.showErrorMessage(
				`保存项目列表失败：${(err as Error).message}`
			);
		}
	}

	private emit(): void {
		this._onDidChangeEmitter.fire();
	}

	getAll(): ProjectEntry[] {
		return [...this.entries];
	}

	get(filePath: string): ProjectEntry | undefined {
		return this.entries.find((e) => this.samePath(e.path, filePath));
	}

	get configFile(): vscode.Uri {
		return this.fileUri;
	}

	private samePath(a: unknown, b: unknown): boolean {
		if (typeof a !== "string" || typeof b !== "string") return false;
		return path.resolve(a) === path.resolve(b);
	}

	add(filePath: string, name?: string, priority?: boolean): void {
		const existing = this.get(filePath);
		if (existing) {
			existing.name = name ?? existing.name;
			if (priority !== undefined) existing.priority = priority;
			void vscode.window.showInformationMessage(`项目已在列表中：${this.label(existing)}`);
		} else {
			// New projects append to the bottom once a manual order exists; otherwise
			// they keep the default auto-sort (named-first / label) like before.
			this.entries.push({
				path: filePath,
				name,
				priority,
				order: this.nextOrder(),
				addedAt: Date.now(),
			});
		}
		this.save();
		this.emit();
	}

	/** Largest persisted `order` + 1, or undefined when no manual order exists yet. */
	private nextOrder(): number | undefined {
		let max = -1;
		let has = false;
		for (const e of this.entries) {
			if (typeof e.order === "number") {
				has = true;
				if (e.order > max) max = e.order;
			}
		}
		return has ? max + 1 : undefined;
	}

	/** Apply a new ordering (a full list of paths in the order the user dragged them). */
	applyOrder(paths: string[]): void {
		if (!Array.isArray(paths)) return;
		const indexOf = new Map<string, number>();
		paths.forEach((p, i) => {
			if (typeof p === "string") indexOf.set(p, i);
		});
		let changed = false;
		for (const e of this.entries) {
			const idx = indexOf.get(e.path);
			if (idx !== undefined && e.order !== idx) {
				e.order = idx;
				changed = true;
			}
		}
		if (changed) {
			this.save();
			this.emit();
		}
	}

	rename(filePath: string, name: string): void {
		const e = this.get(filePath);
		if (!e) return;
		// Delete the file created under the *current* (old) name before changing it.
		this.clearWorkspaceFile(e);
		e.name = name.trim().length > 0 ? name.trim() : undefined;
		this.save();
		this.emit();
	}

	clearName(filePath: string): void {
		this.rename(filePath, "");
	}

	togglePriority(filePath: string): void {
		const e = this.get(filePath);
		if (!e) return;
		e.priority = !e.priority;
		this.save();
		this.emit();
	}

	remove(filePath: string): void {
		const e = this.get(filePath);
		this.clearWorkspaceFile(e);
		this.entries = this.entries.filter((x) => !this.samePath(x.path, filePath));
		this.save();
		this.emit();
	}

	/** Display label: nickname if present, otherwise the basename. */
	label(e: ProjectEntry): string {
		if (e.name && e.name.trim().length > 0) return e.name.trim();
		const base = path.basename(e.path);
		return base.replace(/\.code-workspace$/i, "") || base;
	}

	/** Whether this entry carries a user nickname. */
	isNamed(e: ProjectEntry): boolean {
		return !!e.name && e.name.trim().length > 0;
	}

	isWorkspace(e: ProjectEntry): boolean {
		return e.path.toLowerCase().endsWith(".code-workspace");
	}

	// --- Named-workspace support: let the window title show the nickname ---
	// VS Code shows a folder's basename as the window title. To show an alias,
	// we open a generated `.code-workspace` whose `name` field = the nickname.

	/** Directory that holds generated `.code-workspace` files, next to the config. */
	private workspacesDir(): string {
		return path.join(path.dirname(this.fileUri.fsPath), "project-workspaces");
	}

	/** The generated `.code-workspace` URI for a named folder project, if any. */
	workspaceFileFor(e: ProjectEntry): vscode.Uri | undefined {
		if (!this.isNamed(e) || this.isWorkspace(e)) return undefined;
		const name = `${slugify(this.label(e))}.code-workspace`;
		return vscode.Uri.file(path.join(this.workspacesDir(), name));
	}

	/** (Re)write the `.code-workspace` file so its window title equals the nickname. */
	ensureWorkspaceFile(e: ProjectEntry): vscode.Uri {
		const wsUri = this.workspaceFileFor(e)!;
		const dir = path.dirname(wsUri.fsPath);
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
		const data = {
			// Absolute path keeps the workspace stable regardless of where we store it.
			folders: [{ path: e.path }],
			name: e.name,
			settings: {},
		};
		fs.writeFileSync(wsUri.fsPath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
		return wsUri;
	}

	/** Remove the cached `.code-workspace` file for a path (used on clearName/remove). */
	clearWorkspaceFile(e: ProjectEntry | undefined): void {
		if (!e) return;
		const wsUri = this.workspaceFileFor(e);
		if (wsUri && fs.existsSync(wsUri.fsPath)) {
			try {
				fs.unlinkSync(wsUri.fsPath);
			} catch {
				/* ignore */
			}
		}
	}

	/**
	 * True if changing a project to `rawName` would make its generated workspace file
	 * collide with another project's. We keep workspace filenames clean (no hash), so
	 * two named projects must not share the same slug. Empty names are allowed (they
	 * don't generate a workspace file).
	 */
	hasConflict(targetPath: string, rawName: string): boolean {
		const slug = slugify(rawName.trim());
		if (!slug) return false;
		return this.entries.some(
			(e) =>
				!this.samePath(e.path, targetPath) &&
				this.isNamed(e) &&
				!this.isWorkspace(e) &&
				slugify(this.label(e)) === slug
		);
	}
}

// ---------------------------------------------------------------------------
// Webview sidebar: project list.
// ---------------------------------------------------------------------------

function randomNonce(): string {
	return "n" + Math.random().toString(36).slice(2, 11);
}

interface ProjectViewData {
	path: string;
	label: string;
	description: string;
	priority: boolean;
	named: boolean;
	workspace: boolean;
}

class ProjectListWebviewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = "projectListProjects";
	private view: vscode.WebviewView | undefined;

	constructor(private readonly store: ProjectStore) {
		store.onDidChange(() => this.update());
	}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		view.webview.options = { enableScripts: true, localResourceRoots: [] };
		// 把当前列表直接写进 HTML：首次打开时，webview 一就绪就能立即渲染，
		// 不必等 extension → webview 的 state 往返，减少首屏等待。
		view.webview.html = this.buildHtml(this.computeProjects());
		view.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
		this.update();
	}

	refresh(): void {
		// 重新从磁盘读取，能拉到其他窗口新增/改动过的项目。
		this.store.reload();
		this.update();
	}

	private onMessage(msg: any): void {
		switch (msg?.type) {
			case "ready":
				this.update();
				break;
			case "open":
				void openAnyPath(this.store, msg.path);
				break;
			case "openNewWindow":
				void openAnyPath(this.store, msg.path, { forceNewWindow: true });
				break;
			case "addProject":
				void pickProjectsCommand(this.store)();
				break;
			case "refresh":
				this.refresh();
				break;
			case "reorder":
				this.store.applyOrder(msg.paths);
				break;
			case "openConfig":
				void vscode.commands.executeCommand("vscode.open", this.store.configFile);
				break;
			case "rename":
				void renameCommand(this.store)(msg.path);
				break;
			case "clearName":
				this.store.clearName(msg.path);
				break;
			case "togglePriority":
				this.store.togglePriority(msg.path);
				break;
			case "remove":
				void removeCommand(this.store)(msg.path);
				break;
			default:
				break;
		}
	}

	private computeProjects(): ProjectViewData[] {
		const cfg = vscode.workspace.getConfiguration("projectList");
		const preferNamed = cfg.get<boolean>("preferNamedFirst", true);

		return this.store
			.getAll()
			.slice()
			.sort((a, b) => {
				// Pinned (★) projects always stay grouped at the top.
				const pa = a.priority === true ? 1 : 0;
				const pb = b.priority === true ? 1 : 0;
				if (pa !== pb) return pb - pa;
				// Manual drag order; entries without one sort last (keeps legacy auto-sort).
				const oa = typeof a.order === "number" ? a.order : Number.MAX_SAFE_INTEGER;
				const ob = typeof b.order === "number" ? b.order : Number.MAX_SAFE_INTEGER;
				if (oa !== ob) return oa - ob;
				const na = this.store.isNamed(a) ? 1 : 0;
				const nb = this.store.isNamed(b) ? 1 : 0;
				if (preferNamed && na !== nb) return nb - na;
				return this.store.label(a).localeCompare(this.store.label(b), undefined, {
					sensitivity: "base",
				});
			})
			.map((e) => ({
				path: e.path,
				label: this.store.label(e),
				description: e.path,
				priority: e.priority === true,
				named: this.store.isNamed(e),
				workspace: this.store.isWorkspace(e),
			}));
	}

	private update(): void {
		if (!this.view) return;
		void this.view.webview.postMessage({ type: "state", projects: this.computeProjects() });
	}

	private buildHtml(initialProjects?: ProjectViewData[]): string {
		const nonce = randomNonce();
		const initialJson = JSON.stringify(initialProjects ?? []);
		const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:var(--vscode-sideBar-background);user-select:none}
.app{display:flex;flex-direction:column;height:100%}
.header{display:flex;align-items:center;gap:6px;flex:0 0 auto;padding:6px 8px;border-bottom:1px solid var(--vscode-panel-border)}
.search{flex:1 1 auto;min-width:0;height:32px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);border-radius:5px;padding:0 10px;font-size:13px;outline:none}
.search::placeholder{color:var(--vscode-input-placeholderForeground)}
.search:focus{border-color:var(--vscode-focusBorder)}
.tool{background:transparent;border:none;color:var(--vscode-foreground);cursor:pointer;width:22px;height:22px;border-radius:4px;font-size:15px;line-height:1;padding:0}
.tool:hover{background:var(--vscode-toolbar-hoverBackground)}
.content{flex:1 1 auto;overflow-y:auto;padding:2px 0}
.row{display:flex;align-items:center;gap:6px;padding:3px 8px;cursor:pointer}
.row:hover{background:var(--vscode-list-hoverBackground)}
.row.dragging{opacity:.4;background:var(--vscode-list-hoverBackground)}
.row-icon{width:16px;text-align:center;flex:0 0 auto;color:var(--vscode-descriptionForeground)}
.row-label{flex:1 1 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.row-desc{flex:0 0 auto;max-width:40%;color:var(--vscode-descriptionForeground);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.empty{padding:10px 8px;color:var(--vscode-descriptionForeground);font-size:12px;text-align:center}
.menu{position:fixed;z-index:10;min-width:150px;background:var(--vscode-menu-background);color:var(--vscode-foreground);border:1px solid var(--vscode-menu-border);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.35);padding:4px}
.menu-item{padding:6px 10px;font-size:13px;cursor:pointer;border-radius:4px;white-space:nowrap}
.menu-item:hover{background:var(--vscode-menu-selectionBackground);color:var(--vscode-menu-selectionForeground)}
.hidden{display:none}
</style>
</head>
<body>
<div class="app">
  <div class="header">
    <input class="search" id="search" type="text" placeholder="搜索项目…" spellcheck="false" />
  </div>
  <div class="content" id="content"></div>
</div>
<div class="menu hidden" id="menu"></div>
<script nonce="${nonce}">
(function(){
  var vscode = acquireVsCodeApi();
  var current = {projects: ${initialJson}};
  var filter = '';

  function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function projectIcon(p){return p.priority?'★':'📁';}
  function matches(p){
    if(!filter)return true;
    var q=filter.toLowerCase();
    return p.label.toLowerCase().indexOf(q)>=0 || p.description.toLowerCase().indexOf(q)>=0;
  }
  function rowHtml(p){
    return '<div class="row" draggable="true" data-path="'+esc(p.path)+'">'
      + '<span class="row-icon">'+projectIcon(p)+'</span>'
      + '<span class="row-label" title="'+esc(p.description)+'">'+esc(p.label)+'</span>'
      + '<span class="row-desc" title="'+esc(p.description)+'">'+esc(p.description)+'</span>'
      + '</div>';
  }

  function render(){
    var content=document.getElementById('content');
    var list=[];
    for(var i=0;i<current.projects.length;i++){if(matches(current.projects[i]))list.push(current.projects[i]);}
    if(list.length){
      var ph=''; for(var j=0;j<list.length;j++){ph+=rowHtml(list[j]);}
      content.innerHTML=ph;
    } else if(filter){
      content.innerHTML='<div class="empty">没有匹配的项目</div>';
    } else {
      content.innerHTML='<div class="empty">暂无项目 · 点右上角 ＋ 添加</div>';
    }
  }

  window.addEventListener('message',function(e){
    var d=e.data;
    if(d&&d.type==='state'){current=d;render();}
  });

  var menu=document.getElementById('menu');
  function hideMenu(){menu.classList.add('hidden');}
  function showMenu(x,y,path){
    var items=[
      {act:'togglePriority',label:'★ 收藏 / 取消收藏'},
      {act:'rename',label:'✎ 二次命名'},
      {act:'remove',label:'🗑 从列表移除'}
    ];
    var html='';
    for(var i=0;i<items.length;i++){html+='<div class="menu-item" data-act="'+items[i].act+'" data-path="'+esc(path)+'">'+items[i].label+'</div>';}
    menu.innerHTML=html;
    menu.classList.remove('hidden');
    menu.style.left=Math.min(x,window.innerWidth-menu.offsetWidth-4)+'px';
    menu.style.top=Math.min(y,window.innerHeight-menu.offsetHeight-4)+'px';
  }

  document.addEventListener('contextmenu',function(e){
    var r=e.target.closest('.row');
    if(!r)return;
    e.preventDefault();
    showMenu(e.clientX,e.clientY,r.dataset.path);
  });
  document.addEventListener('click',function(e){
    if(justDragged){justDragged=false;return;} // 拖拽结束后的一次 click 不当作打开
    var mi=e.target.closest('.menu-item');
    if(mi){vscode.postMessage({type:mi.dataset.act,path:mi.dataset.path});hideMenu();return;}
    if(!menu.classList.contains('hidden')){hideMenu();return;}
    var r=e.target.closest('.row');
    if(r){vscode.postMessage({type:'open',path:r.dataset.path});}
  });
  document.addEventListener('mousedown',function(e){
    // 鼠标中键：在新的窗口打开项目
    if(e.button!==1)return;
    var r=e.target.closest('.row');
    if(r){e.preventDefault();e.stopPropagation();vscode.postMessage({type:'openNewWindow',path:r.dataset.path});}
  });
  document.addEventListener('auxclick',function(e){
    // 某些版本 Electron 里中键不触发 auxclick，仅作为冗余兜底；mousedown 才是主入口
    if(e.button!==1)return;
    var r=e.target.closest('.row');
    if(r){e.preventDefault();vscode.postMessage({type:'openNewWindow',path:r.dataset.path});}
  });
  document.addEventListener('keydown',function(e){if(e.key==='Escape'){hideMenu();}});

  var search=document.getElementById('search');
  search.addEventListener('input',function(){filter=search.value;render();});

  // ---- 拖拽排序 ----
  var draggingPath=null;
  var draggingEl=null;
  var justDragged=false;
  function rowPaths(){
    var rows=document.querySelectorAll('#content .row');
    var arr=[];
    for(var i=0;i<rows.length;i++){arr.push(rows[i].getAttribute('data-path'));}
    return arr;
  }
  document.addEventListener('dragstart',function(e){
    if(filter)return; // 过滤显示时禁止拖拽，避免误排序
    var r=e.target.closest('.row');
    if(!r)return;
    draggingPath=r.getAttribute('data-path');
    draggingEl=r;
    e.dataTransfer.effectAllowed='move';
    try{e.dataTransfer.setData('text/plain',draggingPath);}catch(_){}
    r.classList.add('dragging');
  });
  document.addEventListener('dragover',function(e){
    if(!draggingEl)return;
    e.preventDefault();
    e.dataTransfer.dropEffect='move';
    var row=e.target.closest('.row');
    if(!row||row===draggingEl)return;
    var rect=row.getBoundingClientRect();
    var after=e.clientY>rect.top+rect.height/2;
    if(after){
      if(row.nextSibling!==draggingEl){row.parentNode.insertBefore(draggingEl,row.nextSibling);}
    }else{
      row.parentNode.insertBefore(draggingEl,row);
    }
  });
  document.addEventListener('dragend',function(e){
    if(draggingEl){draggingEl.classList.remove('dragging');}
    if(draggingPath){
      vscode.postMessage({type:'reorder',paths:rowPaths()});
      justDragged=true;
      setTimeout(function(){justDragged=false;},300);
    }
    draggingEl=null;draggingPath=null;
  });

  // 用内嵌的初始数据立即渲染首屏，避免等 state 往返；后续由 state 消息刷新。
  render();
  vscode.postMessage({type:'ready'});
})();
</script>
</body>
</html>`;
		return html;
	}
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function currentWorkspacePaths(): string[] {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders || folders.length === 0) return [];
	return folders.map((f) => f.uri.fsPath);
}

/**
 * Resolve a project path from whatever the command was handed: a path string,
 * or an object carrying a `path` / `entry.path`. (Commands are triggered from the
 * webview with explicit paths, or from the palette with none.)
 */
function pathFromArg(arg: unknown): string | undefined {
	if (typeof arg === "string") {
		return arg.length > 0 ? arg : undefined;
	}
	if (arg && typeof arg === "object") {
		const obj = arg as { entry?: { path?: unknown }; path?: unknown };
		const entryPath = obj.entry?.path;
		if (typeof entryPath === "string" && entryPath.length > 0) return entryPath;
		if (typeof obj.path === "string" && obj.path.length > 0) return obj.path;
	}
	return undefined;
}

/**
 * Open a folder or `.code-workspace` by absolute path. If the path is a saved project
 * with a nickname, it is opened via a generated workspace so the window title shows the
 * alias.
 */
async function openAnyPath(
	store: ProjectStore,
	filePath: string,
	options?: { forceNewWindow?: boolean }
): Promise<void> {
	if (typeof filePath !== "string" || filePath.length === 0) return;

	if (!fs.existsSync(filePath)) {
		const e = store.get(filePath);
		const opts: vscode.MessageOptions = { modal: true };
		const choice = e
			? await vscode.window.showWarningMessage(`路径不存在：${filePath}`, opts, "从列表移除")
			: await vscode.window.showWarningMessage(`路径不存在：${filePath}`, opts);
		if (choice === "从列表移除") store.remove(filePath);
		return;
	}

	const e = store.get(filePath);
	// A `.code-workspace` controls its own window title via its `name` field, so open it
	// directly. Otherwise, if a nickname is set, open a generated workspace whose `name`
	// = nickname so the window title shows the alias.
	const isWs = filePath.toLowerCase().endsWith(".code-workspace");
	const target = isWs
		? vscode.Uri.file(filePath)
		: e && store.isNamed(e)
			? store.ensureWorkspaceFile(e)
			: vscode.Uri.file(filePath);
	await vscode.commands.executeCommand("vscode.openFolder", target, options ?? {});
}

function openProjectCommand(store: ProjectStore, options?: { forceNewWindow?: boolean }) {
	return async (arg?: unknown) => {
		const filePath = pathFromArg(arg);
		if (!filePath) {
			void vscode.window.showWarningMessage("请先在项目列表中选中一个项目。");
			return;
		}
		const e = store.get(filePath);
		if (!e) {
			void vscode.window.showWarningMessage("该项目已不在列表中。");
			return;
		}
		await openAnyPath(store, e.path, options);
	};
}

function addCurrentCommand(store: ProjectStore) {
	return async () => {
		const paths = currentWorkspacePaths();
		if (paths.length === 0) {
			void vscode.window.showWarningMessage(
				"当前未打开任何文件夹。请先打开一个项目，再把它加入项目列表。"
			);
			return;
		}
		for (const p of paths) {
			store.add(p);
		}
		void vscode.window.showInformationMessage(
			`已添加 ${paths.length} 个项目到列表。`
		);
	};
}

function pickProjectsCommand(store: ProjectStore) {
	return async () => {
		const pick = await vscode.window.showQuickPick(
			[
				{ label: "$(file-directory-create) 从磁盘选择目录 / 工作区…", id: "pick" },
				{ label: "$(add) 添加当前打开的项目", id: "current" },
			],
			{ title: "添加项目到列表", placeHolder: "选择添加方式" }
		);
		if (!pick) return;
		if (pick.id === "current") {
			return addCurrentCommand(store)();
		}
		const result = await vscode.window.showOpenDialog({
			canSelectFolders: true,
			canSelectFiles: true,
			canSelectMany: true,
			openLabel: "选择",
			title: "选择项目目录，或 .code-workspace 工作区文件",
		});
		if (!result || result.length === 0) return;
		for (const uri of result) store.add(uri.fsPath);
		void vscode.window.showInformationMessage(`已添加 ${result.length} 个项目到列表。`);
	};
}

function renameCommand(store: ProjectStore) {
	return async (arg?: unknown) => {
		const filePath = pathFromArg(arg);
		if (!filePath) {
			void vscode.window.showWarningMessage("请先在项目列表中选中一个项目。");
			return;
		}
		const e = store.get(filePath);
		if (!e) return;

		// Loop so the user can immediately correct a name that's already in use
		// (duplicate workspace names would collide on disk since we removed the hash).
		for (;;) {
			const value = await vscode.window.showInputBox({
				title: "项目二次命名",
				prompt: `为「${store.label(e)}」设置一个显示名称（留空则使用文件夹名）`,
				value: e.name ?? "",
				placeHolder: "例如：我的后端服务",
			});
			if (value === undefined) return; // cancelled
			if (value.trim() === "") {
				// Clearing the name never conflicts (no workspace file is generated).
				store.rename(filePath, "");
				return;
			}
			if (store.hasConflict(filePath, value)) {
				void vscode.window.showWarningMessage(
					`名称「${value}」已被其他项目使用，请换一个名称（相同名称会导致工作区文件重名）。`
				);
				continue;
			}
			store.rename(filePath, value);
			return;
		}
	};
}

function clearNameCommand(store: ProjectStore) {
	return async (arg?: unknown) => {
		const filePath = pathFromArg(arg);
		if (!filePath) return;
		store.clearName(filePath);
	};
}

function togglePriorityCommand(store: ProjectStore) {
	return async (arg?: unknown) => {
		const filePath = pathFromArg(arg);
		if (!filePath) return;
		store.togglePriority(filePath);
	};
}

function removeCommand(store: ProjectStore) {
	return async (arg?: unknown) => {
		const filePath = pathFromArg(arg);
		if (!filePath) {
			void vscode.window.showWarningMessage("请先在项目列表中选中一个项目。");
			return;
		}
		const e = store.get(filePath);
		if (!e) return;
		const answer = await vscode.window.showWarningMessage(
			`确定从项目列表移除「${store.label(e)}」吗？`,
			{ modal: true },
			"移除"
		);
		if (answer === "移除") store.remove(filePath);
	};
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
	const store = new ProjectStore(context);
	const provider = new ProjectListWebviewProvider(store);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ProjectListWebviewProvider.viewType, provider, {
			webviewOptions: { retainContextWhenHidden: true },
		})
	);

	const cmds = {
		"projectList.refresh": () => provider.refresh(),
		"projectList.addCurrent": addCurrentCommand(store),
		"projectList.addProject": pickProjectsCommand(store),
		"projectList.openConfig": () =>
			vscode.commands.executeCommand("vscode.open", store.configFile),
		"projectList.open": openProjectCommand(store),
		"projectList.openNewWindow": openProjectCommand(store, { forceNewWindow: true }),
		"projectList.rename": renameCommand(store),
		"projectList.clearName": clearNameCommand(store),
		"projectList.togglePriority": togglePriorityCommand(store),
		"projectList.remove": removeCommand(store),
		"projectList.reveal": () => revealProjectList(),
	};

	for (const [id, fn] of Object.entries(cmds)) {
		context.subscriptions.push(vscode.commands.registerCommand(id, fn));
	}

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((c) => {
			if (c.affectsConfiguration("projectList.configPath")) {
				void vscode.window.showInformationMessage(
					"项目列表配置文件路径已变更，将重新加载。"
				);
				// Re-create the store is complex; prompt the user to reload the window.
				void vscode.window.showInformationMessage(
					"请重新加载窗口（命令面板 > Reload Window）以生效。"
				);
			}
		})
	);

	// Reveal the sidebar on startup ONLY when the window opened with no project/workspace
	// (the launcher scenario). When a project is opened — by double-clicking an entry,
	// `code <folder>`, or workspace restore — there ARE workspace folders, so we must NOT
	// hijack the view. Otherwise opening a project would re-open the project list.
	const cfg = vscode.workspace.getConfiguration("projectList");
	const showOnStartup = cfg.get<boolean>("showOnStartup", true);
	const noFolderOpen =
		!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0;
	if (showOnStartup && noFolderOpen) {
		revealProjectList();
	}
}

function revealProjectList(): void {
	void vscode.commands.executeCommand("workbench.view.extension.projectList");
	// Wait a moment for the container to appear, then focus the tree.
	setTimeout(() => {
		void vscode.commands.executeCommand("projectListProjects.focus");
	}, 200);
}

export function deactivate(): void {
	// Nothing to clean up beyond the disposables registered in activate().
}
