@echo off
chcp 65001 >nul
echo.
echo 正在安装「项目列表」扩展 ...
echo.
where code >nul 2>nul
if %errorlevel%==0 (
  code --install-extension "%~dp0project-list-sidebar-0.0.1.vsix" --force
  if %errorlevel%==0 (
    echo.
    echo 安装成功！请重启 VS Code，然后在左侧活动栏点击「项目列表」图标查看。
  ) else (
    echo.
    echo 安装失败。请手动安装：打开 VS Code，按 Ctrl+Shift+P，
    echo 执行 Extensions: Install from VSIX... ，选择本目录下的
    echo project-list-sidebar-0.0.1.vsix。
  )
) else (
  echo 未找到 code 命令（可能 VS Code 不在 PATH 中）。
  echo 请打开 VS Code，按 Ctrl+Shift+P，
  echo 执行 Extensions: Install from VSIX... ，选择本目录下的
  echo project-list-sidebar-0.0.1.vsix。
)
echo.
pause
