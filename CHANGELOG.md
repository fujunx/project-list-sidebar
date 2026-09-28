# 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与[语义化版本](https://semver.org/lang/zh-CN/)。
本文件从 0.1.0 开始记录，更早的版本见 [Releases](https://github.com/fujunx/project-list-sidebar/releases)。

## [0.1.3] - 2026-09-28

### 新增

- 商店图标 `media/icon.png`（可用 `scripts/make-icon.ps1` 重新生成），补齐 `icon` / `bugs` / `galleryBanner` / 关键词等上架元数据。
- `scripts/make-screenshots.ps1`：用真实 webview HTML 重新生成 `docs/images/` 里的截图。
- 上架版 README（截图、功能、设置、常见问题）与本更新日志。
- 发布者改为 `fujunx`（为发布到 VS Code 扩展市场做准备）。

### 变更

- 为带别名的项目生成的 `.code-workspace` 改放到扩展的全局存储目录，不再在用户主目录下创建 `project-workspaces/` 文件夹。

## [0.1.2] - 2026-09-28

### 修复

- 区分「添加项目（选择目录）」与「新建合集」的标题栏图标，前者改用 `$(folder-opened)`。

## [0.1.0] - 2026-09-28

### 新增

- 合集（文件夹）：项目可归入合集，合集支持任意层级嵌套，可折叠/展开。删除合集不会删除项目，其中的项目会上移到上一层。
- 拖拽归类：把项目拖到合集行即直接归类，把项目拖到别的合集内的项目上会跟着移进去；把合集拖到别的合集上即直接嵌套。
- 右键菜单：项目与合集都新增「移动到合集…」，合集另有「新建子合集」/「重命名合集」/「删除合集」。

### 变更

- 移除排序模式（最近使用 / 拼音 / 手动）与 `projectList.sortMode` 设置：默认按添加先后排列，拖拽即手动排序，收藏（★）固定置顶。
- 文案统一：「二次命名」改为「重命名」；收藏项按当前状态显示「收藏」或「取消收藏」；「移动到合集…」移到项目菜单第三项。
