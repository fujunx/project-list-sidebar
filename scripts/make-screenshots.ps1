<#
Regenerates the Marketplace screenshots (docs/images/*.png) from the REAL webview UI:
it renders the HTML that src/extension.ts produces, so the shots cannot drift from the code.

Requirements:
  - run `npm run compile` first (the script loads dist/extension.js)
  - Google Chrome or Microsoft Edge installed
  - PowerShell 7+ (pwsh). The sample data below is UTF-8 Chinese, which Windows
    PowerShell 5.1 would read as ANSI and mangle.

    pwsh -File scripts/make-screenshots.ps1
#>
param(
    [string]$ChromePath = "",
    [int]$Width = 340,
    [int]$Height = 500,
    [double]$Scale = 2
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

function Resolve-Chrome([string]$explicit) {
    if ($explicit) { return $explicit }
    $candidates = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
    )
    foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
    throw "Chrome/Edge not found; pass -ChromePath."
}

$chrome = Resolve-Chrome $ChromePath
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$dist = Join-Path $repo "dist\extension.js"
if (-not (Test-Path $dist)) { throw "dist/extension.js missing - run 'npm run compile' first." }

$work = Join-Path $env:TEMP "pls-screenshots"
if (Test-Path $work) { Remove-Item -LiteralPath $work -Recurse -Force }
New-Item -ItemType Directory -Path $work -Force | Out-Null

# --- 1. Ask the extension for its two pages, wrapped in a VS Code dark-theme shell ----------
$nodeCode = @'
const fs = require("fs"), os = require("os"), path = require("path"), Module = require("module");
const out = process.env.PLS_SHOT_DIR;
const base = path.join(os.tmpdir(), "pls-screenshot-data");
fs.rmSync(base, { recursive: true, force: true });
const CONFIG = path.join(base, ".vscode-project-list.json");
const noop = async () => undefined;
const fake = {
  EventEmitter: class { constructor(){ this.l=[]; } get event(){ return f => { this.l.push(f); return { dispose(){} }; }; } fire(){ this.l.slice().forEach(f=>f()); } },
  Uri: { file: p => ({ fsPath: p }) },
  ConfigurationTarget: { Global: 1 },
  window: {
    showWarningMessage: noop, showInformationMessage: noop, showErrorMessage: noop,
    showInputBox: noop, showQuickPick: noop, showOpenDialog: noop,
    registerWebviewViewProvider: (t, p) => { global.__provider = p; return { dispose(){} }; },
    onDidChangeConfiguration: () => ({ dispose(){} }),
  },
  workspace: {
    getConfiguration: () => ({ get: (k, d) => (k === "configPath" ? CONFIG : d), update: async () => {} }),
    workspaceFolders: undefined,
    onDidChangeConfiguration: () => ({ dispose(){} }),
  },
  commands: { registerCommand: () => ({ dispose(){} }), executeCommand: async () => {} },
};
const load = Module._load;
Module._load = function (request, ...rest) { return request === "vscode" ? fake : load.call(this, request, ...rest); };
require(path.join(process.env.PLS_REPO_DIR, "dist", "extension.js")).activate({
  subscriptions: [], globalStorageUri: fake.Uri.file(path.join(base, "gs")),
});

const store = global.__provider.store;
const mk = n => { const p = path.join(base, n); fs.mkdirSync(p, { recursive: true }); return p; };
const DIR = "D:\\work\\";
const samples = [
  ["a", "官网_主站",   "site",           true ],
  ["b", "官网_移动端", "site-mobile",    false],
  ["c", "权限服务",    "admin-auth",     false],
  ["d", "网关服务",    "admin-gateway",  false],
  ["e", "后台_管理端", "admin-web",      false],
  ["f", "docs-site",   "docs",           false],
];
for (const [key, label, dir, pinned] of samples) {
  store.add(mk(key));
  store.rename(mk(key), label);
  if (pinned) store.togglePriority(mk(key));
  store.entries.find(e => e.path === mk(key)).path = DIR + dir;
}
const cSite = store.addCollection("官网");
const cBack = store.addCollection("后台");
const cShared = store.addCollection("公共", cBack.id);
store.moveProject(DIR + "site", cSite.id);
store.moveProject(DIR + "site-mobile", cSite.id);
store.moveProject(DIR + "admin-auth", cShared.id);
store.moveProject(DIR + "admin-gateway", cShared.id);
store.moveProject(DIR + "admin-web", cBack.id);

const html = global.__provider.buildHtml(global.__provider.computeTree());
const nonce = html.match(/<style nonce="([^"]+)"/)[1];
const shell = `<style nonce="${nonce}">
:root{--vscode-font-family:"Segoe UI","Microsoft YaHei",sans-serif;--vscode-font-size:13px;
--vscode-foreground:#CCCCCC;--vscode-sideBar-background:#252526;--vscode-panel-border:rgba(128,128,128,.35);
--vscode-input-background:#3C3C3C;--vscode-input-foreground:#CCCCCC;--vscode-input-border:#3C3C3C;
--vscode-input-placeholderForeground:#818181;--vscode-focusBorder:#007FD4;--vscode-descriptionForeground:#9D9D9D;
--vscode-list-hoverBackground:#2A2D2E;--vscode-list-activeSelectionBackground:#04395E;--vscode-list-activeSelectionForeground:#FFFFFF;
--vscode-menu-background:#252526;--vscode-menu-border:#454545;--vscode-menu-selectionBackground:#04395E;--vscode-menu-selectionForeground:#FFFFFF;
--vscode-toolbar-hoverBackground:rgba(90,93,94,.31)}
html,body{width:${process.env.PLS_SHOT_W}px;height:${process.env.PLS_SHOT_H}px;margin:0;overflow:hidden}
</style>
<script nonce="${nonce}">window.acquireVsCodeApi=function(){return{postMessage:function(){},getState:function(){return{}},setState:function(){}}};</script>
</head>`;
const page = html.replace("</head>", shell);
fs.writeFileSync(path.join(out, "sidebar.html"), page, "utf8");

const openMenu =
  '<script nonce="' + nonce + '">(function(){var rows=document.querySelectorAll("#content .row");' +
  'var t=rows[1]||rows[0];var r=t.getBoundingClientRect();' +
  't.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:r.left+24,clientY:r.top+8}));})();</script>';
fs.writeFileSync(path.join(out, "context-menu.html"), page.replace("</body>", openMenu + "</body>"), "utf8");

fs.rmSync(base, { recursive: true, force: true });
console.log("pages written to " + out);
'@

$tmpJs = Join-Path $work "emit-pages.js"
Set-Content -LiteralPath $tmpJs -Value $nodeCode -Encoding utf8
$env:PLS_SHOT_DIR = $work
$env:PLS_REPO_DIR = $repo
$env:PLS_SHOT_W = "$Width"
$env:PLS_SHOT_H = "$Height"
Push-Location $repo
try { node $tmpJs } finally { Pop-Location }

# --- 2. Render each page, then crop away the window's empty margin -------------------------
$images = @{ "sidebar.html" = "sidebar.png"; "context-menu.html" = "context-menu.png" }
foreach ($page in $images.Keys) {
    $url = "file:///" + ((Join-Path $work $page) -replace "\\", "/")
    $raw = Join-Path $work ($page -replace "\.html$", "-raw.png")
    & $chrome --headless=new --disable-gpu --hide-scrollbars `
        --force-device-scale-factor=$Scale --window-size=520,600 `
        --user-data-dir="$work\profile" --virtual-time-budget=2000 `
        --screenshot="$raw" $url 2>&1 | Out-Null
    if (-not (Test-Path $raw)) { throw "Chrome produced no screenshot for $page" }

    $src = [System.Drawing.Image]::FromFile($raw)
    $dst = New-Object System.Drawing.Bitmap ([int]($Width * $Scale)), ([int]($Height * $Scale))
    $gfx = [System.Drawing.Graphics]::FromImage($dst)
    $gfx.DrawImage($src,
        (New-Object System.Drawing.Rectangle 0, 0, $dst.Width, $dst.Height),
        (New-Object System.Drawing.Rectangle 0, 0, $dst.Width, $dst.Height),
        [System.Drawing.GraphicsUnit]::Pixel)
    $gfx.Dispose(); $src.Dispose()

    $target = Join-Path $repo ("docs\images\" + $images[$page])
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    $dim = "$($dst.Width)x$($dst.Height)"
    $dst.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
    $dst.Dispose()
    Write-Host "wrote $target ($dim)"
}

Remove-Item -LiteralPath $work -Recurse -Force
