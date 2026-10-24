# DreamForge 造梦工坊

### ⬇️ 下载便携版（不用装任何环境，解压双击即用）

| 你的电脑 | 下载包 | 启动方式 |
| --- | --- | --- |
| **Windows** 10/11 | `DreamForge-Portable-Windows-v1.0.0.zip`（约 32MB） | 解压 → 双击 `start.bat` |
| **macOS**（M1/M2/M3…） | `DreamForge-Portable-macOS-AppleSilicon-v1.0.0.zip`（约 35MB） | 解压 → 双击 `start.command`（首次需右键 → 打开） |
| macOS（Intel）/ Linux | 下载源码，用你自己的 Node 18+ | `node server.js` |

**👉 [去 Releases 下载](https://github.com/kein02/webpage-and-app/releases/latest)**

> **🇨🇳 国内打不开 GitHub？** 用加速镜像（把下面整行复制到浏览器地址栏）：
>
> Windows：`https://ghfast.top/https://github.com/kein02/webpage-and-app/releases/download/dreamforge-v1.0.0/DreamForge-Portable-Windows-v1.0.0.zip`
>
> macOS：`https://ghfast.top/https://github.com/kein02/webpage-and-app/releases/download/dreamforge-v1.0.0/DreamForge-Portable-macOS-AppleSilicon-v1.0.0.zip`
>
> 镜像时好时坏：如果上面不通，把开头的 `https://ghfast.top/` 换成 `https://ghproxy.net/` 再试（这两个实测可用）。

> 包里已内置对应平台的 Node.js 运行时，对方**不需要装任何环境**；`.env` 是空模板，不含任何 Key。
> 启动后浏览器自动打开 `http://localhost:3000`，默认演示模式（零花费、不需要 Key）。



> 一个**能读懂**的 AI 视频生成工作台：复刻即梦AI 创作台的架构（服务端模型注册表 / 提交-轮询 / 草稿-直出 / 独立润色服务 / 页面内切换出片通道），零第三方依赖、零构建步骤。

| | |
| --- | --- |
| 项目定位 | 架构逆向分析的教学演示（基于理解的全新实现，不包含原程序任何代码，非官方） |
| 技术栈 | Node.js 18+（原生 `node:http`，**零第三方依赖**）+ 原生 HTML/CSS/JS（无框架无打包器） |
| 最省事的用法 | 下载 **Windows 便携版**（[Releases](https://github.com/kein02/webpage-and-app/releases/latest)）→ 解压 → 双击 `start.bat` |
| 源码运行 | `node server.js`（Node 18+，零依赖、无需 `npm install`） |
| 在线部署（可选） | Render / Zeabur 等任意支持长驻 Node 的平台，见《部署到公开链接.md》 |
| 出片模式 | 演示模式（免费 SVG）/ Agnes AI（免费通道，真 MP4）/ 火山方舟 Seedance（真 MP4 + 首帧图） |
| 测试 | `npm test` — 5 套、115 项断言，零依赖 |
| 许可证 | MIT |

---

一个**能读懂**的 AI 视频生成工作台，复刻自对即梦AI（dreamina.cutting.cn / jimeng.jianying.com）创作台的架构逆向分析。
它是基于理解的全新实现，不包含原程序的任何代码。

> ⚠️ **免责声明**：本项目为个人学习用途的架构分析与非官方复刻，与即梦AI / 字节跳动**无任何关联**，未获其授权或背书，也不包含其代码与素材。"即梦"等名称仅用于说明分析对象。请勿将本项目用于商业用途或冒充官方产品。
>
> **分析方式**：本项目仅基于**公开可见的交互行为**（页面操作流程、网络请求时序、公开接口的请求/响应结构）做架构学习，**未反编译其客户端、未绕过任何技术保护措施、未使用其任何代码、素材或凭证**。文中提及的产品名称仅用于说明分析对象。

> 三种出片模式：
> - **演示模式**（默认，零花费）：不调用外部模型，"生成结果"是程序化 SVG 动画，完整演示任务流转与产品形态。
> - **真实模式 · Agnes AI（免费通道）**：接入 Agnes AI 的 `agnes-video-2.5-flash`，产出真正的 MP4。720P、4–12 秒、每分钟 1 条、限时免费。接入方法见《接入AgnesAI.md》。
> - **真实模式 · 火山方舟（备用通道）**：接入火山方舟 Seedance 系列模型，支持首帧图（图生视频）、草稿样片、1080P。接入方法见《接入真实模型.md》。
>
> 两把 Key 都配时默认走 Agnes。切换通道有两种方式：
> - **页面内一键切换**（推荐）：点顶栏「⇄ 切换通道」或首帧图区域的「⚡ 切换到火山方舟通道」；目标通道没配 Key 会弹出**通道配置面板**，填入 Key 点「保存并切换」即可——Key 只写进本机 `.env`，立即生效，不用重启。
> - 传统方式：`.env` 里写 `DREAMFORGE_PROVIDER=volcengine` 强制指定，重启生效。

## 一、复刻了即梦的哪些设计

| 即梦的设计（逆向结论） | 本项目的对应实现 |
| --- | --- |
| 服务端 SSR 下发 `model_list`，前端零硬编码 | `GET /api/config` 下发模型注册表，前端只渲染不写死 |
| 提交 → 轮询 的异步任务契约 | `POST /api/generate` → `POST /api/queue_info` 轮询（800ms） |
| 任务状态机：排队 → 预处理 → 生成 → 审核 → 完成 | `server.js` 中同名状态机，每 200ms 推进一次 |
| 草稿模式（Seedance 2.5 样片）：先出 480P 预览，满意后直出高清 | 草稿任务 + `finalize` 直出任务（`parent_id` 关联）；真实模式走上游原生 `draft` 参数 |
| 加速（插队 + 剩余时间压缩） | 演示模式：`POST /api/task/:id/accelerate`，免费 |
| 独立提示词润色服务（create → query） | `POST /api/prompt/enhance` → 轮询 `GET /api/prompt/task/:id` |
| 图生视频（首帧预处理） | 首帧图上传：演示模式只传文件名，真实模式传 base64 图片内容 |

## 二、技术栈与架构

**一句话：Node.js 单文件服务端 + 原生 HTML/CSS/JS 前端，零第三方依赖、零构建步骤。**

这是个教学演示项目，核心价值是「能读懂」——所以刻意不用任何框架：全部代码可以一口气读到底，克隆下来 `node server.js` 直接跑，不需要 `npm install`。

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 运行时 | Node.js 18+ | 用到 18 起稳定的全局 `fetch`（真实模式调上游 API）；便携版内置 node.exe，对方零安装 |
| 服务端 | 原生 `node:http`，不用 Express | `server.js` 单文件约 1100 行：手写路由 + JSON API + 静态文件服务 + 任务引擎，同进程同端口 |
| 第三方依赖 | **无** | 没有 package.json，只 require 了 `http` / `fs` / `path` / `crypto` 四个内置模块 |
| 前端 | 原生 HTML/CSS/JS，无框架无打包器 | `index.html` + `style.css` + `app.js` 三个文件，直接由服务端 Serve；没有 React/Vue、没有 vite/webpack、没有 node_modules |
| 状态管理 | 服务端内存 | 任务队列、润色任务全在内存（重启清空）；模型注册表在 `models.config.json`；Key 在 `.env` |
| 出片通道 | Provider 抽象 | 一个 `PROVIDER` 对象四种实现（demo 程序化 SVG / agnes / volcengine / mock），页面内一键切换，任务按创建时的通道快照运行 |
| 上游通信 | 全局 `fetch` | 提交-轮询模式：POST 创建上游任务 → GET 轮询状态 → 拿到成品地址下载转存 `public/videos/`，再由本服务转发（上游链接有时效） |

**一次生成的完整链路**：

```
浏览器                    server.js（单进程）              上游（Agnes / 火山方舟）
  │ GET  /api/config  ──▶│ 下发模型注册表 + 通道清单
  │ POST /api/generate ─▶│ createTask 入队（内存），按参数排 timeline
  │ ◀── task_id          │
  │ POST /api/queue_info │ ◀── 前端每 800ms 轮询
  │ ◀── 状态/进度        │      tick() 每 200ms 推进状态机（演示模式）
  │                      │      submitUpstream() ── POST 创建任务 ──────▶│
  │                      │ ◀── GET 轮询状态（每 2s，429/5xx 退避重试）───│
  │                      │      下载 MP4 → public/videos/<id>.mp4
  │ ◀── video_url        │
```

**接口清单**（共 11 个，全部同端口）：

| 方法与路径 | 作用 |
| --- | --- |
| `GET /api/config` | 模型注册表 + 出片通道清单 + 公开部署标记（`public_mode`） |
| `POST /api/generate` | 提交生成任务（支持草稿模式 / 首帧图） |
| `POST /api/queue_info` | 一次拉走全部任务状态（对应即梦 `get_history_queue_info`） |
| `POST /api/task/:id/accelerate` | 加速（演示模式免费：插队 + 剩余时间减半） |
| `POST /api/task/:id/cancel` | 取消任务 |
| `POST /api/task/:id/finalize` | 样片「直出高清」（继承父任务通道与首帧图） |
| `GET /api/task/:id/export` | 下载作品（演示模式存 SVG，真实模式存 MP4） |
| `POST /api/prompt/enhance` | 提示词润色：提交（对应即梦独立润色服务） |
| `GET /api/prompt/task/:id` | 提示词润色：查询结果 |
| `POST /api/channel` | 切换出片通道（公开模式下为**会话级**切换：只解析请求头，不落任何服务端状态） |
| `POST /api/keys` | 配置 API Key，只收白名单变量：本地模式写入 `.env` 立即生效；公开模式只校验不存储 |

> 另有 `GET /mock-sample.mp4`（仅 mock 自测模式）给假上游提供样本视频。

## 三、文件清单（每个文件在哪、是什么）

```
dreamforge/
├── server.js               # 服务端：静态文件 + API + 任务引擎 + Provider 抽象（演示/真实·Agnes/真实·火山方舟/Mock）
├── models.config.json      # 模型注册表 + provider 映射：4 个产品模型 ↔ 上游模型 ID（agnes / volcengine 两段）
├── package.json            # npm start / npm test；声明 Node 18+
├── 部署到公开链接.md        # 部署到公网的通用指引：Zeabur / Render 等平台（可选）
├── CLAUDE.md               # 项目约定：结构、硬边界规则、开发约定
├── CHANGELOG.md            # 更新日志
├── LICENSE                 # MIT
├── .env.example            # .env 的空值模板（真实的 .env 不入库）
├── .gitignore              # 分享卫生：.env / public/videos / .dev / node/ 一律不入库
├── start.bat               # Windows 双击启动（等价于 node server.js）
├── README.md               # 本文件
├── 接入AgnesAI.md           # 免费通道接入指南：注册→拿 Key→写 .env→重启→验证
├── 接入真实模型.md          # 火山方舟接入指南：注册→实名→充值→开通模型→拿 Key→写 .env→重启
├── 免费视频模型调研.md       # 选型调研：四条免费路线对比（Agnes / 大厂额度 / 积分平台 / 开源本地）
├── 打包便携版.bat          # 双击生成「DreamForge-便携版.zip」（内置 Key 安全闸）
├── 使用说明.md             # 发给不懂编程的人时附在使用包里的图文步骤
├── node/node.exe           # 便携版专用：内置的 Node.js 运行时（84MB，不入库；打包 zip 时才需要）
├── tests/                  # 零依赖测试脚本（npm test），见 tests/README.md
│   ├── regression-smoke.mjs        # 本地全链路回归
│   ├── security-test.mjs           # 穿越 / 公开锁 / 响应零 Key
│   ├── visitor-isolation-test.mjs  # 双访客 Key 隔离（假上游）
│   ├── task-isolation-test.mjs     # 任务按浏览器隔离 + 越权拦截
│   ├── ui-public-test.mjs          # 前端公开模式分支（vm 垫片）
│   └── live-check.mjs / live-isolation-check.mjs  # 线上实测（域名/分享码走环境变量）
├── .dev/                   # 本机自测用：Mock 样本视频（不入库，可删）
└── public/
    ├── index.html          # 页面结构：左创作面板 / 右任务队列+作品库
    ├── style.css           # 暗色主题样式
    ├── app.js              # 前端逻辑：模型渲染、参数、提交、轮询、任务卡、作品库
    └── videos/             # 真实模式生成后自动转存的 MP4（运行时创建，不入库）
```

## 四、怎么跑起来（只需要 Node.js）

**前置条件**：装有 Node.js（任意 18+ 版本）。命令行输入 `node -v` 能打印版本号即可。

**从 GitHub 克隆**：

```bash
git clone <你的仓库地址> dreamforge
cd dreamforge
cp .env.example .env    # Windows：copy .env.example .env
node server.js
```

**启动（任选一种）**：

1. 双击 `start.bat`（会自动打开浏览器）；
2. 或在 PowerShell 中执行：

```powershell
cd 你放置 DreamForge 的目录\dreamforge
node server.js
```

看到下面这样的输出就是成功了（Key 都配好的话，出片模式一行会显示当前通道）：

```
  ◆ DreamForge 造梦工坊 已启动
  出片模式:     真实出片 · Agnes AI（免费通道）
  在浏览器打开:  http://localhost:3000
```

然后浏览器打开 **http://localhost:3000** 即可试玩。停止服务：在命令行按 `Ctrl + C`。

> 想产出真视频？打开《接入AgnesAI.md》（免费通道，推荐）或《接入真实模型.md》（火山方舟）按步骤配好 Key——也可以直接在页面顶栏点「⇄ 切换通道 → 通道配置」里粘贴 Key，保存即用。

## 五、分享给别人（两种方式，按对方会不会写代码选）

> **第一原则：API Key 永远不要离开你的电脑。** 本项目的 Key 只从两个地方读取：Windows 系统环境变量、项目里的 `.env` 文件。分享前按下面的自检清单确认这两处不外发。

### 方式 A：把项目发给对方，在他自己电脑上跑（推荐，最安全）

对方拿到后双击 `start.bat`（或 `node server.js`）就能跑，默认演示模式、零花费。真实出片需要对方自己配 Key——**你不需要、也不应该把你的 Key 给他**。

**分享前自检（30 秒）**：

1. 打开项目根目录的 `.env`，确认所有 Key 行都是空值（本仓库的 `.gitignore` 已把 `.env`、`.env.*`、`public/videos/`、`.dev/`、`node/` 列入忽略，用 git 分享不会带出去）；
2. 在项目文件夹里搜索 `sk-`，只应看到 `.env.example` 里的占位符，不应看到任何真实 Key；
3. 用压缩包分享的话，发之前解压检查一遍：包里要么没有 `.env`，要么它是空的。

> 对方电脑没装 Node.js？见下面的「方式 A+：便携版」，连运行时一起打包发过去。

### 方式 A+：便携版 zip——对方不用装任何东西（发给不懂编程的人首选）

把 Node.js 运行时一起打包进 zip，对方解压后**双击 `start.bat` 就能用**，不需要装 Node、不需要命令行、不需要配任何东西（默认演示模式）。包约 30MB，微信/网盘可直接传。

项目里的 `node/node.exe` 就是为此准备的（`start.bat` 会优先用它，找不到才用系统 Node）。

**打便携包（一键）**：双击项目里的 **`打包便携版.bat`**，等 30 秒左右，项目根目录就会生成 `DreamForge-便携版.zip`（约 32MB），脚本会自动打开资源管理器定位到它。脚本内置两道保险：

1. **Key 安全闸**：打包前扫描 `.env`，一旦发现 `sk-` 开头的 Key 内容就拒绝打包并提示——防止你的 Key 被打进包泄露；
2. 只收运行必需文件（服务端/前端/文档/内置 Node），自动排除 `.dev/`、`public/videos/` 等本机产物。

对方拿到后只需要三件事：**解压 → 双击 `start.bat` → 第一次启动时防火墙弹窗点「允许访问」**。其余步骤都写在包里的《使用说明.md》上，把 zip 和使用说明一起转发给对方即可。

### 方式 B：部署成公网链接，发给所有人（推荐打开「公开部署锁」）

> 想要一个**干净的公开域名**（任何人点开即用）？用 Zeabur / Render 等平台部署，见 [《部署到公开链接.md》](部署到公开链接.md)；下面这套是用自己的电脑/服务器起服务时用的。

沙箱类平台没有环境变量界面，配置靠项目里的 `.env` 传。**部署前**先把 `.env` 里这两行设上（Key 行保持为空！）：

```
DREAMFORGE_PROVIDER=demo
DREAMFORGE_PUBLIC=1
```

然后启动服务（`node server.js`）即可。部署完成后可以把 `.env` 恢复成注释掉的模板状态——线上的副本已经带上了配置，不影响访客使用。

打开 `DREAMFORGE_PUBLIC=1` 之后：

- **访客可以自带 Key 出真片**：每个人在页面「⇄ 切换通道」里粘贴自己的 API Key，Key 只存在他自己浏览器的 localStorage，服务器不存储、不回显；出片走各自的额度，互不干扰（请求头透传，服务端零持久化，任务终态后内存抹除）；
- **任务列表按访客隔离**：每个浏览器会得到一个匿名 ID，只能看到自己创建的任务——别人的提示词、成品视频、失败原因都不可见，也操作不了别人的任务；部署者自己调试产生的任务不会出现在访客界面里；
- 没带 Key 的访客自动落在**演示模式**：程序化 SVG 动画，不调外部模型、不花任何钱；
- 接口地址只认 Agnes 两个官方域名（防止服务被当成任意 URL 的请求代理）；
- 任务参数白名单校验（防 XSS 偷 Key）；
- 其余功能（草稿 / 直出 / 润色 / 导出 / 加速）全部正常，适合给别人体验产品形态。

> ⚠️ 千万不要带着已配 Key 的环境直接部署公网。虽然访客 Key 机制下服务器不存任何人的 Key，但部署者自己的 Key 一旦进入公网服务进程，所有访客的任务都会记在你头上。

### 钥匙已经外泄过？必须轮换（旧 Key 作废重办）

只要一把 Key 出现过在任何可能被第三人看到的载体里（聊天记录、文档、截图、旧版本仓库），就当它已经泄露，**删旧建新**：

| 通道 | 轮换位置 | 步骤 |
| --- | --- | --- |
| Agnes AI | platform.agnes-ai.cn（或 .com，看你当初在哪注册）的 API Key 管理页 | ① **删除**旧 Key（立即失效）→ ② 创建新 Key（只显示一次，立即复制）→ ③ 改 Windows 系统环境变量 `AGNES_API_KEY`（Win 键搜"环境变量"→编辑）→ ④ 关掉旧命令行窗口重开，启动后顶栏显示「真实出片 · Agnes AI」即成功 |
| 火山方舟 | 火山方舟控制台的 API Key 管理 | 同上：删除旧 Key → 创建新 Key → 改系统环境变量 `VOLC_API_KEY` → 重启验证 |

## 六、玩法指引（5 分钟走完所有功能）

1. **选模型**：左边选一张模型卡（样片模式先出预览、满意再直出，推荐先试它）。
2. **写提示词**：输入描述，或点「✨ AI 润色提示词」——它会先识别你写的主体（食物/动物/人物/风景/城市/科技/产品/幻想），只补缺的镜头、光影与画质描述；你已写过的风格不重复，时段氛围冲突时不硬凑（宁缺毋滥）。
3. **调参数**：时长、分辨率、采样步数；支持草稿的模型会出现「草稿模式」开关；支持图生视频的模型可以传首帧图。
4. **切换通道**：当前通道不支持首帧图时（如 Agnes 免费通道），首帧图区域会出现「⚡ 切换到火山方舟通道」按钮，点一下即可；火山方舟按量付费，没配 Key 会弹出配置面板让你现场填。顶栏「⇄ 切换通道」随时打开通道面板（演示 / Agnes / 火山方舟）。
5. **开始生成**：点「🚀 开始生成」，右侧任务队列出现任务卡，状态在 排队→预处理→生成中→审核中→完成 之间流转，带进度条和剩余时间。
6. **试草稿策略**：样片就绪后先看 480P 样片——不满意直接取消，不浪费等待时间；满意点「🎬 直出高清」。
7. **试加速**（演示模式）：任务运行中点「⚡ 加速」，免费把剩余时间压缩一半。
8. **下载**：完成后的作品在「作品库」，也可在任务卡点「⬇ 下载」保存文件（演示模式存 SVG，真实模式存 MP4）。

## 七、测试

零依赖、纯 Node 脚本，不需要装任何测试框架：

```bash
npm test     # 依次跑：回归 → 安全 → 访客 Key 隔离 → 任务隔离 → 前端 UI
```

共 5 套、100+ 断言，覆盖：本地全链路、目录穿越与畸形请求、公开部署锁、响应零 Key、双访客 Key 不串台、任务按浏览器隔离与越权拦截、前端公开模式分支。详见 [tests/README.md](tests/README.md)。

## 八、常见问题

| 现象 | 原因与解决 |
| --- | --- |
| 提示 `端口 3000 已被占用` | 换端口启动：PowerShell 里 `$env:PORT=3001; node server.js`，然后开 http://localhost:3001 |
| 提示 `'node' 不是内部或外部命令` | 没装 Node.js 或没加进 PATH。装完关掉窗口重开，`node -v` 有输出即可 |
| 页面显示「连接失败」 | 服务没启动，或启动页已被关掉。重新跑 `node server.js` 再刷新页面 |
| 顶栏显示「演示模式（未配置 Key）」 | 想真实出片但 Key 没配好，按《接入AgnesAI.md》第 3–4 步检查；注意**系统环境变量优先于 .env** |
| 顶栏是「演示模式」但明明配了 Key | 检查 Windows 系统环境变量里有没有旧 Key / `DREAMFORGE_PROVIDER=demo`，改完关掉窗口重开 |
| 首帧图选不了 / 提示"当前通道不支持" | Agnes 免费通道只收公网图片 URL，不支持本地首帧图。点首帧图区域的「⚡ 切换到火山方舟通道」一键切换（按提示配 Key） |
| 切换通道后，正在跑的任务会断吗 | 不会。每个任务记住自己创建时的通道，在途任务按原通道继续提交/轮询；切换只影响新任务 |
| 重启后任务没了 | 状态在内存里，演示用。想要持久化可以把 `tasks` 存到 JSON 文件 |
| 怎么分享给别人用 | 见上文「分享给别人」：发给对方自己跑（方式 A，推荐）或公网部署（方式 B，必须 `DREAMFORGE_PUBLIC=1` 且不配 Key） |

## 九、如何换成其他模型 / 其他服务商

`server.js` 里有一个带注释的函数 `buildResultSvg(t)`——演示模式用它把任务参数变成 SVG 动画。
真实模式的接入逻辑集中在 `buildUpstreamBody(t)`（翻译请求体，Agnes 通道在 `buildAgnesBody(t, map)`）/ `submitUpstream(t)` / `pollProviderTasks()` 三个函数：
- 换模型：改 `models.config.json` 里对应 provider 段的 `map`（上游模型 ID、时长范围、分辨率）
- 换服务商：照 agnes 段的样子加一个新 provider 段 + `buildUpstreamBody` 里加一个分支，前端不用动
- 当前已内置两个真实通道：`agnes`（Agnes AI 免费通道，1 RPM、文生视频、720P/4–12s）与 `volcengine`（火山方舟，支持首帧图与草稿样片）

## 十、边界说明

- 无用户系统、无数据库、无鉴权，单机演示。
- 任务列表接口每次最多回 40 条（对应即梦 `get_history_queue_info` 的窗口）；内存里最多保留 200 条任务记录，超出只回收终态任务（在途任务与"样片就绪"不受影响），被回收任务的视频文件一并删除；润色任务最多保留 100 条。
- 静态文件服务做了目录穿越防护（只允许读 `public/` 内的文件）；请求体上限 16MB；畸形 URL / 畸形 JSON 返回 400。
- 统一安全响应头：CSP、X-Content-Type-Options、X-Frame-Options、Referrer-Policy、Permissions-Policy、HSTS。
- 请求体字段做类型收敛（`safeStr`/`safeNum`）：传对象、数组、`{toString:1}` 这类畸形值不会触发 500。
- 公网部署（`DREAMFORGE_PUBLIC=1`）时：任务按访客浏览器隔离（别人看不到也操作不了你的任务）；每个访客最多 2 个在途任务、全局上限 60 个，防脚本刷爆队列；`/api/channel`、`/api/keys` 不落任何服务端状态。
- 真实模式取消任务不保证上游退款（与即梦一致）；上游官方计费只收成功生成的视频，失败不收费。
- 真实模式的视频下载到本地 `public/videos/` 后由本服务转发（上游视频链接有时效）。
- Agnes 免费通道：只支持文生视频（传本地首帧图会被友好拒绝，页面会给一键切换入口）、720P、4–12 秒、1 RPM 串行提交；429/5xx 自动退避重试 3 次。
- 火山方舟通道：需要 `VOLC_API_KEY`；支持首帧图、草稿样片、加速之外的更高参数。
- 出片通道可在页面内随时切换（`POST /api/channel`），Key 可经通道配置面板写入 `.env`（`POST /api/keys`，仅限白名单变量）；任务按创建时的通道快照运行，切换不影响在途任务。
