# Windows 使用与构建

Windows 10/11 x64 桌面包，原生启动窗口配合浏览器工作区。数据保存在 `%LOCALAPPDATA%\DreamCraft`，升级及卸载保留数据。卸载程序仅删除应用文件和安装器创建的快捷方式。

## 使用

从 [1.2.0 发布页](https://github.com/kein02/webpage-and-app/releases/tag/dreamcraft-v1.2.0) 下载安装器；安装向导支持选择目录、桌面快捷方式和开始菜单入口。便携版解压 ZIP 后运行 DreamCraft.exe，必须保留 `_internal` 目录。

启动器自动打开浏览器，重复双击复用当前实例；关闭启动器停止服务。默认端口 17861，冲突时自动选择空闲端口。

使用当前电脑的 API 环境变量或引擎设置。默认 ComfyUI 地址为 `http://127.0.0.1:8188`，需要先启动 ComfyUI；不包含模型。短剧合成需要 FFmpeg 在 PATH 或 EXE 同目录。

首次使用可按首页入口打开引擎引导；跳过后仍可在引擎设置中重新打开。引擎设置和短剧工坊会检测 FFmpeg，缺少或无法运行时显示安装位置及重启提示，短剧合成按钮暂停使用。网页自部署时 FFmpeg 必须安装在后端所在电脑，访客电脑的安装不能代替后端依赖。

## 备份与恢复

此功能从 1.2.0 起提供。
启动窗口提供「备份数据」「恢复备份」。先等待网页顶部显示已保存，
选择数据目录之外的私人位置保存 ZIP，然后确认重启服务。

备份包含全部本机账号、项目、任务、素材及文件形式的登录/引擎密钥，
以及数据目录内的 `.env`。ZIP 未额外加密，不要发送给其他人或上传 GitHub。
备份不包含 ComfyUI、模型、FFmpeg、浏览器未保存草稿、日志、更新包和端口/PID。
依赖环境变量提供密钥而没有对应密钥文件的数据，不能制作可迁移备份；
不要临时替换密钥文件，需先由维护者迁移配置。

恢复替换当前全部账号的数据。程序退出原服务后校验清单、文件大小、SHA256、
数据库及加密配置，拒绝路径越界、链接文件、高版本备份和损坏文件。
恢复前在数据目录的上一级保存 `DreamCraft-before-restore-时间-编号.zip`；
替换失败会回滚，恢复成功后自动重启服务。磁盘应有足够空间容纳解压数据、
当前数据和恢复前备份。单份备份限制 100000 文件、20GB。

恢复后网页需刷新；如果恢复的登录密钥不同，重新登录。未保存的浏览器草稿
不在备份内，恢复前应先保存，避免旧草稿覆盖恢复后的项目。
恢复发生意外中断时，退出程序后可使用自动保存的恢复前 ZIP 再次恢复。
备份源文件必须位于数据目录之外；程序不会恢复机器相关的 `desktop.json`。
本机只能由一个 DreamCraft 实例使用同一个数据目录，维护操作不提供公网 API。

源码启动器支持相同操作，默认数据位置仍为 `%LOCALAPPDATA%\DreamCraft`：

```powershell
python desktop/desktop.py --backup-to D:/Codex/DreamCraft-backup.zip
# 退出上一个启动器后再执行
python desktop/desktop.py --restore-from D:/Codex/DreamCraft-backup.zip
```

成功后显示完成位置并启动工作区。CLI 运行时同样需要关闭原实例。
`python tests/test_desktop_backup.py` 可用隔离目录验证完整重启与恢复；
传入测试 EXE 路径时验证打包程序，无需操作真实用户数据。

## 构建

```powershell
python -m pip install -r app/backend/requirements.txt
python -m pip install pyinstaller
cd app/frontend
npm ci
cd ../..
./desktop/build.ps1 -Python python
```

构建脚本使用项目相对路径。图标在 `desktop/app.ico`；`VERSION` 是应用版本来源，构建时自动生成 EXE 版本资源、安装器版本和文件名。网页顶栏、原生启动窗口和后端 OpenAPI 同步显示这个版本。

安装器编译工具使用 Inno Setup 6.5+，默认路径 `tools/InnoSetup/ISCC.exe`，或通过 `-Compiler 'C:/Program Files (x86)/Inno Setup 6/ISCC.exe'` 指定。语言文件来自 Inno Setup 官方源码仓库。构建产物在 `build`，可交付文件在 `releases`。缺少 Inno Setup 时仍可生成便携 ZIP；发布构建必须传 `-RequireInstaller`，缺少编译器直接失败。

安装回归：`./tests/test_installer.ps1 -Python python`。详细验证范围见 [Windows 验收](windows-acceptance.md)。

## 发布

打包必须排除数据库、密钥和私人作品。发布时只上传安装器、便携 ZIP、校验文件和版本说明。项目源目录包含本机运行数据，不能整体压缩后公开。

### 自动发布

仓库根目录 `.github/workflows/dreamcraft-release.yml` 使用 GitHub 的 Windows runner。推送 `dreamcraft-v*` 标签后，校验版本与更新说明、安装依赖、运行后端和安全测试、构建安装版与便携版、检查安装/卸载和便携包。通过后上传安装器、ZIP、SHA256SUMS.txt 和版本说明到对应 Release。构建期间不调用付费接口或开发者本机 ComfyUI，只使用模拟接口。

在仓库根目录操作，以下以 `1.2.0` 为例；发布后不要重复推送同名标签：

```powershell
python DreamCraft/scripts/version.py --set 1.2.0
# 新增 DreamCraft/docs/releases/1.2.0.md，记录本次变化
python DreamCraft/scripts/version.py --tag dreamcraft-v1.2.0
git add DreamCraft
git commit -m "Release DreamCraft 1.2.0"
git push origin main
# 等待 DreamCraft 常规检查通过，再创建标签
git tag dreamcraft-v1.2.0
git push origin dreamcraft-v1.2.0
```

版本采用 `主版本.次版本.修订号`：不兼容变化增加主版本，新功能增加次版本，修复增加修订号。`--set` 同步 VERSION 和 npm 元数据；标签与 VERSION 不一致或缺少说明会阻止发布。已发布标签不要移动，修复后使用新的版本号。

仅想试跑构建时，可在 GitHub Actions 中手动运行 **DreamCraft Windows Release**，选择 main。分支上的手动运行只生成可下载构建产物，不创建 Release。若在标签上手动运行，则会尝试发布该标签；已有 Release 会阻止重复创建。

DreamCraft 使用独立标签，不改变同仓库 DreamForge 的最新版本标记。更新说明保存在 [docs/releases](releases)。
1.1.0 起支持启动器内检查和确认升级；1.0.x 需要先手动升级一次。
签名构建流程已接入，当前发布仍缺维护者证书而未签名。详见 [更新与签名](desktop-updates.md)。
