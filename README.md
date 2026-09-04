# 项目列表 (Project List)

一个复刻 WebStorm 项目列表体验的 VS Code 扩展：在左侧活动栏常驻一个**项目列表**，方便你集中管理、快速打开多个项目。

## 功能

- **二次命名**：给项目起自定义名称，已命名的项目自动排在前面；打开后窗口顶部标题显示别名。
- **快速打开**：点击任意项目即可打开；支持 `.code-workspace` 工作区文件。
- **搜索**：顶部搜索框按名称/路径实时过滤项目。
- **置顶**：把常用项目固定到列表最上方。
- **新增项目**：从磁盘选目录，或一键添加当前打开的项目。
- **本地配置**：列表保存在 `~/.vscode-project-list.json`，可手动编辑。

## 使用

1. 点击左侧活动栏的**项目列表**图标。
2. 点右上角 **＋** 从磁盘选择目录，或按 `Ctrl+Shift+P` 执行「项目列表: 添加当前项目」。
3. **点击**某一行即可打开项目。
4. **右键**某一行可：**二次命名** / **收藏（置顶）** / **从列表移除**。
5. 顶部搜索框输入关键字即可过滤；**＋／⟳／⚙** 在标题栏右侧。

## 安装

直接安装打包好的 `.vsix`：

1. VS Code → `Ctrl+Shift+P` → **Extensions: Install from VSIX...**
2. 选择 `project-list-sidebar-*.vsix`，重启 VS Code。

或从源码构建打包：

```bash
npm install
npm run vsix   # 生成 .vsix
```

## 设置

| 设置 | 默认 | 说明 |
| --- | --- | --- |
| `projectList.showOnStartup` | `true` | 空窗口启动时自动聚焦项目列表 |
| `projectList.preferNamedFirst` | `true` | 已命名项目排在前面 |
| `projectList.configPath` | `~/.vscode-project-list.json` | 列表配置文件路径 |

想「双击启动 VS Code 直接进入项目列表」，在 `settings.json` 加：`"window.restoreWindows": "none"`。

---

## 开发命令

`npm run compile`（编译）· `npm run watch`（监听）· `npm run typecheck`（类型检查）· `npm run vsix`（打包）

## 发新版本（版本号自动递增）

执行 `npm run release`：它会**自动把 `package.json` 版本 +1**（如 `0.0.1 → 0.0.2`，patch 满 9 进位到 minor）并打包出对应版本的 `.vsix`，避免每次版本号一样、分不清新旧。

打包后提交并打标签推送（GitHub Actions 会自动建 Release 并挂上 `.vsix`）：

```bash
npm run release
git add -A && git commit -m "v0.0.2"
git tag v0.0.2
git push origin main --tags
```

