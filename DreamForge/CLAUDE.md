# DreamForge 造梦工坊 — 项目约定

## 项目结构

```
DreamForge/
├── server.js               # 服务端：静态文件 + API + 任务引擎 + Provider 抽象（单文件，约 1400 行）
├── models.config.json      # 模型注册表 + provider 映射（4 个产品模型 ↔ 上游模型 ID）
├── package.json            # npm start / npm test；engines: node >= 18
├── .env.example            # 配置模板（真实的 .env 不入库）
├── .gitignore              # .env / node/ / public/videos/ / .dev/ / 便携包产物
├── .gitattributes          # 行尾统一：*.bat 强制 CRLF（否则 cmd 解析会错）
├── start.bat               # Windows 双击启动
├── 打包便携版.bat          # 生成便携包（内置 Key 安全闸）
├── public/                 # 前端三件套（无框架、无构建）
│   ├── index.html
│   ├── style.css
│   ├── app.js              # 全部前端逻辑
│   └── videos/             # 运行时生成的真视频（不入库）
├── tests/                  # 零依赖测试脚本（npm test）
└── 文档：README.md / 接入AgnesAI.md / 接入真实模型.md / 免费视频模型调研.md / 部署到公开链接.md / 使用说明.md
```

## 硬边界规则（改动时不可违反）

1. **零第三方依赖**：只用 Node 内置模块（`http` / `fs` / `path` / `crypto`），不引入 npm 包、不引入前端框架、不引入打包器。要破例先讨论。
2. **Key 永不外泄**：
   - `.env` 与系统环境变量是 Key 的唯一来源（本地模式）；
   - 公开模式下服务端**零持久化**：访客 Key 只存他自己浏览器的 localStorage，请求头透传，任务终态即从内存抹除（`scrubTaskKey`）；
   - 任何接口响应都不得包含 Key 值，`channelList` 只报布尔 `key_configured`。
3. **所有用户输入都要转义或白名单化**：
   - 进 HTML → 前端 `escapeHtml`；进 SVG → 服务端 `escapeXml`；
   - 数值/枚举参数（resolution、steps、duration）必须服务端白名单或 clamp；
   - 请求体字段用 `safeStr` / `safeNum` 转换，禁止直接 `String(obj)` / `Number(obj)`（会抛 TypeError → 500）。
4. **公开模式必须保持隔离与闸门**：任务按 `clientId` 归属（他人任务一律 404）、每访客在途上限 `MAX_RUNNING`、全局在途上限 60、无 clientId 不允许建任务。
5. **改动必须测试全绿**：`npm test`（5 套 115 项）。新增攻击面要补测试，不允许"改完手动试试就算"。

## 开发约定

- 服务端所有响应走 `sendJson()` / `serveStatic()`，安全响应头统一在 `SECURITY_HEADERS` 里维护，不要单独 `writeHead`。
- 静态文件只能读 `public/` 内的文件，路径穿越防护用「`PUBLIC_DIR` 严格前缀」判断，不要退回 `startsWith` 裸比较。
- 新增上游服务商：在 `models.config.json` 的 `providers` 加一段 + `buildUpstreamBody` 加一个分支 + `submitUpstream`/`pollProviderTasks` 各加一个分支，前端不用动。
- 前端状态更新用 `textContent`，拼 HTML 必须 `escapeHtml`；任务卡等增量更新要保留 `dataset.key` 判断，避免动画重启。
- 注释写「为什么」，不写「是什么」；遇到踩过的坑（如 LF 行尾的 .bat、`copy` 不支持多源文件）在代码里留一句原因。
- 中文文档文件名保持中文（`使用说明.md`、`部署到公开链接.md`），与仓库其他项目一致。
