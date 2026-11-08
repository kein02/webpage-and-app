# 网页部署

本文适用于仓库的 `DreamCraft/` 子目录。GitHub 保存源码和安装包；GitHub Pages 只能托管静态文件，不能运行 FastAPI、SQLite 或生成任务。可公开使用的完整网页需要持续运行的后端和持久化存储。

## 推荐：Docker Compose 同源部署

需要 Git、Docker Engine 与 Compose 插件。Windows 使用 Docker Desktop 的 Linux 容器模式。服务器需要能下载 npm、PyPI 和 Docker 镜像。本容器不包含 ComfyUI 或模型，不要求服务器有 GPU。

```bash
git clone https://github.com/kein02/webpage-and-app.git
cd webpage-and-app/DreamCraft
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:8100/api/runtime
```

预期返回 `{"mode":"public","default_engines":false,"local_comfy_proxy":false}`。打开 `http://127.0.0.1:8100`，注册账号，在引擎设置接入自己的 API，再测试生成。没有配置引擎时应明确提示配置，而不是消耗站长密钥。

镜像构建前端并由 FastAPI 同端口提供界面、API 和受保护媒体，不启动 Vite 开发服务器。Compose 默认仅映射宿主机 `127.0.0.1:8100`，避免裸端口直接暴露公网；正式发布配置下面的 HTTPS 反向代理。其他电脑访问测试可通过 SSH 隧道，或明确配置自己的防火墙及端口映射。

数据保存在 Compose 命名卷 `dreamcraft-data`，实际卷名带项目名前缀。默认在卷中生成 `.jwt-secret` 和 `.engine-key`，重建容器会保留；不要运行 `docker compose down -v`，它会删除数据卷。

常用运维命令：

```bash
docker compose logs --tail 100 dreamcraft
docker compose stop
docker compose start
# 更新前先按下文备份
git pull --ff-only
docker compose up -d --build
```

## HTTPS 与域名

域名解析到自己的服务器，开放 80/443；反向代理转发到本机 8100。安装 Caddy 后可使用如下 Caddyfile，将示例域名替换成实际域名：

```caddyfile
craft.example.com {
    request_body {
        max_size 30MB
    }
    reverse_proxy 127.0.0.1:8100 {
        transport http {
            response_header_timeout 600s
        }
    }
}
```

确保 DNS 和防火墙允许 Caddy 自动签发证书。后端当前不配置多个 worker。上线前在代理设置登录限流、合理超时、受信任代理来源，以及对内网、链路本地和云元数据地址的出站阻断。日志避免记录私人媒体 URL 中的 `access` 查询参数；不能把 uploads/exports 目录直接配置为公开静态目录。

## 源码启动

Python 3.11+、Node.js 20.19+ 或 22.12+，建议 Python 虚拟环境。Windows PowerShell：

```powershell
git clone https://github.com/kein02/webpage-and-app.git
cd webpage-and-app/DreamCraft
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r app/backend/requirements.txt
cd app/frontend
npm ci
npm run build
cd ../..
.\.venv\Scripts\python.exe serve.py --mode local --port 8102
```

本机访问 `http://127.0.0.1:8102`。本机模式会使用当前电脑 ComfyUI、API 环境变量及源码 `.env`，仅监听本机。为他人提供网页时改用公开模式和单独数据目录：

```powershell
.\.venv\Scripts\python.exe serve.py --mode public --port 8100 --data-dir ./local-data/public
```

Linux 源码部署使用 `.venv/bin/python`，按系统包管理器安装 Python venv、Node 和 FFmpeg，然后执行相同依赖安装及前端构建。通过 systemd 或平台进程管理器运行以下命令，工作目录设为 DreamCraft：

```bash
.venv/bin/python serve.py --mode public --port 8100 --data-dir /var/lib/dreamcraft
```

运行账号需对数据目录有读写权限。公开源码启动监听 `0.0.0.0`，应通过防火墙限制后端端口，只开放反向代理。不要把 `run.py` 的开发服务器直接作为生产服务。

## Railway / Vercel

优先在 Railway 将仓库根目录设置为 `DreamCraft`，使用本目录 Dockerfile 和 railway.json，挂载持久卷到 `/data`，暴露服务域名即可。镜像已包含前端，无需额外 Vercel。

需要分离部署时，在 Vercel 设置 Root Directory 为 `DreamCraft`，使用这里的 vercel.json；在**构建前**设置 `VITE_API_BASE=https://你的后端域名`。后端设置 `CORS_ORIGINS=https://你的前端域名`，两个域名都使用 HTTPS。前端构建变量不能存 API Key。后端仍需要持久卷；不支持用短时函数或纯静态托管代替长期任务进程。

托管套餐是否支持长时请求、磁盘持久化、出站访问、资源配额与付费以平台当前条款为准。部署嵌套项目必须设置 Root Directory，不能误用仓库中 DreamForge 的入口。

## 运行变量

| 变量 | 作用 |
|---|---|
| `DREAMCRAFT_MODE` | 默认 `public`；`local` 才启用本机默认引擎 |
| `DATA_DIR` | 持久化数据库和媒体目录；Docker 为 `/data` |
| `JWT_SECRET` | 可选的固定随机签名密钥；未设则保存 `.jwt-secret`，须持久化 |
| `DREAMCRAFT_CONFIG_KEY` | 可选 Fernet 密钥；未设则保存 `.engine-key`，须持久化 |
| `CORS_ORIGINS` | 逗号分隔的前端来源，分离部署请指定 HTTPS 来源 |
| `PORT` | 默认 8100；`serve.py --port` 可指定 |
| `FRONTEND_DIST` | 前端构建目录，容器已设 `/frontend` |
| `NO_LOCAL_ENV` / `COMFYUI_DISABLE` / `BYOK_ONLY` | 公开模式强制为 1，不能用环境变量关闭隔离 |

只有使用固定密钥需求时才手动设置 JWT/Fernet 变量；不要把密钥写进仓库。更换加密密钥会让已有引擎配置无法解密，必须保持稳定并备份。

## 备份与恢复

停止服务后备份整个数据目录，必须包括数据库、WAL/SHM（若存在）、`.jwt-secret`、`.engine-key`、uploads 和 exports。运行中不能只复制 SQLite 主数据库文件；在线备份需使用 SQLite backup API，并同步媒体与密钥。

Docker 方式可先停止服务，再把卷内容复制出来：

```bash
docker compose stop dreamcraft
docker compose cp dreamcraft:/data ./dreamcraft-backup
docker compose start dreamcraft
```

确认备份包含隐藏文件。恢复时停止服务，将备份内容整体放回同一数据卷，再启动；目录所有权需允许服务读写。源码模式同样在停止后复制整个指定 DATA_DIR。不要覆盖自己的正式数据来测试恢复。

## 验证与限制

2026-11-08 已在 Docker Desktop Linux 引擎实际构建镜像，并通过 `python tests/test_container.py`：界面与 API 同源提供、公开模式无默认引擎、账号及加密配置保存、FFmpeg drawtext/中文字体可用，替换容器后数据卷保留账号和配置。测试资源结束后清理。GitHub CI 同样构建并执行这项检查。

- `/api/runtime` 应返回公开模式且两个开关为 false；未登录提交生成返回 401。
- 注册后不配置引擎，图片/视频生成应拒绝；配置自己的引擎后再测试。
- 两个账号不能互看素材、任务、配置或私人媒体；退出后私人媒体访问失效。
- API 密钥加密保存且接口不回显，公开版不会继承站长密钥。服务器管理员控制整个系统，用户仍需信任部署者。
- 频率/并发状态在进程内，运行一个 worker；暂不支持多实例共享后台任务。正在执行的任务遇重启会失败并退款，供应商实际账单独立。
- 默认上限：20MB/1600 万像素图片、30MB 普通 JSON、64KB 认证/配置请求、200MB 远程媒体；每用户 3 个并发请求、6 个待处理任务。频率限制见代码与验收记录。
- GitHub Pages 不是完整应用部署；桌面包是本机模式，不能直接通过穿透公开成多人站点。

引擎安装见 [ComfyUI](comfyui-setup.md)，云端配置与脚本调用见 [API 接入](api-setup.md)。
