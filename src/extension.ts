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
	/** Optional user-given nickname (重命名). */
	name?: string;
	/** Pin to the top of the list. */
	priority?: boolean;
	/** Manual sort position (higher = further down). Persisted for drag-to-reorder. */
	order?: number;
	/** Timestamp (ms) when added; the default order is "添加时的先后". */
	addedAt?: number;
	/** Id of the owning collection (合集); undefined = top level. */
	collectionId?: string;
}

/** A folder-like group that can hold projects and other collections (嵌套合集). */
interface CollectionEntry {
	/** Stable unique id, referenced by projects and child collections. */
	id: string;
	/** Display name. */
	name: string;
	/** Parent collection id; undefined = top level. */
	parentId?: string;
	/** Manual position among siblings. */
	order?: number;
}

interface ProjectListFile {
	entries: ProjectEntry[];
	collections?: CollectionEntry[];
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
	private collections: CollectionEntry[] = [];
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
		this.collections = [];
		try {
			if (fs.existsSync(this.fileUri.fsPath)) {
				const text = fs.readFileSync(this.fileUri.fsPath, "utf-8");
				const data = JSON.parse(text) as ProjectListFile;
				if (Array.isArray(data.entries)) {
					this.entries = data.entries
						.map((e) => this.normalize(e))
						.filter((e): e is ProjectEntry => e !== null);
				}
				if (Array.isArray(data.collections)) {
					this.collections = data.collections
						.map((c) => this.normalizeCollection(c))
						.filter((c): c is CollectionEntry => c !== null);
				}
				this.repairCollections();
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
		const addedAt = typeof e.addedAt === "number" ? e.addedAt : Date.now();
		return {
			path: e.path,
			name: typeof e.name === "string" && e.name.trim().length > 0 ? e.name : undefined,
			priority: e.priority === true,
			order: typeof e.order === "number" ? e.order : undefined,
			addedAt,
			collectionId:
				typeof e.collectionId === "string" && e.collectionId.length > 0
					? e.collectionId
					: undefined,
		};
	}

	private normalizeCollection(c: Partial<CollectionEntry>): CollectionEntry | null {
		if (!c || typeof c.id !== "string" || c.id.length === 0) return null;
		if (typeof c.name !== "string" || c.name.trim().length === 0) return null;
		return {
			id: c.id,
			name: c.name.trim(),
			parentId:
				typeof c.parentId === "string" && c.parentId.length > 0 ? c.parentId : undefined,
			order: typeof c.order === "number" ? c.order : undefined,
		};
	}

	/**
	 * Make hand-edited config files safe: drop duplicated ids, reparent collections
	 * whose parent no longer exists, break cycles, and unassign projects that point
	 * at a missing collection.
	 */
	private repairCollections(): void {
		const seen = new Set<string>();
		this.collections = this.collections.filter((c) => {
			if (seen.has(c.id)) return false;
			seen.add(c.id);
			return true;
		});
		const byId = new Map(this.collections.map((c) => [c.id, c]));
		for (const c of this.collections) {
			if (c.parentId && !byId.has(c.parentId)) c.parentId = undefined;
		}
		// Break cycles: walking up from any node must terminate at a root.
		for (const c of this.collections) {
			const chain = new Set<string>([c.id]);
			let cur = c.parentId;
			while (cur) {
				if (chain.has(cur)) {
					c.parentId = undefined;
					break;
				}
				chain.add(cur);
				cur = byId.get(cur)?.parentId;
			}
		}
		for (const e of this.entries) {
			if (e.collectionId && !byId.has(e.collectionId)) e.collectionId = undefined;
		}
	}

	private save(): void {
		try {
			const dir = path.dirname(this.fileUri.fsPath);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}
			const data: ProjectListFile = { entries: this.entries };
			if (this.collections.length > 0) data.collections = this.collections;
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

	getCollections(): CollectionEntry[] {
		return this.collections.map((c) => ({ ...c }));
	}

	getCollection(id: string): CollectionEntry | undefined {
		return this.collections.find((c) => c.id === id);
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
	applyOrder(collectionId: string | undefined, paths: string[]): void {
		if (!Array.isArray(paths)) return;
		const indexOf = new Map<string, number>();
		paths.forEach((p, i) => {
			if (typeof p === "string") indexOf.set(p, i);
		});
		let changed = false;
		for (const e of this.entries) {
			if ((e.collectionId ?? undefined) !== (collectionId ?? undefined)) continue;
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

	/** Apply a new ordering to the collections directly under `parentId`. */
	applyCollectionOrder(parentId: string | undefined, ids: string[]): void {
		if (!Array.isArray(ids)) return;
		const indexOf = new Map<string, number>();
		ids.forEach((id, i) => {
			if (typeof id === "string") indexOf.set(id, i);
		});
		let changed = false;
		for (const c of this.collections) {
			if ((c.parentId ?? undefined) !== (parentId ?? undefined)) continue;
			const idx = indexOf.get(c.id);
			if (idx !== undefined && c.order !== idx) {
				c.order = idx;
				changed = true;
			}
		}
		if (changed) {
			this.save();
			this.emit();
		}
	}

	// --- 合集（collections） --------------------------------------------------

	private newCollectionId(): string {
		let id: string;
		do {
			id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
		} while (this.collections.some((c) => c.id === id));
		return id;
	}

	private nextCollectionOrder(): number {
		let max = -1;
		for (const c of this.collections) {
			if (typeof c.order === "number" && c.order > max) max = c.order;
		}
		return max + 1;
	}

	/** True when `candidateId` is `ancestorId` itself or one of its descendants. */
	private isSelfOrDescendant(candidateId: string, ancestorId: string): boolean {
		let cur: string | undefined = candidateId;
		const guard = new Set<string>();
		while (cur) {
			if (cur === ancestorId) return true;
			if (guard.has(cur)) return false;
			guard.add(cur);
			cur = this.getCollection(cur)?.parentId;
		}
		return false;
	}

	addCollection(name: string, parentId?: string): CollectionEntry | undefined {
		const trimmed = name.trim();
		if (!trimmed) return undefined;
		if (parentId && !this.getCollection(parentId)) parentId = undefined;
		const entry: CollectionEntry = {
			id: this.newCollectionId(),
			name: trimmed,
			parentId,
			order: this.nextCollectionOrder(),
		};
		this.collections.push(entry);
		this.save();
		this.emit();
		return entry;
	}

	renameCollection(id: string, name: string): void {
		const c = this.getCollection(id);
		if (!c) return;
		const trimmed = name.trim();
		if (!trimmed) return;
		c.name = trimmed;
		this.save();
		this.emit();
	}

	/**
	 * Delete a collection together with its sub-collections. Projects are never
	 * deleted: they (and any nested projects) move up to the deleted collection's
	 * parent, so nothing is lost.
	 */
	removeCollection(id: string): void {
		const target = this.getCollection(id);
		if (!target) return;
		const doomed = new Set<string>([id]);
		let grew = true;
		while (grew) {
			grew = false;
			for (const c of this.collections) {
				if (c.parentId && doomed.has(c.parentId) && !doomed.has(c.id)) {
					doomed.add(c.id);
					grew = true;
				}
			}
		}
		for (const e of this.entries) {
			if (e.collectionId && doomed.has(e.collectionId)) {
				e.collectionId = target.parentId;
			}
		}
		this.collections = this.collections.filter((c) => !doomed.has(c.id));
		this.save();
		this.emit();
	}

	/** Move a collection under a new parent. Cycles are rejected. */
	moveCollection(id: string, parentId: string | undefined): void {
		const c = this.getCollection(id);
		if (!c) return;
		if (parentId) {
			if (!this.getCollection(parentId)) return;
			if (this.isSelfOrDescendant(parentId, id)) return; // would create a cycle
		}
		if ((c.parentId ?? undefined) === (parentId ?? undefined)) return;
		c.parentId = parentId;
		c.order = this.nextCollectionOrder();
		this.save();
		this.emit();
	}

	/** Move a project into a collection (undefined = top level). */
	moveProject(filePath: string, collectionId: string | undefined): void {
		const e = this.get(filePath);
		if (!e) return;
		if (collectionId && !this.getCollection(collectionId)) return;
		if ((e.collectionId ?? undefined) === (collectionId ?? undefined)) return;
		e.collectionId = collectionId;
		e.order = this.nextOrder();
		this.save();
		this.emit();
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

/** A node in the sidebar tree: either a collection (folder) or a project. */
interface CollectionNode {
	kind: "collection";
	id: string;
	name: string;
	parentId: string | null;
	depth: number;
	childCount: number;
}

interface ProjectNode {
	kind: "project";
	path: string;
	label: string;
	description: string;
	/** Collection breadcrumb (e.g. "银医通 / 门诊"), empty at top level. */
	trail: string;
	priority: boolean;
	parentId: string | null;
	depth: number;
}

type TreeNodes = CollectionNode | ProjectNode;

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
		view.webview.html = this.buildHtml(this.computeTree());
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
				this.store.applyOrder(optId(msg.parentId), msg.paths);
				break;
			case "reorderCollections":
				this.store.applyCollectionOrder(optId(msg.parentId), msg.ids);
				break;
			// 拖拽落点：直接归类/嵌套，不再弹选择框
			case "dropIntoCollection":
				this.store.moveProject(msg.path, optId(msg.collectionId));
				break;
			case "dropCollectionInto":
				this.store.moveCollection(msg.id, optId(msg.parentId));
				break;
			case "newCollection":
				void newCollectionCommand(this.store, optId(msg.parentId))();
				break;
			case "renameCollection":
				void renameCollectionCommand(this.store)(msg.id);
				break;
			case "removeCollection":
				void removeCollectionCommand(this.store)(msg.id);
				break;
			case "moveToCollection":
				void moveToCollectionCommand(this.store)(msg.path);
				break;
			case "moveCollectionTo":
				void moveCollectionCommand(this.store)(msg.id);
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

	/**
	 * Flatten the project/collection tree into a pre-ordered, depth-tagged node list.
	 * Sorting is applied to each container (top level or a collection) independently:
	 * 收藏的排一组、拖拽过的按拖拽位置、其余保持添加时的先后。
	 */
	private computeTree(): TreeNodes[] {
		const cfg = vscode.workspace.getConfiguration("projectList");
		const preferNamed = cfg.get<boolean>("preferNamedFirst", true);
		const label = (e: ProjectEntry) => this.store.label(e);
		const orderOf = (v: number | undefined) =>
			typeof v === "number" ? v : Number.MAX_SAFE_INTEGER;
		const addedAtOf = (v: number | undefined) =>
			typeof v === "number" ? v : Number.MAX_SAFE_INTEGER;

		const entries = this.store.getAll();
		const collections = this.store.getCollections();

		const collectionsIn = (parentId: string | undefined) =>
			collections
				.filter((c) => (c.parentId ?? undefined) === parentId)
				.sort((a, b) => {
					// 未拖拽过的合集保持配置文件里的先后（sort 是稳定排序）。
					return orderOf(a.order) - orderOf(b.order);
				});

		const projectsIn = (parentId: string | undefined) =>
			entries
				.filter((e) => (e.collectionId ?? undefined) === parentId)
				.sort((a, b) => {
					// Pinned (★) projects always stay grouped at the top.
					const pa = a.priority === true ? 1 : 0;
					const pb = b.priority === true ? 1 : 0;
					if (pa !== pb) return pb - pa;
					// 拖拽过的按拖拽位置；都没拖过时按添加先后来。
					const oa = orderOf(a.order);
					const ob = orderOf(b.order);
					if (oa !== ob) return oa - ob;
					const aa = addedAtOf(a.addedAt);
					const ab = addedAtOf(b.addedAt);
					if (aa !== ab) return aa - ab;
					const na = this.store.isNamed(a) ? 1 : 0;
					const nb = this.store.isNamed(b) ? 1 : 0;
					if (preferNamed && na !== nb) return nb - na;
					return label(a).localeCompare(label(b), undefined, { sensitivity: "base" });
				});

		const nodes: TreeNodes[] = [];
		const walk = (
			parentId: string | undefined,
			depth: number,
			trail: string,
			ancestors: Set<string>
		): void => {
			if (depth > 20) return;
			for (const c of collectionsIn(parentId)) {
				if (ancestors.has(c.id)) continue;
				nodes.push({
					kind: "collection",
					id: c.id,
					name: c.name,
					parentId: parentId ?? null,
					depth,
					childCount: collectionsIn(c.id).length + projectsIn(c.id).length,
				});
				walk(c.id, depth + 1, trail ? `${trail} / ${c.name}` : c.name, new Set(ancestors).add(c.id));
			}
			for (const p of projectsIn(parentId)) {
				nodes.push({
					kind: "project",
					path: p.path,
					label: label(p),
					description: p.path,
					trail,
					priority: p.priority === true,
					parentId: parentId ?? null,
					depth,
				});
			}
		};
		walk(undefined, 0, "", new Set());

		return nodes;
	}

	private update(): void {
		if (!this.view) return;
		void this.view.webview.postMessage({ type: "state", nodes: this.computeTree() });
	}

	private buildHtml(initial?: TreeNodes[]): string {
		const nonce = randomNonce();
		const initialJson = JSON.stringify(initial ?? []);
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
.row.drop-into{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}
.row.coll .row-label{font-weight:600}
.twisty{flex:0 0 auto;width:12px;text-align:center;color:var(--vscode-descriptionForeground);font-size:10px}
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
  var nodes = ${initialJson};
  if(!nodes) nodes = [];
  var saved = vscode.getState() || {};
  var collapsed = saved.collapsed || {};
  var filter = '';
  var parentOf = {};

  function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

  function persist(){vscode.setState({collapsed:collapsed});}
  function indexParents(){
    parentOf = {};
    for(var i=0;i<nodes.length;i++){
      var n=nodes[i];
      if(n.kind==='collection') parentOf[n.id]=n.parentId;
    }
  }
  function visible(n){
    var p=n.parentId, hops=0;
    while(p){
      if(collapsed[p]) return false;
      if(++hops>64) return true; // 防御：数据异常成环时不至于卡死
      p=parentOf[p];
    }
    return true;
  }

  function nodeHtml(n){
    var pad = 8 + n.depth*14;
    var style = ' style="padding-left:'+pad+'px"';
    if(n.kind==='collection'){
      var shut = !!collapsed[n.id];
      return '<div class="row coll" data-kind="collection" data-id="'+esc(n.id)+'" data-parent="'+esc(n.parentId||'')+'" draggable="true"'+style+'>'
        + '<span class="twisty">'+(shut?'▸':'▾')+'</span>'
        + '<span class="row-icon">'+(shut?'📁':'📂')+'</span>'
        + '<span class="row-label" title="'+esc(n.name)+'">'+esc(n.name)+'</span>'
        + (shut?'<span class="row-desc">'+n.childCount+'</span>':'')
        + '</div>';
    }
    return '<div class="row" data-kind="project" data-path="'+esc(n.path)+'" data-parent="'+esc(n.parentId||'')+'" data-priority="'+(n.priority?'1':'0')+'" draggable="true"'+style+'>'
      + '<span class="twisty"></span>'
      + '<span class="row-icon">'+(n.priority?'★':'📁')+'</span>'
      + '<span class="row-label" title="'+esc(n.description)+'">'+esc(n.label)+'</span>'
      + '<span class="row-desc" title="'+esc(n.description)+'">'+esc(n.description)+'</span>'
      + '</div>';
  }

  function render(){
    var content=document.getElementById('content');
    var html='';
    if(filter){
      var q=filter.toLowerCase();
      for(var i=0;i<nodes.length;i++){
        var n=nodes[i];
        if(n.kind!=='project')continue;
        var hay=(n.label+' '+n.description+' '+(n.trail||'')).toLowerCase();
        if(hay.indexOf(q)<0)continue;
        html+=nodeHtml({kind:'project',path:n.path,label:n.label,description:n.description,
          priority:n.priority,parentId:null,depth:0});
      }
      content.innerHTML=html||'<div class="empty">没有匹配的项目</div>';
      return;
    }
    indexParents();
    for(var j=0;j<nodes.length;j++){
      var m=nodes[j];
      if(visible(m)) html+=nodeHtml(m);
    }
    content.innerHTML=html||'<div class="empty">暂无项目 · 点右上角 ＋ 添加</div>';
  }

  window.addEventListener('message',function(e){
    var d=e.data;
    if(d&&d.type==='state'){
      nodes=d.nodes||[];
      render();
    }
  });

  var menu=document.getElementById('menu');
  function hideMenu(){menu.classList.add('hidden');}
  function itemsHtml(items,ds){
    var attr = ds.id!==undefined ? ' data-id="'+esc(ds.id)+'"' : ' data-path="'+esc(ds.path)+'"';
    var html='';
    for(var i=0;i<items.length;i++){html+='<div class="menu-item" data-act="'+items[i].act+'"'+attr+'>'+items[i].label+'</div>';}
    return html;
  }
  function showMenu(x,y,row){
    if(row.dataset.kind==='collection'){
      menu.innerHTML=itemsHtml([
        {act:'newCollection',label:'＋ 新建子合集'},
        {act:'renameCollection',label:'✎ 重命名合集'},
        {act:'moveCollectionTo',label:'↪ 移动到合集…'},
        {act:'removeCollection',label:'🗑 删除合集'}
      ],{id:row.dataset.id});
    } else {
      var fav = row.dataset.priority==='1';
      menu.innerHTML=itemsHtml([
        {act:'rename',label:'✎ 重命名'},
        {act:'togglePriority',label:fav?'☆ 取消收藏':'★ 收藏'},
        {act:'moveToCollection',label:'↪ 移动到合集…'},
        {act:'remove',label:'🗑 从列表移除'}
      ],{path:row.dataset.path});
    }
    menu.classList.remove('hidden');
    menu.style.left=Math.min(x,window.innerWidth-menu.offsetWidth-4)+'px';
    menu.style.top=Math.min(y,window.innerHeight-menu.offsetHeight-4)+'px';
  }
  function onMenuClick(mi){
    var act=mi.dataset.act;
    if(act==='newCollection') vscode.postMessage({type:'newCollection',parentId:mi.dataset.id});
    else if(act==='renameCollection'||act==='removeCollection') vscode.postMessage({type:act,id:mi.dataset.id});
    else if(act==='moveCollectionTo') vscode.postMessage({type:'moveCollectionTo',id:mi.dataset.id});
    else vscode.postMessage({type:act,path:mi.dataset.path});
  }

  document.addEventListener('contextmenu',function(e){
    var r=e.target.closest('.row');
    if(!r)return;
    e.preventDefault();
    showMenu(e.clientX,e.clientY,r);
  });
  document.addEventListener('click',function(e){
    if(justDragged){justDragged=false;return;} // 拖拽结束后的一次 click 不当作打开
    var mi=e.target.closest('.menu-item');
    if(mi){onMenuClick(mi);hideMenu();return;}
    if(!menu.classList.contains('hidden')){hideMenu();return;}
    var r=e.target.closest('.row');
    if(!r)return;
    if(r.dataset.kind==='collection'){
      collapsed[r.dataset.id]=!collapsed[r.dataset.id];
      persist();render();
      return;
    }
    vscode.postMessage({type:'open',path:r.dataset.path});
  });
  document.addEventListener('mousedown',function(e){
    // 鼠标中键：在新的窗口打开项目
    if(e.button!==1)return;
    var r=e.target.closest('.row');
    if(r&&r.dataset.kind!=='collection'){e.preventDefault();e.stopPropagation();vscode.postMessage({type:'openNewWindow',path:r.dataset.path});}
  });
  document.addEventListener('auxclick',function(e){
    // 某些版本 Electron 里中键不触发 auxclick，仅作为冗余兜底；mousedown 才是主入口
    if(e.button!==1)return;
    var r=e.target.closest('.row');
    if(r&&r.dataset.kind!=='collection'){e.preventDefault();vscode.postMessage({type:'openNewWindow',path:r.dataset.path});}
  });
  document.addEventListener('keydown',function(e){if(e.key==='Escape'){hideMenu();}});

  var search=document.getElementById('search');
  search.addEventListener('input',function(){filter=search.value;render();});

  // ---- 拖拽：同级排序，或拖到合集上移入该合集 ----
  var draggingEl=null, dragKind=null, dragParent='', dropIntoRow=null, dropIntoSiblingParent=null;
  var justDragged=false;
  function clearHints(){
    var els=document.querySelectorAll('.row.drop-into');
    for(var i=0;i<els.length;i++){els[i].classList.remove('drop-into');}
  }
  function siblingPaths(parent){
    var rows=document.querySelectorAll('#content .row[data-kind="project"]');
    var arr=[];
    for(var i=0;i<rows.length;i++){if((rows[i].dataset.parent||'')===parent)arr.push(rows[i].dataset.path);}
    return arr;
  }
  function siblingIds(parent){
    var rows=document.querySelectorAll('#content .row[data-kind="collection"]');
    var arr=[];
    for(var i=0;i<rows.length;i++){if((rows[i].dataset.parent||'')===parent)arr.push(rows[i].dataset.id);}
    return arr;
  }
  document.addEventListener('dragstart',function(e){
    if(filter)return; // 过滤显示时禁止拖拽，避免误排序
    var r=e.target.closest('.row');
    if(!r)return;
    draggingEl=r;
    dragKind=r.dataset.kind;
    dragParent=r.dataset.parent||'';
    e.dataTransfer.effectAllowed='move';
    try{e.dataTransfer.setData('text/plain',r.dataset.path||r.dataset.id||'');}catch(_){}
    r.classList.add('dragging');
  });
  document.addEventListener('dragover',function(e){
    if(!draggingEl)return;
    e.preventDefault();
    e.dataTransfer.dropEffect='move';
    var row=e.target.closest('.row');
    if(!row||row===draggingEl){clearHints();dropIntoRow=null;dropIntoSiblingParent=null;return;}
    // 项目拖到合集行上 → 移入该合集
    if(dragKind==='project'&&row.dataset.kind==='collection'){
      clearHints();dropIntoRow=row;dropIntoSiblingParent=null;row.classList.add('drop-into');
      return;
    }
    // 同类同级 → 实时调整顺序
    if(row.dataset.kind===dragKind&&(row.dataset.parent||'')===dragParent){
      clearHints();dropIntoRow=null;dropIntoSiblingParent=null;
      var rect=row.getBoundingClientRect();
      var after=e.clientY>rect.top+rect.height/2;
      if(after){
        if(row.nextSibling!==draggingEl){row.parentNode.insertBefore(draggingEl,row.nextSibling);}
      }else{
        row.parentNode.insertBefore(draggingEl,row);
      }
      return;
    }
    // 项目拖到别的合集里的项目上 → 移入该项目所在的合集
    if(dragKind==='project'&&row.dataset.kind==='project'){
      clearHints();dropIntoRow=null;dropIntoSiblingParent=row.dataset.parent||'';
      return;
    }
    // 合集拖到别的合集上 → 直接嵌套进去（自己/子孙会被后端拒绝）
    if(dragKind==='collection'&&row.dataset.kind==='collection'){
      clearHints();dropIntoRow=row;dropIntoSiblingParent=null;row.classList.add('drop-into');
      return;
    }
    clearHints();dropIntoRow=null;dropIntoSiblingParent=null;
  });
  document.addEventListener('dragend',function(e){
    if(draggingEl) draggingEl.classList.remove('dragging');
    clearHints();
    if(draggingEl&&!filter){
      if(dropIntoRow){
        // 拖到合集行上：直接归类 / 嵌套，不再弹选择框
        if(dragKind==='project') vscode.postMessage({type:'dropIntoCollection',path:draggingEl.dataset.path,collectionId:dropIntoRow.dataset.id});
        else vscode.postMessage({type:'dropCollectionInto',id:draggingEl.dataset.id,parentId:dropIntoRow.dataset.id});
      } else if(dropIntoSiblingParent!==null){
        vscode.postMessage({type:'dropIntoCollection',path:draggingEl.dataset.path,collectionId:dropIntoSiblingParent});
      } else if(dragKind==='project'){
        vscode.postMessage({type:'reorder',parentId:dragParent,paths:siblingPaths(dragParent)});
      } else {
        vscode.postMessage({type:'reorderCollections',parentId:dragParent,ids:siblingIds(dragParent)});
      }
      justDragged=true;
      setTimeout(function(){justDragged=false;},300);
    }
    draggingEl=null;dragKind=null;dragParent='';dropIntoRow=null;dropIntoSiblingParent=null;
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

/** Normalize a collection id coming from the webview: "" / null mean "top level". */
function optId(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
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
				title: "重命名项目",
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
// Commands: 合集（collections）
// ---------------------------------------------------------------------------

/** Indented label so a nested collection reads as "银医通 / 门诊" in the picker. */
function collectionPathLabel(store: ProjectStore, id: string): string {
	const names: string[] = [];
	let cur: string | undefined = id;
	const guard = new Set<string>();
	while (cur && !guard.has(cur)) {
		guard.add(cur);
		const c = store.getCollection(cur);
		if (!c) break;
		names.unshift(c.name);
		cur = c.parentId;
	}
	return names.join(" / ");
}

/**
 * Ask for a collection with a QuickPick. `excludeId` (with its descendants) is hidden
 * so a collection can never be moved into itself.
 */
async function pickCollection(
	store: ProjectStore,
	options: { title: string; includeTopLevel?: boolean; excludeId?: string }
): Promise<{ id: string | undefined } | undefined> {
	const exclude = new Set<string>();
	if (options.excludeId) {
		let grew = true;
		exclude.add(options.excludeId);
		while (grew) {
			grew = false;
			for (const c of store.getCollections()) {
				if (c.parentId && exclude.has(c.parentId) && !exclude.has(c.id)) {
					exclude.add(c.id);
					grew = true;
				}
			}
		}
	}

	interface PickItem extends vscode.QuickPickItem {
		collectionId: string | undefined;
	}
	const items: PickItem[] = [];
	if (options.includeTopLevel) {
		items.push({ label: "$(root-folder) 顶层（不放入合集）", collectionId: undefined });
	}
	for (const c of store.getCollections()) {
		if (exclude.has(c.id)) continue;
		const depth = collectionPathLabel(store, c.id).split(" / ").length - 1;
		items.push({
			label: `${"　".repeat(depth)}$(symbol-folder) ${c.name}`,
			description: depth > 0 ? collectionPathLabel(store, c.id) : undefined,
			collectionId: c.id,
		});
	}
	if (items.length === 0) {
		void vscode.window.showInformationMessage("还没有合集，请先新建一个合集。");
		return undefined;
	}
	const picked = await vscode.window.showQuickPick(items, {
		title: options.title,
		placeHolder: "选择一个合集",
	});
	if (!picked) return undefined;
	return { id: picked.collectionId };
}

function newCollectionCommand(store: ProjectStore, parentId?: string) {
	return async () => {
		const value = await vscode.window.showInputBox({
			title: parentId ? "新建子合集" : "新建合集",
			prompt: "输入合集名称（例如：银医通、公众号）",
			placeHolder: "合集名称",
		});
		if (value === undefined) return;
		const created = store.addCollection(value, parentId);
		if (!created) {
			void vscode.window.showWarningMessage("合集名称不能为空。");
		}
	};
}

function renameCollectionCommand(store: ProjectStore) {
	return async (arg?: unknown) => {
		const id = typeof arg === "string" ? arg : undefined;
		const c = id ? store.getCollection(id) : undefined;
		if (!c) return;
		const value = await vscode.window.showInputBox({
			title: "重命名合集",
			prompt: `为合集「${c.name}」设置新名称`,
			value: c.name,
		});
		if (value === undefined) return;
		if (value.trim().length === 0) {
			void vscode.window.showWarningMessage("合集名称不能为空。");
			return;
		}
		store.renameCollection(c.id, value);
	};
}

function removeCollectionCommand(store: ProjectStore) {
	return async (arg?: unknown) => {
		const id = typeof arg === "string" ? arg : undefined;
		const c = id ? store.getCollection(id) : undefined;
		if (!c) return;
		const answer = await vscode.window.showWarningMessage(
			`确定删除合集「${c.name}」吗？\n其中的项目和子合集不会删除，会移到上一层。`,
			{ modal: true },
			"删除合集"
		);
		if (answer === "删除合集") store.removeCollection(c.id);
	};
}

/** Move a project into a collection (or back to the top level). */
function moveToCollectionCommand(store: ProjectStore) {
	return async (arg?: unknown) => {
		const filePath = pathFromArg(arg);
		if (!filePath) return;
		const e = store.get(filePath);
		if (!e) return;
		const picked = await pickCollection(store, {
			title: `把「${store.label(e)}」移动到…`,
			includeTopLevel: true,
		});
		if (!picked) return;
		store.moveProject(filePath, picked.id);
	};
}

/** Move a collection under another collection (or back to the top level). */
function moveCollectionCommand(store: ProjectStore) {
	return async (arg?: unknown) => {
		const id = typeof arg === "string" ? arg : undefined;
		const c = id ? store.getCollection(id) : undefined;
		if (!c) return;
		const picked = await pickCollection(store, {
			title: `把合集「${c.name}」移动到…`,
			includeTopLevel: true,
			excludeId: c.id,
		});
		if (!picked) return;
		if (picked.id === c.parentId) return;
		store.moveCollection(c.id, picked.id);
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
		"projectList.newCollection": newCollectionCommand(store),
		"projectList.openConfig": () =>
			vscode.commands.executeCommand("vscode.open", store.configFile),
		"projectList.open": openProjectCommand(store),
		"projectList.openNewWindow": openProjectCommand(store, { forceNewWindow: true }),
		"projectList.rename": renameCommand(store),
		"projectList.clearName": clearNameCommand(store),
		"projectList.togglePriority": togglePriorityCommand(store),
		"projectList.remove": removeCommand(store),
		"projectList.moveToCollection": moveToCollectionCommand(store),
		"projectList.renameCollection": renameCollectionCommand(store),
		"projectList.removeCollection": removeCollectionCommand(store),
		"projectList.moveCollection": moveCollectionCommand(store),
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
