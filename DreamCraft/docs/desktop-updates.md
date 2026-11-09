# Windows 更新与签名

## 用户升级

1.0.x 请从 GitHub Releases 下载新安装器，覆盖安装到原位置；便携版请先退出，
解压到新目录再启动。个人账号、密钥和作品位于 `%LOCALAPPDATA%\DreamCraft`。

从 1.1.0 起，原生启动窗口会自动检查版本，也可以点击「检查更新」。
发现新版后点击「下载并更新」，保存编辑内容并确认。程序会先下载并核对
GitHub 附件的 SHA256 和大小，检查通过后关闭本机服务，升级并重新打开。
网络或校验失败不会替换现有程序。源码运行不使用桌面更新器。

安装版调用原安装目录的安装器进行升级；便携版在同一磁盘上替换整个程序目录，
旧目录保留为 `DreamCraft.previous-随机字符`。确认新版正常后可以手动删除备份。
自行放在程序目录的文件留在旧版备份中；同目录 `ffmpeg.exe` 会带到新版。
程序父目录需要可写空间。通过 `--data-dir` 指定的数据目录必须在程序目录外。
用户安装的 ComfyUI、模型和 FFmpeg 不由更新器联网安装或升级。

更新暂存目录位于程序父目录下的 `.dreamcraft-update-随机字符`，
包含下载文件和 `update.log`；安装出错可同时查看 `installer.log`。
失败后可重新运行原程序，或使用已验证的安装器手动完成升级。
确认没有更新进程在运行后，可以删除这些暂存目录。更新不自动清理旧版备份。
设置环境变量 `DREAMCRAFT_UPDATE_CHECK=0` 可关闭启动时检查，手动按钮仍可使用。

GitHub 匿名 API 按出口地址限流，共用代理的额度耗尽时可能返回 HTTP 403。
请等限额恢复或换用自己可用的网络；也可从正式发布页手动下载。
附件下载成功并不代表 API 额度已恢复，项目不会内置维护者 GitHub 凭据。

## 更新来源与边界

更新器通过 HTTPS 读取 `kein02/webpage-and-app` 的 Releases，
只接受严格的 `dreamcraft-v主版本.次版本.修订号` 正式标签，
忽略草稿、预发布及同仓库的其他项目。只允许升级，不允许降级。
GitHub 不把 DreamCraft 标为整个仓库的 latest，因此按列表查找版本。

附件必须具有匹配版本的名称、预期 GitHub 地址、SHA256 和合理大小，
下载重定向仅允许 GitHub 的附件域名。便携包解压前检查路径和展开大小。
SHA256 用于发现损坏或附件不一致；它依赖 GitHub 仓库和发布账号可信，
不能代替独立发布者签名。受信任的已签名版本升级时还要求新版签名有效，
发布者证书 Subject 与当前版本一致，允许同一发布者续期证书。

## 维护者签名

当前公开包仍未签名。本机没有可用代码签名证书，也未配置 GitHub 签名凭证。
完成可信签名需要维护者已有的代码签名证书及其私钥，或另行接入签名服务；
本项目不会自动购买证书、注册付费服务或使用自签名证书冒充可信发布。

本机支持 Windows 当前用户证书存储中的证书（可使用硬件私钥提供程序），
也支持密码保护的 PFX。签名使用 Windows SDK 的 `signtool.exe`，
SHA256 文件摘要及 RFC3161 SHA256 时间戳，验证失败会中止构建。
PFX 密码从环境变量读取，不放到命令参数和项目文件中。

```powershell
# 证书应已安装到当前用户的「个人」存储，并具有私钥和代码签名用途。
$env:DREAMCRAFT_SIGN_THUMBPRINT = '你的证书SHA1指纹（40位十六进制）'
./desktop/build.ps1 -RequireInstaller -RequireSignature
```

或者设置 `DREAMCRAFT_SIGN_PFX` 为本机 PFX 文件绝对路径，
通过进程环境变量提供 `DREAMCRAFT_SIGN_CERT_PASSWORD`。
仅当证书尚未安装时临时导入，签完移除临时证书；已有证书保留。
需要时用 `DREAMCRAFT_SIGNTOOL` 指定 SDK 工具路径，
用 `DREAMCRAFT_SIGN_TIMESTAMP` 指定 RFC3161 时间戳地址。
不要把 PFX、密码、Base64 或环境配置提交到仓库。

CI 在仓库 Settings → Secrets and variables → Actions 配置：

| 类型 | 名称 | 内容 |
|---|---|---|
| Secret | `DREAMCRAFT_SIGN_CERT_BASE64` | PFX 文件的 Base64 |
| Secret | `DREAMCRAFT_SIGN_CERT_PASSWORD` | PFX 密码 |
| Variable | `DREAMCRAFT_REQUIRE_SIGNATURE` | 设为 `true`，强制签名，否则缺凭证直接失败 |

Base64 在 runner 临时目录解码，构建结束删除。证书和密码不打进包。
应用先签名再制作 ZIP；Inno Setup 的 SignTool 同时签安装器、临时副本与卸载器。
最终包再生成 SHA256。没有凭证时构建会明确提示 unsigned；
建议配置成功后保持 `DREAMCRAFT_REQUIRE_SIGNATURE=true`。

下载签名发布后可在 PowerShell 检查：

```powershell
Get-AuthenticodeSignature .\DreamCraft.exe | Format-List Status,SignerCertificate,TimeStamperCertificate
Get-AuthenticodeSignature .\DreamCraft-Setup-1.1.1-x64.exe | Format-List Status,SignerCertificate,TimeStamperCertificate
```

`Status` 应为 `Valid` 且有时间戳证书。安装后的 `unins000.exe` 也应检查。
证书签名本身不保证立即消除 Windows 下载信誉提示。
