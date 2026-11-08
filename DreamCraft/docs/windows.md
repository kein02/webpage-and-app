# Windows 使用与构建

Windows 10/11 x64 桌面包，原生启动窗口配合浏览器工作区。数据保存在 `%LOCALAPPDATA%\DreamCraft`，升级及卸载保留数据。卸载程序仅删除应用文件和安装器创建的快捷方式。

## 使用

安装版运行 `releases/DreamCraft-Setup-1.0.0-x64.exe`；安装向导支持选择目录、桌面快捷方式和开始菜单入口。便携版解压 ZIP 后运行 DreamCraft.exe，必须保留 `_internal` 目录。

启动器自动打开浏览器，重复双击复用当前实例；关闭启动器停止服务。默认端口 17861，冲突时自动选择空闲端口。

使用当前电脑的 API 环境变量或引擎设置。默认 ComfyUI 地址为 `http://127.0.0.1:8188`，需要先启动 ComfyUI；不包含模型。短剧合成需要 FFmpeg 在 PATH 或 EXE 同目录。

## 构建

```powershell
python -m pip install -r app/backend/requirements.txt
python -m pip install pyinstaller
./desktop/build.ps1 -Python python
```

构建脚本使用项目相对路径。图标在 `desktop/app.ico`，EXE 版本信息在 `desktop/version.txt`，安装版本在 `desktop/installer.iss`。修改版本时两处同步。

安装器编译工具使用 Inno Setup，项目内路径 `tools/InnoSetup/ISCC.exe`。本机采用 NuGet 非官方分发包 Tools.InnoSetup 6.7.3，其中编译器 Authenticode 签名有效，签名者为 Pyrsys B.V.。语言文件来自 Inno Setup 官方源码仓库。构建产物在 `build`，可交付文件在 `releases`。缺少 Inno Setup 时仍可生成便携 ZIP。

安装回归：`./tests/test_installer.ps1 -Python python`。详细验证范围见 [Windows 验收](windows-acceptance.md)。

## 发布

打包必须排除数据库、密钥和私人作品。发布时只上传安装器、便携 ZIP、校验文件和版本说明。项目源目录包含本机运行数据，不能整体压缩后公开。

发布目标为 [dreamcraft-v1.0.0](https://github.com/kein02/webpage-and-app/releases/tag/dreamcraft-v1.0.0)，与同仓库 DreamForge 的版本独立。自动更新和数字签名暂不包含在 1.0.0。
