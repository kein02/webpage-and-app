@echo off
cd /d %~dp0
rem 便携版：项目自带 node.exe，对方电脑不用装 Node.js；找不到才用系统里的
if exist "node\node.exe" (set "NODEEXE=node\node.exe") else (set "NODEEXE=node")
echo.
echo   DreamForge 造梦工坊 正在启动...
echo   这个黑色窗口就是服务器，用完直接关掉这个窗口即可。
echo.
if "%PORT%"=="" start "" http://localhost:3000
%NODEEXE% server.js
echo.
echo   服务器已停止。按任意键关闭窗口。
pause >nul
