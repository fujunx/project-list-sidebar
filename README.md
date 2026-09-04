# 项目列表 (Project List) — 侧边栏版

一个复刻 WebStorm「项目列表」体验的 VS Code 扩展：在左侧活动栏（Activity Bar）常驻一个**项目列表**视图，支持：

- **二次命名**：给每个项目起一个自定义显示名称（昵称），列表优先展示已命名的项目。
- **标题也显示别名**：打开已命名的项目时，**窗口顶部标题会是别名**（通过自动生成一个带 `name` 的 `.code-workspace` 实现，行为类似工作区）。缓存文件直接用别名命名、**不带哈希**；为避免文件重名，**相同的显示名称不允许使用**（重名会提示换一个）。
- **自定义选择目录**：新增项目时可以**直接从磁盘选取任意目录**（也支持 `.code-workspace` 文件），不必是当前打开的项目。
- **置顶**：把常用项目固定到列表最上方。
- **添加当前项目**：一键把当前打开的项目加进列表。
- **双击 / 回车即打开**：点击列表中任意项目会立即用 `vscode.openFolder` 打开。
- **配置文件**：项目列表存储在一个可读写的 JSON 文件里，方便手动编辑和备份。

> 形态说明：本扩展是「侧边栏」形态（Activity Bar 里的项目列表）。它让列表**常驻左侧**，并在 VS Code 启动时自动聚焦。

---

## 安装

### 方案 A：打包成 `.vsix` 安装到你的 VS Code（推荐，用于日常使用）

在项目根目录执行：

```bash
npm install
npm run vsix
```

这会在项目根目录生成 `project-list-sidebar-0.0.1.vsix`。然后：

1. 打开 VS Code → 命令面板（`Ctrl+Shift+P`）→ **Extensions: Install from VSIX...**
2. 选择刚才生成的 `.vsix` 文件。
3. 安装后重启 VS Code。

> 注意：生成 `.vsix` 需要 `@vscode/vsce`（`npm run vsix` 已包含）。首次运行可能提示缺少 `--no-dependencies` 或需要网络；脚本已加上 `--no-dependencies`。

### 方案 B：开发模式（扩展开发宿主）

用 VS Code 打开本目录，按 `F5` 会启动一个「扩展开发宿主」窗口，里面能看到效果。适合调试源码。

---

## 使用

安装后，左侧活动栏会出现一个文件夹图标（项目列表）。点击它即可展开项目列表。

### 搜索项目

- 顶部是一个**搜索框**，与上方的「项目列表」标题左对齐：输入关键字即可按名称/路径**实时过滤**项目列表；清空恢复全部。
- **＋（从磁盘选目录）／ ⟳（刷新）／ ⚙（配置文件）** 这三个按钮放在了顶部「项目列表」标题的**同一行右侧**（VS Code 视图标题栏，和插件市场一致的样式）。

### 添加项目

- **从磁盘选目录**：点右上角 **＋**，会弹出选择方式——选「从磁盘选择目录 / 工作区…」后弹出系统目录选择器，可多选任意文件夹或 `.code-workspace` 文件。
- **添加当前项目**：命令面板执行 `项目列表: 添加当前项目`。

### 二次命名

- **右键**某一项目行 → **二次命名**，输入显示名称（留空则恢复为文件夹名）。
- 有自定义名称的项目会自动**排在前面**（可在设置里关闭 `projectList.preferNamedFirst`）。
- **打开已命名的项目时，窗口顶部标题会显示别名**：扩展会为它生成一个 `name` 为别名的缓存工作区文件（存放在配置目录旁的 `project-workspaces/` 下），像命名工作区一样展示。清除名称或移除项目时，该缓存文件会自动清理。**相同显示名不允许重复**，重名时会提示你换一个名称。

### 置顶

- **右键**某一项目行 → **收藏 / 取消收藏（置顶）**，被置顶的项目会固定在最前面（黄色星标）。

### 打开项目

- **点击**列表中的任意一行即可打开。

### 从列表移除 / 清除名称

- **右键**某一项目行 → **从列表移除**。
- 清除自定义名称：右键 → **二次命名**，在输入框里清空并确定即可。

---

## 让「双击启动 VS Code 后进入项目列表」

由于本扩展是侧边栏形态，配合下面两步最接近 WebStorm：

1. 在 `设置.json` 里开启启动时自动聚焦（默认已开启）：

   ```json
   "projectList.showOnStartup": true
   ```

2. 让 VS Code 启动时不要自动恢复上次的工作区，这样一进来看到的就是项目列表而不是上次的工程：

   ```json
   "window.restoreWindows": "none"
   ```

3. 说明：项目列表只在「**空窗口**启动」时自动浮现（即没有打开任何项目/工作区时）。通过双击列表进入某个项目后，打开的是**该项目窗口**，**不会**再自动弹出项目列表，避免"每次进项目都跳回列表"。

   （`"none"` 会打开一个空窗口；项目列表会自动出现在左侧。）

> 如果你更想要「双击启动后直接弹出一个**全屏项目选择页**」而不是侧边栏，我可以把 UI 改成 webview 启动页形态——告诉我即可。

---

## 配置文件

默认路径：`~/.vscode-project-list.json`（`~` 为你的用户主目录）。

```json
{
  "entries": [
    {
      "path": "C:/Users/om/code/backend-service",
      "name": "我的后端服务",
      "priority": true,
      "addedAt": 1730000000000
    },
    {
      "path": "C:/Users/om/code/hello-world"
    }
  ]
}
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `path` | 项目绝对路径，或 `.code-workspace` 文件的路径 |
| `name` | 二次命名（昵称）；缺省则显示文件夹名 |
| `priority` | `true` 时置顶 |
| `addedAt` | 加入时间戳（排序用） |

可在设置里修改 `projectList.configPath` 指定其它路径。

---

## 设置

| 设置 | 默认 | 说明 |
| --- | --- | --- |
| `projectList.showOnStartup` | `true` | VS Code 启动时自动聚焦「项目列表」视图（仅在空窗口时） |
| `projectList.preferNamedFirst` | `true` | 优先展示已命名的项目 |
| `projectList.configPath` | `~/.vscode-project-list.json` | 配置文件路径 |

---

## 开发 / 构建

```bash
npm install        # 安装依赖
npm run compile    # 编译（输出到 dist/extension.js）
npm run watch      # 监听编译
npm run typecheck  # 类型检查
npm run vsix       # 打包 .vsix
```

## 目录结构

```
.
├── package.json        # 扩展清单（视图 / 命令 / 菜单 / 设置）
├── esbuild.js          # 构建脚本
├── tsconfig.json
├── src/extension.ts    # 扩展主逻辑（存储 / 树 / 命令）
└── media/projects.svg  # 活动栏图标
```

## 发布

发布到 Marketplace 需要 `publisher`、`README.md`、`LICENSE`，并在 Marketplace 创建发布者。当前 `publisher` 为 `local-dev`，仅用于本地安装。如需正式发布，请改成你自己的 publisher id。
