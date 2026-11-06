# 测试

全部是纯 Node 脚本，**零依赖**，不需要装任何测试框架。每个脚本自己起服务、跑断言、退出时清理。

```bash
# 一把梭（推荐）：按顺序跑全部离线测试
npm test

# 或者单独跑
node tests/regression-smoke.mjs        # demo 模式全链路：润色→样片→直出→导出→取消
node tests/security-test.mjs           # 目录穿越 / 公开锁 / 响应零 Key / 路径与体积
node tests/visitor-isolation-test.mjs  # 双访客各自 Key 隔离（假上游比对 Authorization）
node tests/task-isolation-test.mjs     # 任务按浏览器隔离 + 跨访客越权拦截
node tests/ui-public-test.mjs          # 前端公开模式分支（vm + 迷你 DOM 垫片）
```

预期输出：每个脚本最后打印 `========== N 通过 / 0 失败 ==========`，退出码 0。

## 线上验证（可选）

部署后想验证公网实例，自己传域名与分享码（脚本不内置任何真实链接，避免凭证进仓库）：

```bash
DF_BASE=https://你的域名 DF_SC=你的分享码 node tests/live-check.mjs
DF_BASE=https://你的域名 DF_SC=你的分享码 node tests/live-isolation-check.mjs
```

## 各脚本覆盖什么

| 脚本 | 覆盖点 |
| --- | --- |
| `regression-smoke` | 本地单机全链路：提示词润色、草稿样片、直出、SVG 导出、取消任务 |
| `security-test` | 14 种目录穿越 payload、畸形 URL、公开部署锁、响应零 Key、`.env` 不被改写 |
| `visitor-isolation-test` | 两个访客各带自己的 Key，假上游收到的 `Authorization` 必须分别是各自的；接口地址白名单（防 SSRF）；resolution 注入归一化 |
| `task-isolation-test` | 任务列表按浏览器隔离、跨访客 cancel/accelerate/finalize/export 一律 404、无 clientId 看不到任务、本地模式仍全量可见 |
| `ui-public-test` | 前端公开模式：Key 存 localStorage、请求头透传、切换通道分支、配置面板渲染、清除 Key、本地模式不受影响 |
