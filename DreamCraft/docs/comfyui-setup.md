# ComfyUI 部署与连接

DreamCraft 不包含 ComfyUI、模型、GPU 驱动或模型下载权限。先在 ComfyUI 原生界面成功生成一张图片，再连接 DreamCraft。已有桌面端可继续使用，不必重复安装。

## 选择运行位置

| 场景 | 连接方法 | 可用范围 |
|---|---|---|
| Windows 桌面应用 + 同电脑 ComfyUI | 填 `http://127.0.0.1:8188`，或让本机模式自动发现 | 文生图、参考图、具备节点时的图像工具 |
| 本机源码 + 同电脑/局域网 ComfyUI | 本机模式配置目标地址 | 后端需能访问对应地址 |
| 公网网页 + 访客电脑 ComfyUI | 浏览器直连访客自己的 `127.0.0.1:8188` | 受浏览器本地网络权限、HTTPS、CORS 限制；部分图像工具需后端访问，不能使用访客本机地址 |
| 公网网页 + 远程 GPU 引擎 | 用户配置公网 HTTPS 引擎地址 | 需保护访问权限；当前适配器没有 ComfyUI 自定义鉴权头配置 |

`127.0.0.1` 始终是发起请求的那台电脑。公开后端拒绝内网地址，并关闭本机代理；发布网页不会把站长电脑的 GPU 自动分享给所有访客。个人使用推荐 Windows 应用与本机 ComfyUI 配合。

## 已有 Windows 桌面端

1. 打开 ComfyUI Desktop，确认设备、模型目录和服务端口。默认地址通常为 `http://127.0.0.1:8188`，以实际设置为准。
2. 浏览器打开该地址，使用 ComfyUI 自带的 SDXL 工作流验证生成。
3. 打开 `http://127.0.0.1:8188/system_stats`，应返回 JSON；`/object_info` 应包含节点和模型选项。
4. DreamCraft 注册登录后，在「引擎设置」填地址，点「测试连接」，选择 SDXL 标准或自动，点「保存」。
5. 先用一张低分辨率图片测试，成功后检查素材库和任务中心。

本机页面直连遇到跨域问题时，本机模式可使用后端受限代理。公开网页没有这个代理；需要在 ComfyUI 服务启动选项中允许自己的网页来源。不同 Desktop 版本设置入口不同，以其服务日志显示的启动参数为准。

## 新安装

官方项目：[Comfy-Org/ComfyUI](https://github.com/Comfy-Org/ComfyUI)，官方说明：[docs.comfy.org](https://docs.comfy.org/)。Windows 优先选择官方 Desktop 或便携版，按官方当前的 GPU/Python/PyTorch 组合安装，避免自行混装不同 CUDA 的包。

手动源码安装需要 Git、独立 Python 环境及适配显卡的 PyTorch。以下命令在选好官方支持的 Python/PyTorch 后执行，不能替代官方硬件安装步骤：

```powershell
git clone https://github.com/Comfy-Org/ComfyUI.git
cd ComfyUI
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe main.py --listen 127.0.0.1 --port 8188 --enable-cors-header http://127.0.0.1:8102
```

先确认依赖安装使用了正确的 PyTorch 版本。CPU 模式可添加 `--cpu`，生成会很慢；不要承诺固定显存下所有模型都能运行。Linux/macOS 用对应虚拟环境 Python 和官方设备安装命令。

便携版可在其目录使用内置 Python，按实际目录调整：

```powershell
.\python_embeded\python.exe -s .\ComfyUI\main.py --windows-standalone-build --listen 127.0.0.1 --port 8188 --enable-cors-header http://127.0.0.1:8102
```

网页来源须精确包含协议、主机和端口，例如桌面程序默认是 `http://127.0.0.1:17861`。端口冲突后来源可能变化。`--enable-cors-header '*'` 会允许任意网页跨域访问，应优先使用具体来源；CORS 不是身份验证。不要将无鉴权 ComfyUI 端口直接暴露到公网。

## 模型和节点

最小配置推荐 SDXL 标准。模型必须来自可信且有权使用的发布渠道；按照模型原作者说明下载，不要仅改文件名假装兼容。

| 档位/功能 | 默认文件位置 | 额外要求 |
|---|---|---|
| SDXL 标准 | `models/checkpoints/sd_xl_base_1.0.safetensors` | 核心 CheckpointLoaderSimple、CLIPTextEncode、KSampler、VAEDecode 等节点 |
| SDXL 草稿 | 上述 checkpoint + `models/loras/sdxl_lightning_4step_lora.safetensors` | 4 步 Lightning LoRA，LoraLoaderModelOnly 节点 |
| Z-Image | `models/diffusion_models/z_image_turbo_int8_convrot.safetensors`、`models/text_encoders/qwen_3_4b_fp8_mixed.safetensors`、`models/vae/ae.safetensors` | 与量化格式兼容的加载器、TextEncodeZImageOmni、ModelSamplingAuraFlow、EmptySD3LatentImage 等节点 |
| 透明抠图/换背景 | `models/background_removal/` 下的兼容模型 | LoadBackgroundRemovalModel、RemoveBackground、MaskToImage 节点，按所选节点包说明安装模型 |

节点是否齐全以 `/object_info` 为准，文件放到磁盘上不等于引擎已经识别。重启 ComfyUI 后再测试。Z-Image 的自定义量化权重及节点并非所有官方安装都自带，首次接入无需安装这一档。

浏览器直连与后端均可识别名称含 `sdxl`/`sd_xl` 的 checkpoint、含 `lightning` 的 LoRA，Z-Image 三个文件名默认匹配表格。源码模式可通过 `SDXL_CKPT`、`SDXL_LORA`、`ZIMAGE_UNET`、`ZIMAGE_CLIP`、`ZIMAGE_VAE` 指定其他兼容文件名；后端优先使用已安装的指定 SDXL 文件，未匹配时再按名称识别。这些变量不会改变浏览器直连的识别规则。

## 本机源码指定引擎

在 DreamCraft 项目目录执行：

```powershell
$env:COMFYUI_URL = 'http://127.0.0.1:8188'
$env:SDXL_CKPT = 'sd_xl_base_1.0.safetensors'
python serve.py --mode local --port 8102
```

开发启动器 `run.py` 可以复用已运行的 ComfyUI；自动启动的个人默认路径不一定适用于其他电脑，可设置 `COMFYUI_HOME`、`COMFYUI_BASE`，或先手动启动 ComfyUI。不需要使用原作者的 E 盘目录。`python stop.py` 默认只停止开发网页并保留 ComfyUI；使用自定义后端端口时传 `--port`。确需同时停止 8188 时显式使用 `--comfy`。

## 公网/局域网

局域网引擎需要监听网卡地址（如 `--listen 0.0.0.0`），并限制防火墙允许的来源。公开部署前加 HTTPS、身份验证、访问限额与隔离；ComfyUI 可执行节点，不应当作任意访客可直接调用的裸服务。当前 DreamCraft 仅支持地址配置，不能直接填写 Basic Auth、Bearer 自定义头或穿透服务登录 Cookie。需要鉴权的远程引擎应先做兼容适配，不能在 URL 中嵌入账号密码，公开模式会拒绝。

## 排障

| 问题 | 检查 |
|---|---|
| 地址能打开但测试失败 | 浏览器开发工具查看 CORS/本地网络权限；确认端口、网页来源和实际服务地址 |
| 显示未安装模型 | 查 `/object_info/CheckpointLoaderSimple` 的 ckpt_name；核对路径、文件名并重启 |
| 节点不存在 | 在 ComfyUI 原生工作流中复现，按所用模型和节点包说明安装；首次优先 SDXL 标准 |
| CUDA out of memory | 减小尺寸、批量设 1，关闭占用 GPU 的其他任务，按官方建议启用低显存模式 |
| 重绘/抠图不可用 | 后端必须能访问引擎，且蒙版、模型、图像处理节点完整 |
| 公开站点提示禁止内网地址 | 使用浏览器直连的基础图片流程，或在自己电脑运行整个应用；后端不会访问访客 127.0.0.1 |
| 视频生成不走本机 GPU | 当前没有本机视频工作流，需配置视频 API |

本项目不会自动安装自定义节点或下载模型，模型许可和自定义节点代码需自行审核。
