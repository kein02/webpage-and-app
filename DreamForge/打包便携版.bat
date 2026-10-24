@echo off
cd /d %~dp0
echo.
echo   ============================================
echo    DreamForge 便携版打包工具
echo   ============================================
echo.

REM ---- 安全检查：.env 里不能有 Key，否则会把 Key 打进包泄露出去 ----
if not exist .env copy /y .env.example .env >nul
findstr /R /C:"sk-[A-Za-z0-9]" .env >nul 2>&1
if %errorlevel%==0 (
  echo   [安全拦截] 检测到 .env 里含有 Key 内容（sk- 开头）！
  echo.
  echo   直接打包会把你的 Key 泄露给拿到这个包的人。
  echo   请先把 .env 清空（所有 Key 行等号后留空），再重新运行本脚本。
  echo.
  pause
  exit /b 1
)
REM 智谱/硅基/MiniMax 的 Key 不是 sk- 开头，单独再查一遍非空值
findstr /R /C:"_API_KEY=." .env >nul 2>&1
if %errorlevel%==0 (
  echo   [安全拦截] 检测到 .env 里有非空的 API Key 值！
  echo   请先把所有 Key 行等号后留空，再重新运行本脚本。
  echo.
  pause
  exit /b 1
)

echo   [1/4] 准备打包目录...
if exist .portable-stage rmdir /s /q .portable-stage
mkdir .portable-stage\DreamForge
mkdir .portable-stage\DreamForge\public
mkdir .portable-stage\DreamForge\node

echo   [2/4] 复制运行所需文件...
REM 注意：cmd 的 copy 一次只能复制一个文件，多文件必须逐条来
copy /y server.js .portable-stage\DreamForge\ >nul
copy /y models.config.json .portable-stage\DreamForge\ >nul
copy /y package.json .portable-stage\DreamForge\ >nul
copy /y LICENSE .portable-stage\DreamForge\ >nul
copy /y start.bat .portable-stage\DreamForge\ >nul
copy /y README.md .portable-stage\DreamForge\ >nul
copy /y CHANGELOG.md .portable-stage\DreamForge\ >nul
copy /y 使用说明.md .portable-stage\DreamForge\使用说明.txt >nul
copy /y 接入AgnesAI.md .portable-stage\DreamForge\ >nul
copy /y 接入智谱CogVideoX.md .portable-stage\DreamForge\ >nul
copy /y 接入真实模型.md .portable-stage\DreamForge\ >nul
copy /y 免费视频模型调研.md .portable-stage\DreamForge\ >nul
copy /y 视频模型接入大全.md .portable-stage\DreamForge\ >nul
copy /y 部署到公开链接.md .portable-stage\DreamForge\ >nul
copy /y .env .portable-stage\DreamForge\ >nul
copy /y public\index.html .portable-stage\DreamForge\public\ >nul
copy /y public\app.js .portable-stage\DreamForge\public\ >nul
copy /y public\style.css .portable-stage\DreamForge\public\ >nul
copy /y node\node.exe .portable-stage\DreamForge\node\ >nul

echo   [3/4] 压缩成 zip（约 30 秒）...
REM 用 Windows 自带 tar（bsdtar）的 zip 格式：路径分隔符是正斜杠，符合 zip 规范，
REM 任何解压工具（7-Zip / Mac / Linux / Windows）都能正确还原目录结构。
REM 不能用 Compress-Archive：它把路径写成反斜杠，别的工具解压会把目录压扁。
if exist DreamForge-便携版.zip del /q DreamForge-便携版.zip
"%SystemRoot%\System32\tar.exe" --format zip -c -f "DreamForge-便携版.zip" -C ".portable-stage" "DreamForge" 2>nul
if not exist DreamForge-便携版.zip (
  echo   [失败] 系统没有 tar.exe（需要 Windows 10 1803 以上），请手动压缩：
  echo          进 .portable-stage 目录，右键 DreamForge 文件夹 - 压缩为 zip
  pause
  exit /b 1
)

echo   [4/4] 清理临时目录...
rmdir /s /q .portable-stage

echo.
echo   完成！便携包在这里（资源管理器已帮你打开）：
echo   %CD%\DreamForge-便携版.zip
echo.
echo   发给别人时，连包里的《使用说明.txt》一起转发即可。
echo.
start "" explorer /select,"%CD%\DreamForge-便携版.zip"
echo   按任意键关闭...
pause >nul
