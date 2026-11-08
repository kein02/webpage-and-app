# 参与开发

本目录是 DreamCraft（React/FastAPI 版），仓库中的 DreamForge、TimerReminder 独立维护。问题报告请注明项目、版本、系统、启动方式和复现步骤，附脱敏错误信息；不要贴 API Key、token、私有作品地址或数据库。

## 环境

Python 3.11+、Node.js 20.19+ 或 22.12+。安装后端依赖并执行 `npm ci`、`npm run build`，完整步骤见 [部署文档](docs/deployment.md)。开发热更新可用 `python run.py`，本机不需要新启 ComfyUI 时先启动自己的桌面端。

## 提交前

```powershell
python -m pip install -r app/backend/requirements.txt
python -m pip install httpx playwright
python -m playwright install chromium
python tests/test_backend.py
python tests/test_public_security.py
python tests/test_modes.py local
python tests/test_modes.py public
python tests/test_release_browser.py
```

浏览器测试使用模拟引擎；`test_local.py`、`test_direct.py` 等 GPU 脚本会访问真实本机引擎，历史脚本可能提交付费请求，不属于常规自动回归。Windows 安装回归要求当前不存在已安装的 DreamCraft 或同名快捷方式，详见 [Windows 验收](docs/windows-acceptance.md)。

仅改动相关模块，新增协议通过模拟响应验证；改动公开模式必须保留站长密钥隔离、内网请求限制及文件所属账号鉴权。应用当前只支持单 worker。

提交前检查暂存清单，排除 `.env`、数据库、`.jwt-secret`、`.engine-key`、uploads、exports、运行日志和个人截图。安装器与 ZIP 放 GitHub Releases，不提交 Git。
