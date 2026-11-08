# 部署说明

部署步骤统一维护在 [网页部署指南](docs/deployment.md)，包括 Docker Compose、源码启动、HTTPS、Railway/Vercel、备份和运行限制。

- [API 接入与调用](docs/api-setup.md)
- [ComfyUI 部署与连接](docs/comfyui-setup.md)
- [Windows 使用与构建](docs/windows.md)

公开模式不提供站长默认算力；每个用户登录后配置自己的引擎。本机调试使用 `python serve.py --mode local --port 8102`，公开部署使用 `public` 和独立数据目录。
