# API 接入与调用

本文适用于 DreamCraft（React/FastAPI 版）。仓库中的 DreamForge 是独立项目，配置不能混用。API 与模型的价格、配额、可用地区以供应商控制台为准；本应用不附送云端额度。

## 界面接入图片 API

1. 启动 DreamCraft，注册并登录，进入「引擎设置」。
2. 在「出图：自己的 Agnes API key」填写自己申请的密钥。
3. API 地址留空使用代码默认的 `https://api.agnes-ai.cn`；使用服务商提供的其他网关时填写根地址，例如 `https://your-gateway.example`，不要添加 `/v1/images/generations`。
4. 若希望使用云端图片，请清空 ComfyUI 地址。两者同时配置且 ComfyUI 可用时优先使用 ComfyUI。
5. 点「测试连接」再点「保存」，进入「AI 图片」，以一张低分辨率图片验证。

当前图片直连接口固定使用 `agnes-image-2.5-flash`，测试请求 `GET /v1/models` 并检查该模型是否在列表中，生成请求 `POST /v1/images/generations`。测试通过仍不代表余额充足。自定义根地址不代表任意 OpenAI 兼容图片服务都可直接使用，服务端必须支持对应模型、参数与响应结构。

图片配置按账号保存在当前浏览器。更换浏览器、域名、端口或账号后可能需要重新填写。图片生成可以由浏览器直接请求引擎；图像工具会把相关配置临时发送给 DreamCraft 后端。仅使用你信任的部署实例，公共电脑用后清除引擎配置及站点数据。

## 界面接入视频 API

进入同一页面的「视频」区域，选择平台、填写该平台的 Key，模型及根地址可留空采用默认值，点击「保存视频平台配置」。Key 输入框清空并出现「已配置」表示已保存，不会回显原 Key；留空再次保存会保持已有 Key。

| 平台 | 代码默认根地址 | 代码默认模型 |
|---|---|---|
| Agnes | `https://api.agnes-ai.cn` | `agnes-video-2.5-flash` |
| 硅基流动 | `https://api.siliconflow.cn` | `Wan-AI/Wan2.2-T2V-A14B` |
| 阿里百炼 | `https://dashscope.aliyuncs.com` | `wan2.6-t2v` |
| 智谱 | `https://open.bigmodel.cn` | `cogvideox-3` |
| 火山方舟 | `https://ark.cn-beijing.volces.com` | `doubao-seedance-1-0-pro` |

这些是当前适配器默认值，不保证你的账号已获模型权限。方舟等平台可能需要填控制台的推理接入点 ID；百炼等平台的地区与密钥须匹配。填入对应平台实际可调用的模型，根地址不包含提交接口路径。

视频配置按账号加密保存到后端。公开站点用户使用自己的配置，不回退站长密钥。本机 ComfyUI 视频生成尚未接入，请使用上述视频平台。Agnes 图片生成和参考图编辑已通过真实验收；视频平台曾返回队列已满，其余平台仍为模拟协议验证。最新结果见 [生成验收](generation-acceptance.md)。

首次打开首页可进入引擎引导，也可跳过；在「引擎设置」点击「首次使用引导」可重新打开。视频区域会显示当前账号的平台配置和后端 FFmpeg 检测结果，「重新检测」不提交生成任务。平台已配置只表示有 Key，实际权限、额度和排队状态仍以生成结果为准。

## 本机默认 API

桌面应用读取运行电脑已有的 API 环境变量；不会把打包电脑的环境变量带给别人。设置后须完全退出并重新启动应用。PowerShell 中临时设置仅影响从该终端启动的子进程：

```powershell
$env:AGNES_API_KEY = '填写自己的密钥'
$env:AGNES_API_ROOT = 'https://api.agnes-ai.cn'
python serve.py --mode local --port 8102
```

源码本机模式还支持 `app/backend/.env`，格式为 `变量名=值`，不写 shell 的 `export`，不加包裹引号。不要提交此文件。可选模型变量为 `AGNES_IMAGE_MODEL`、`AGNES_VIDEO_MODEL`、`AGNES_AGENT_MODEL`，仅作用于后端默认引擎，浏览器直连图片模型仍固定。Windows 安装包不读取源码 `.env`，优先推荐在界面配置个人引擎。

公开模式强制忽略站长 Agnes 环境变量和 `.env`，设置这些变量不会为公开用户提供默认算力。

## 从脚本调用 DreamCraft

DreamCraft 登录令牌和模型供应商 API Key 是两种凭证。不要把供应商 Key 当作 DreamCraft 的 Bearer 令牌。运行时接口说明在应用后端的 `/docs`，完整字段以 `/openapi.json` 为准。

以下 PowerShell 示例使用自己的账号登录并为该账号配置后端图片引擎。浏览器保存的出图设置不会自动配置脚本的后端引擎。

```powershell
$base = 'http://127.0.0.1:8102'
$login = Invoke-RestMethod "$base/api/auth/login" -Method Post -ContentType 'application/json' -Body (@{username='你的账号';password='你的密码'} | ConvertTo-Json)
$headers = @{Authorization = "Bearer $($login.token)"}
$config = @{agnes_key='你的供应商Key';agnes_root='https://api.agnes-ai.cn'} | ConvertTo-Json
Invoke-RestMethod "$base/api/biz/v1/engine/config" -Method Post -Headers $headers -ContentType 'application/json' -Body $config
$body = @{prompt='a green glass vase on a white table';model='default';aspect_ratio='1:1';resolution=512;n=1} | ConvertTo-Json
$task = Invoke-RestMethod "$base/lv/v1/editor/image/ai_model/submit_task" -Method Post -Headers $headers -ContentType 'application/json' -Body $body
$task.task_id
Invoke-RestMethod "$base/lv/v1/task/status/$($task.task_id)" -Headers $headers
```

成功返回 `task_id`，完成后状态为 `succeed`。图片提交当前会等待生成结果，视频提交后须轮询相同任务状态接口，处理 `failed` 和超时。公开模式先登录，后端引擎必须使用公网可达地址；不能配置服务器本机、内网或访客的 `127.0.0.1`。

## 常见问题

| 现象 | 处理 |
|---|---|
| 401/403 | 检查当前账号、Key 所属平台及有效期，重新登录；区分平台 Key 与应用 token |
| 余额不足、模型不可用 | 在供应商控制台检查余额、地区、模型权限和模型 ID |
| 测试通过但不能出图 | `/v1/models` 可达不代表图片模型可用；检查生成接口响应与 CORS |
| `Failed to fetch` | 检查浏览器网络面板的跨域、HTTPS 混合内容、代理和服务商 CORS |
| 保存后 Key 输入框为空 | 服务端按设计不回显密钥，查看「已配置」状态 |
| 更换账号后没有旧引擎 | 配置按账号隔离，需为当前账号单独配置 |
| 生成失败却已有扣费 | 本站积分与供应商账单独立，以供应商账单为准，不要连续重复提交 |

引擎配置不能让不兼容的平台自动变成兼容接口；新增图片协议应修改适配器并添加模拟协议回归。ComfyUI 连接方法见 [ComfyUI 部署](comfyui-setup.md)。
