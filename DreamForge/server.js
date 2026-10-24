#!/usr/bin/env node
/**
 * DreamForge 造梦工坊 —— 本地零依赖演示服务（Node.js 原生 http，无需 npm install）
 *
 * 这是一个"可读懂"的 AI 视频生成工作台，复刻自对即梦AI的架构分析：
 *   1. 服务端下发模型注册表（前端零硬编码，对应即梦 SSR 下发的 model_list）
 *   2. 提交 → 轮询 的异步任务契约（POST /api/generate → POST /api/queue_info）
 *   3. 任务状态机：排队 → 预处理 → 生成中 → 审核中 → 完成
 *   4. 草稿模式：480P 样片 → 满意后"直出高清"（对应 Seedance 2.5 样片模式）
 *   5. 加速（插队）与取消
 *   6. 独立的提示词润色服务（create → query，对应 prompt_enhancement）
 *
 * 注意：本服务不调用任何外部 AI 模型。"生成结果"是程序化生成的 SVG 动画，
 * 用来演示任务流转与产品形态；接入真实模型的位置在 buildResultSvg() 上方有注释说明。
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const VIDEOS_DIR = path.join(PUBLIC_DIR, 'videos');
const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'models.config.json'), 'utf8'));

const MAX_RUNNING = CONFIG.app.max_running || 2;
const TICK_MS = 200;

/* ---------------- .env 读取（不依赖 dotenv） ----------------
 * 在 dreamforge\.env 里写 VOLC_API_KEY=你的密钥，保存后重启服务即可。
 * 环境变量优先于 .env 文件。 */
function loadEnvFile() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnvFile();

/* 把变量写进 .env（页面「通道配置」用）：已存在则整行替换，不存在则追加。
 * 保留文件里既有的注释与其他行；沿用原文件的换行风格（Windows 下为 CRLF）。
 * 注意：若同名变量已设在 Windows 系统环境变量里，重启后系统环境变量仍优先——
 * 但当前进程内 process.env 已被本函数更新，页面切换立即生效。 */
function saveEnvVar(name, value) {
  const file = path.join(__dirname, '.env');
  let text = '';
  if (fs.existsSync(file)) text = fs.readFileSync(file, 'utf8');
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const lines = text ? text.split(/\r?\n/) : [];
  const re = new RegExp('^\\s*' + name + '\\s*=');
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) { lines[i] = name + '=' + value; found = true; }
  }
  if (!found) {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    lines.push(name + '=' + value);
  }
  fs.writeFileSync(file, lines.join(eol) + eol);
}

/* ---------------- Provider 选择 ----------------
 * demo       ：不接外部服务，用程序化 SVG 动画演示任务流转（零花费）
 * volcengine ：接火山方舟 Seedance 真实出片（需要 .env 配置 VOLC_API_KEY）
 * agnes      ：接 Agnes AI 视频 API 真实出片（需要 .env 配置 AGNES_API_KEY，免费通道）
 * mock       ：本地模拟上游 API，用于开发自测（不花钱、不出真片）
 * active=auto 时：优先检测 AGNES_API_KEY（免费通道），其次 VOLC_API_KEY，都没有则回退 demo。
 * 可用环境变量 DREAMFORGE_PROVIDER 强制指定：demo / volcengine / agnes / mock
 * 运行时可切换（页面「切换通道」按钮 → POST /api/channel）：forceName 优先于环境变量；
 * 切到没配 Key 的通道时会回退 demo，由调用方比较 name 识别并提示用户先去配置。 */
const PROVIDER_CONF = CONFIG.providers || {};
/* 解析出片通道。forceName：强制指定通道名（优先于环境变量）。
 * visitor（公开模式）：访客自带 Key——{ apiKey, channel, apiRoot }。
 * 访客指定了通道时他的 Key 只喂给那个通道；未指定时两个通道都认（按 agnes 优先）。
 * 注意：返回对象含 apiKey，是内部对象，绝不能整个下发前端（用 publicProvider 过滤）。 */
function resolveProvider(forceName, visitor) {
  const envChoice = (process.env.DREAMFORGE_PROVIDER || '').toLowerCase();
  const choice = forceName || (visitor && visitor.channel) || envChoice || (PROVIDER_CONF.active || 'auto');
  if (choice === 'mock') return { name: 'mock', label: 'Mock 测试模式', requested: 'mock', reason: '本地模拟上游，用于自测' };
  if (choice === 'demo') return { name: 'demo', label: '演示模式', requested: 'demo', reason: '已强制指定演示模式' };
  // 汇总两个真实通道的配置与 Key 检测结果
  const vKey = visitor && visitor.apiKey ? visitor.apiKey : '';
  const channels = ['agnes', 'zhipu', 'siliconflow', 'minimax', 'volcengine'].map((name) => {
    const c = PROVIDER_CONF[name] || {};
    const envName = c.api_key_env || (name === 'agnes' ? 'AGNES_API_KEY' : 'VOLC_API_KEY');
    const apiKey = vKey && (!visitor.channel || visitor.channel === name) ? vKey : (process.env[envName] || '');
    return { name, conf: c, envName, apiKey };
  });
  // 强制指定某个通道时只检测它的 Key；auto 时按 [agnes, volcengine] 顺序取第一个有 Key 的
  const REAL_CHANNELS = ['agnes', 'zhipu', 'siliconflow', 'minimax', 'volcengine'];
  const wanted = REAL_CHANNELS.includes(choice) ? channels.filter((c) => c.name === choice) : channels;
  const ready = wanted.find((c) => c.apiKey);
  if (!ready) {
    const missing = wanted.map((c) => c.envName).join(' / ');
    const wantName = REAL_CHANNELS.includes(choice) ? choice : 'agnes/zhipu/siliconflow/minimax/volcengine';
    return { name: 'demo', label: '演示模式', requested: wantName, reason: (visitor ? '还未填写 ' : '未在 .env 中检测到 ') + missing + (visitor ? '：在「切换通道」面板粘贴你自己的 Key 即可' : '，已回退演示模式') };
  }
  if (ready.name === 'agnes') {
    return {
      name: 'agnes',
      label: '真实出片 · Agnes AI（免费通道）',
      requested: 'agnes',
      reason: '',
      apiKey: ready.apiKey,
      apiRoot: (visitor && visitor.apiRoot) || process.env.AGNES_API_ROOT || ready.conf.api_root || 'https://apihub.agnes-ai.com',
      pollMs: ready.conf.poll_interval_ms || 3000,
      max_parallel: 1,               // 免费档 1 RPM：同时只提交 1 条，避免 429
      supports_first_frame: false,   // keyframe 模式只收公网图片 URL，本地图需图床
      aspect_ratio: ready.conf.aspect_ratio || '16:9',
    };
  }
  if (ready.name === 'zhipu') {
    return {
      name: 'zhipu',
      label: '真实出片 · 智谱 CogVideoX（免费）',
      requested: 'zhipu',
      reason: '',
      apiKey: ready.apiKey,
      baseUrl: process.env.ZHIPU_BASE_URL || ready.conf.base_url || 'https://open.bigmodel.cn/api/paas/v4',
      pollMs: ready.conf.poll_interval_ms || 5000,
      supports_first_frame: false, // image_url 只收公网图片地址，本地图转 dataURL 上游不认
      watermark: true,             // 免费档返回值带 _watermark 文件，属官方行为
    };
  }
  if (ready.name === 'siliconflow') {
    return {
      name: 'siliconflow',
      label: '真实出片 · 硅基流动 Wan 2.2',
      requested: 'siliconflow',
      reason: '',
      apiKey: ready.apiKey,
      baseUrl: process.env.SILICONFLOW_BASE_URL || ready.conf.base_url || 'https://api.siliconflow.cn/v1',
      pollMs: ready.conf.poll_interval_ms || 4000,
      supports_first_frame: true, // image 字段支持 data:image/...;base64
      result_ttl_note: '结果链接仅 10 分钟有效，服务端会立刻下载落地',
    };
  }
  if (ready.name === 'minimax') {
    return {
      name: 'minimax',
      label: '真实出片 · MiniMax 海螺',
      requested: 'minimax',
      reason: '',
      apiKey: ready.apiKey,
      baseUrl: process.env.MINIMAX_BASE_URL || ready.conf.base_url || 'https://api.minimaxi.com',
      pollMs: ready.conf.poll_interval_ms || 6000,
      supports_first_frame: true, // first_frame_image（公网 URL）
    };
  }
  return {
    name: 'volcengine',
    label: '真实出片 · 火山方舟 Seedance',
    requested: 'volcengine',
    reason: '',
    apiKey: ready.apiKey,
    baseUrl: process.env.VOLC_BASE_URL || ready.conf.base_url || 'https://ark.cn-beijing.volces.com/api/v3',
    pollMs: ready.conf.poll_interval_ms || 8000,
    supports_first_frame: true,
  };
}
let PROVIDER = resolveProvider(); // 运行时可切换（POST /api/channel），不要当成常量用

/* 公开部署锁：部署成公网链接给大家用时设 DREAMFORGE_PUBLIC=1。
 * 开启后服务端不持有任何访客的 Key：访客在页面填自己的 Key，只存他自己浏览器的
 * localStorage，之后每个请求经头信息带上来（X-DreamForge-Key），服务端零存储、
 * 零回显，仅在处理该请求期间使用，任务终态后从内存抹除。
 * 本地自己用不受影响（默认关闭）：Key 走系统环境变量 / .env，行为与以前完全一致。 */
const PUBLIC_MODE = process.env.DREAMFORGE_PUBLIC === '1' || process.env.DREAMFORGE_PUBLIC === 'true';

/* ---- 访客自带 Key（仅公开模式生效）----
 * 头信息：
 *   X-DreamForge-Channel  agnes | volcengine（访客选的通道）
 *   X-DreamForge-Key      访客的 API Key
 *   X-DreamForge-Key-Root （可选）Agnes 接口地址，只认两个官方域名——防止把服务
 *                         当成任意 URL 的请求代理（SSRF），也防止 Key 被带去第三方站点 */
const VISITOR_KEY_HEADER = 'x-dreamforge-key';
const VISITOR_CHANNEL_HEADER = 'x-dreamforge-channel';
const VISITOR_ROOT_HEADER = 'x-dreamforge-key-root';
/* 访客匿名 ID（任务隔离用）：前端首次访问生成、存 localStorage，之后每个请求带上。
 * 公开模式下任务按它归属——A 的任务 B 看不到、也操作不了，避免"测试任务污染所有人"
 * 和"别人用他的 Key 出的片被围观/白嫖"。本地模式不使用（单机全量可见）。 */
const VISITOR_CLIENT_HEADER = 'x-dreamforge-client';
const AGNES_ROOTS = ['https://api.agnes-ai.cn', 'https://apihub.agnes-ai.com'];
const MAX_KEY_LEN = 512;

// 只接受字母数字和短横线，长度也限死（这个值会进内存做归属比对，不接受奇怪字符）
function readClientId(req) {
  const v = String(req.headers[VISITOR_CLIENT_HEADER] || '').trim();
  if (!v || v.length > 64 || !/^[A-Za-z0-9-]+$/.test(v)) return '';
  return v;
}

function readVisitor(req) {
  if (!PUBLIC_MODE) return null; // 本地模式不读请求头，Key 只认系统/.env
  const apiKey = String(req.headers[VISITOR_KEY_HEADER] || '').trim();
  if (!apiKey || apiKey.length > MAX_KEY_LEN) return null;
  if (/[\r\n\s]/.test(apiKey)) return null; // Key 不该含空白/换行
  const ch = String(req.headers[VISITOR_CHANNEL_HEADER] || '').toLowerCase();
  let apiRoot = String(req.headers[VISITOR_ROOT_HEADER] || '').trim();
  if (apiRoot && !AGNES_ROOTS.includes(apiRoot)) apiRoot = ''; // 非官方域名直接忽略
  return { apiKey, channel: ch === 'agnes' || ch === 'volcengine' ? ch : '', apiRoot };
}

// 本次请求应该用哪个通道：本地模式=全局 PROVIDER（页面切换的那个）；
// 公开模式=按访客请求头解析（访客没带 Key 就回落服务端默认，公网部署即 demo）
function effectiveProvider(req) {
  if (!PUBLIC_MODE) return PROVIDER;
  const v = readVisitor(req);
  if (!v) return PROVIDER;
  return resolveProvider(v.channel || undefined, v);
}
function providerMap(modelKey, providerName) {
  return ((PROVIDER_CONF[providerName || PROVIDER.name] || {}).map || {})[modelKey] || null;
}

/* ---------------- 通道清单（供页面「切换通道 / 通道配置」使用） ----------------
 * key_configured 只报"有没有配"，绝不把 Key 值本身下发到前端。
 * 公开模式下它表示"这个请求有没有带对应 Key"（访客自带 Key 的场景），而不是服务端配没配。 */
const CHANNEL_DEFS = [
  { name: 'agnes', label: 'Agnes AI · 免费通道', cost: '限时免费：720P · 4–12 秒 · 每分钟 1 条（不支持本地首帧图）', supports_first_frame: false, key_env: 'AGNES_API_KEY' },
  { name: 'zhipu', label: '智谱 CogVideoX · 免费', cost: '0 元（带水印）：720P/1080P · 5–10 秒 · 高峰可能排队', supports_first_frame: false, key_env: 'ZHIPU_API_KEY' },
  { name: 'siliconflow', label: '硅基流动 · Wan 2.2', cost: '约 2 元/条（5 秒 720P）：开源模型、支持首帧图、注册送额度', supports_first_frame: true, key_env: 'SILICONFLOW_API_KEY' },
  { name: 'minimax', label: 'MiniMax · 海螺', cost: '约 ¥0.3/秒（768P）：原生音频、主体参考、失败不计费', supports_first_frame: true, key_env: 'MINIMAX_API_KEY' },
  { name: 'volcengine', label: '火山方舟 · Seedance', cost: '按量付费：支持首帧图 / 草稿样片 / 高清（新用户有免费额度）', supports_first_frame: true, key_env: 'VOLC_API_KEY' },
  { name: 'demo', label: '演示模式', cost: '零花费：程序化 SVG 演示，不出真片', supports_first_frame: true, key_env: null },
];
function channelList(effective, visitor) {
  const eff = effective || PROVIDER;
  return CHANNEL_DEFS.map((d) => ({
    name: d.name,
    label: d.label,
    cost: d.cost,
    supports_first_frame: d.supports_first_frame,
    key_env: d.key_env,
    key_configured: d.key_env
      ? (PUBLIC_MODE
          ? !!(visitor && visitor.apiKey && (!visitor.channel || visitor.channel === d.name))
          : !!process.env[d.key_env])
      : true,
    active: eff.name === d.name,
  }));
}
function publicProvider(p) {
  return {
    name: p.name,
    label: p.label,
    requested: p.requested,
    reason: p.reason || '',
    supports_first_frame: p.supports_first_frame !== false, // demo/mock 未显式声明 → 支持
  };
}

/* ---------------- 内存状态（重启后清空，演示用） ---------------- */
const tasks = [];                 // 新任务在前
const promptTasks = new Map();    // 提示词润色任务
// 公网分享给很多人用时，防止内存/磁盘无限增长：只保留最近的记录，且只淘汰终态任务
const TASK_KEEP_MAX = 200;
const PROMPT_TASK_KEEP_MAX = 100;
const TERMINAL_STATES = ['done', 'finalized', 'failed', 'canceled'];
const INFLIGHT_STATES = ['queued', 'preprocessing', 'generating', 'auditing']; // 在途（占用队列的任务）

/* ---------------- 小工具 ---------------- */
const now = () => Date.now();
const rid = (p) => p + '_' + crypto.randomBytes(5).toString('hex');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* 请求体字段的安全转换：攻击者可以传 { toString: 1 } 这类对象，
 * 直接 String()/Number() 会抛 "Cannot convert object to primitive value" → 500。
 * 这里只接受原始类型，其余一律当空/默认值。 */
function safeStr(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}
function safeNum(v, fallback) {
  const n = typeof v === 'number' ? v : Number(typeof v === 'string' ? v : NaN);
  return Number.isFinite(n) ? n : fallback;
}
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function findModel(key) {
  return CONFIG.video_models.find((m) => m.key === key);
}
function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

/* ---------------- 任务引擎 ---------------- */

function createTask({ model_key, prompt, params, first_frame_name, first_frame_data, draft, accelerated, parent_id, provider, owner }) {
  const model = findModel(model_key);
  if (!model) return { error: '模型不存在: ' + model_key };
  // 任务归属通道快照：创建后切换通道，在途任务仍按原通道提交/轮询（finalize 显式继承父任务通道）
  const p = provider || PROVIDER;
  // 首帧图：真实模式需要图片内容（base64 data URI），演示模式只用文件名
  let frameData = null;
  const frameRaw = safeStr(first_frame_data);
  if (frameRaw && /^data:image\/(png|jpe?g|webp|bmp|gif);base64,/i.test(frameRaw)) {
    if (frameRaw.length > 12e6) return { error: '首帧图片过大：请压缩到 9MB 以内再试' };
    frameData = frameRaw;
  }
  // 部分上游通道不收本地图片（Agnes 的 keyframe 模式只认公网图片 URL）：提前拒绝
  if (frameData && p.name !== 'demo' && p.name !== 'mock' && p.supports_first_frame === false) {
    return { error: PUBLIC_MODE
      ? '当前出片通道（' + p.label + '）不支持本地首帧图：点顶栏「⇄ 切换通道」选火山方舟，粘贴你自己的 Key 后即可用首帧图'
      : '当前出片通道（' + p.label + '）不支持本地首帧图：请在页面首帧图区域点「切换到火山方舟通道」，或点右上角「切换通道 → 通道配置」写入 VOLC_API_KEY' };
  }
  // 带 parent_id 的任务 = 样片「直出高清」任务：不再被 draft_only 强制成样片
  const isFinalize = !!parent_id;
  const forcedDraft = model.supports.includes('draft_only');
  const isDraft = !isFinalize && (forcedDraft || (!!draft && model.supports.includes('draft')));

  const dur = clamp(safeNum(params && params.duration_ms, NaN) || 5000, 1000, 20000);
  // 时长会影响"生成耗时"，让参数真的有体感
  const speed = Math.round((model.speed_ms || 8000) * (dur / 5000));
  // resolution 是用户可控字符串且会被前端拼进 innerHTML（任务卡参数行）——
  // 必须白名单校验，否则 "<img onerror=...>" 这类输入会造成存储型 XSS，
  // 公网部署时会被用来偷其他访客存在浏览器里的 Key
  const RESOLUTION_RE = /^\d{3,4}p$/;
  const reqResolution = safeStr(params && params.resolution) || '720p';
  const requested = {
    duration_ms: dur,
    resolution: RESOLUTION_RE.test(reqResolution) ? reqResolution : '720p',
    steps: clamp(safeNum(params && params.steps, NaN) || 16, 5, 60),
  };

  const t = {
    id: rid('task'),
    parent_id: parent_id || null,
    owner: owner || null,        // 访客匿名 ID（公开模式任务隔离；内部字段，不下发前端）
    model_key: model.key,
    model_name: model.name,
    prompt: safeStr(prompt).slice(0, 500),
    params: {
      duration_ms: requested.duration_ms,
      resolution: isDraft ? '480p' : requested.resolution,
      steps: requested.steps,
    },
    requested,
    first_frame_name: first_frame_name || null,
    first_frame_data: frameData,
    draft: isDraft,
    state: 'queued',          // queued | preprocessing | generating | auditing | done | draft_ready | finalized | canceled | failed
    progress: 0,
    created_at: now(),
    started_at: null,
    finished_at: null,
    speed_ms: speed,
    accelerated: !!accelerated,
    priority: accelerated ? 1 : 0,
    provider: p,               // 通道快照（内部使用，不下发前端）
    eta_ms: null,
    result_svg: null,
    video_url: null,          // 真实模式：本地视频地址 /videos/<id>.mp4
    upstream_id: null,        // 真实模式：上游任务 ID（报错时请提供它）
    upstream_status: null,
    usage: null,              // 真实模式：上游返回的 token 用量
    submitting: false,
    next_poll_at: 0,
    error: null,
    timeline: null,
  };
  tasks.unshift(t);
  // 回收最老的终态任务（在途任务与"样片就绪"都不能动——后者还能点直出）；
  // 被回收任务的视频文件一并删掉，避免 public/videos 无限堆积
  if (tasks.length > TASK_KEEP_MAX) {
    for (let i = tasks.length - 1; i >= 0 && tasks.length > TASK_KEEP_MAX; i--) {
      if (TERMINAL_STATES.includes(tasks[i].state)) {
        const dead = tasks[i];
        if (dead.video_url) {
          const f = path.join(VIDEOS_DIR, dead.id + '.mp4');
          fs.unlink(f, () => {});
        }
        tasks.splice(i, 1);
      }
    }
  }
  return { task: publicTask(t) };
}

function startTask(t) {
  t.started_at = now();
  const p = t.provider || PROVIDER;
  if (p.name !== 'demo') {
    // 真实 / Mock 模式：提交到上游，状态由轮询推动
    t.state = 'preprocessing';
    t.progress = 10;
    submitUpstream(t);
    return;
  }
  const pre = t.first_frame_name ? Math.max(1500, t.speed_ms * 0.15) : 0; // 有首帧图 → 先预处理
  const gen = t.speed_ms * 0.6;
  const audit = Math.max(1200, t.speed_ms * 0.2);
  const s = now();
  t.timeline = { preEnd: s + pre, genEnd: s + pre + gen, auditEnd: s + pre + gen + audit };
  t.state = pre > 0 ? 'preprocessing' : 'generating';
}

/* ================= Provider 引擎（真实出片 / Mock 自测） ================= */

function arkHeaders(apiKey) {
  return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey };
}

// 把本地任务参数翻译成上游请求体（按任务创建时的通道）
function buildUpstreamBody(t) {
  const p = t.provider || PROVIDER;
  const map = providerMap(t.model_key, p.name) || {};
  if (p.name === 'agnes') return buildAgnesBody(t, map, p);
  if (p.name === 'zhipu') return buildZhipuBody(t, map, p);
  if (p.name === 'siliconflow') return buildSiliconflowBody(t, map, p);
  if (p.name === 'minimax') return buildMinimaxBody(t, map, p);
  const content = [{ type: 'text', text: t.prompt }];
  if (t.first_frame_data) {
    content.push({ type: 'image_url', image_url: { url: t.first_frame_data }, role: 'first_frame' });
  }
  const range = map.duration_range || [4, 30];
  const body = {
    model: map.upstream_model,
    content,
    resolution: t.draft ? '480p' : t.params.resolution,
    ratio: map.ratio || 'adaptive',
    duration: clamp(Math.round(t.params.duration_ms / 1000), range[0], range[1]),
    generate_audio: map.generate_audio === true,
    watermark: false,
  };
  if (t.draft && map.supports_draft) body.draft = true; // Seedance 2.5 原生样片模式
  if (t.accelerated) body.priority = 9;                 // 上游优先级拉满（创建时生效）
  return body;
}

/* Agnes Video 2.5 系列请求体：
 * - seconds 是字符串 "4"-"12"；size 是档位 "720P"/"1080P"/"1K"/"2K"
 * - 明确不收 width/height/num_frames/fps/steps/quality（传了直接 400）
 * - 本地首帧图无法转成公网 URL，暂只用 mode=text 文生视频（首帧图在 createTask 已提前拒绝） */
function buildAgnesBody(t, map, p) {
  if (!map.upstream_model) throw new Error('模型 ' + t.model_key + ' 未配置 Agnes 上游映射，请检查 models.config.json');
  const range = map.seconds_range || [4, 12];
  const seconds = String(clamp(Math.round(t.params.duration_ms / 1000), range[0], range[1]));
  return {
    model: map.upstream_model,
    prompt: t.prompt,
    mode: 'text',
    seconds,
    size: map.size || '720P',
    aspect_ratio: (p || PROVIDER).aspect_ratio || '16:9',
  };
}

/* 智谱 CogVideoX 请求体：
 * - size 用 WxH 像素（1280x720 / 1920x1080），fps 固定 30
 * - 实测确认可用的字段只有 model/prompt/size/fps；duration 部分模型支持，默认 5 秒
 * - 免费档返回的是 _watermark.mp4（带水印），这是官方行为
 * - 样片模式（forge-v25-sample）没有智谱映射，会在这里报错并提示换通道 */
function buildZhipuBody(t, map, p) {
  if (!map.upstream_model) {
    throw new Error('模型 ' + t.model_key + ' 不支持智谱通道（样片模式请切到火山方舟）');
  }
  const body = {
    model: map.upstream_model,
    prompt: t.prompt,
    size: map.size || '1280x720',
    fps: map.fps || 30,
  };
  if (map.duration) body.duration = map.duration;
  return body;
}

/* 硅基流动 Wan 2.2 请求体：
 * - image_size 是固定档位 "1280x720" | "720x1280" | "960x960"（不是像素自由填）
 * - image 支持公网 URL 或 data:image/...;base64 —— 所以本地首帧图可以直接传
 * - 文生视频用 T2V 模型；带首帧图时配置里换 I2V 模型即可 */
function buildSiliconflowBody(t, map, p) {
  if (!map.upstream_model) throw new Error('模型 ' + t.model_key + ' 未配置硅基流动上游映射');
  const body = {
    model: map.upstream_model,
    prompt: t.prompt,
    image_size: map.image_size || '1280x720',
  };
  if (t.first_frame_data) body.image = t.first_frame_data; // dataURL 直接可用
  return body;
}

/* MiniMax 海螺请求体（v2.3 扁平参数端点）：
 * - duration 是 6 / 10（秒），resolution 是 "768P" / "1080P"
 * - first_frame_image 只收公网 URL 或官方允许的图片 URL；本地 dataURL 上游不认
 * - 成功后只返回 file_id，还要再调 /v1/files/retrieve 换 download_url */
function buildMinimaxBody(t, map, p) {
  if (!map.upstream_model) throw new Error('模型 ' + t.model_key + ' 未配置 MiniMax 上游映射');
  const range = map.duration_range || [6, 10];
  const body = {
    model: map.upstream_model,
    prompt: t.prompt,
    duration: clamp(Math.round(t.params.duration_ms / 1000), range[0], range[1]),
    resolution: map.resolution || '768P',
  };
  return body;
}

/* 上游临时性错误（服务繁忙 / 限流 / 网关抖动）按官方建议指数退避重试；
 * 参数与鉴权错误（400/401/404）不重试，立即失败。
 * 注意：只对"确定拿到 HTTP 响应"的情况重试；网络层异常（连接被重置等）不重试，避免重复创建任务。 */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504, 520]);
const RETRY_DELAYS = [5000, 15000, 30000];
async function fetchUpstream(url, options, label) {
  for (let i = 0; ; i++) {
    const res = await fetch(url, options);
    if (res.ok || !RETRYABLE_STATUS.has(res.status) || i >= RETRY_DELAYS.length) return res;
    const wait = RETRY_DELAYS[i];
    console.log('  [上游重试] ' + label + ' 返回 HTTP ' + res.status + '，' + (wait / 1000) + ' 秒后自动第 ' + (i + 2) + '/3 次尝试');
    await sleep(wait);
  }
}

/* 智谱免费模型的限流是以 HTTP 200 + {error:{code:"1305"}} 返回的，
 * fetchUpstream 只按 HTTP 状态码重试，覆盖不到这种情况，所以这里单独做业务码重试。
 * 实测：4 次提交里有 3 次返回 1305，所以必须重试，否则用户会觉得"一用就失败"。 */
const ZHIPU_BUSY_CODES = new Set(['1305', '1302', '1303']);
// 单轮只等约 9 秒（3 次尝试）：占着并发名额死等会让整条队列卡住。
// 仍然排不上就把任务退回队列，由 tick 按 30s→60s→120s 的退避再试（用户可随时取消）。
const ZHIPU_RETRY_DELAYS = [3000, 6000];
async function submitZhipuWithRetry(p, body, t) {
  for (let i = 0; ; i++) {
    if (i > 0) {
      // 加一点随机抖动，避免多个任务同时重试又撞在一起
      await sleep(ZHIPU_RETRY_DELAYS[i - 1] + Math.floor(Math.random() * 1500));
      t.upstream_status = 'busy-retry';
      t.progress = 5;
    }
    const res = await fetch(p.baseUrl + '/videos/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + p.apiKey },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.id) return data.id;
    const code = String((data && data.error && data.error.code) || '');
    if (res.ok && ZHIPU_BUSY_CODES.has(code) && i < ZHIPU_RETRY_DELAYS.length) {
      console.log('  [智谱排队] ' + t.id + ' 返回 ' + code + '，第 ' + (i + 1) + ' 次重试');
      continue;
    }
    const err = new Error(upstreamError(data, res.status, p.name));
    // 标记为"可退回队列"：排队/限流不是用户的错，也不该让任务直接失败
    if (res.ok && ZHIPU_BUSY_CODES.has(code)) err.retryable = true;
    throw err;
  }
}

async function submitUpstream(t) {
  if (t.submitting) return;
  t.submitting = true;
  const p = t.provider || PROVIDER; // 按任务创建时的通道提交（切换通道不影响在途任务）
  try {
    let id;
    if (p.name === 'mock') {
      id = mockSubmit(t);
    } else if (p.name === 'agnes') {
      const body = buildUpstreamBody(t);
      // 让任务卡显示真实输出参数（Agnes 会按 size/seconds 收敛：15s→12s、1080p→720P）
      t.params.duration_ms = Number(body.seconds) * 1000;
      t.params.resolution = body.size.toLowerCase();
      t.upstream_model = body.model; // 轮询 URL 需要带 model_name
      const res = await fetchUpstream(p.apiRoot + '/v1/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + p.apiKey },
        body: JSON.stringify(body),
      }, 'Agnes 提交');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(upstreamError(data, res.status, p.name));
      id = data.video_id || data.id || data.task_id;
      if (!id) throw new Error('Agnes 未返回 video_id，响应：' + JSON.stringify(data).slice(0, 200));
    } else if (p.name === 'zhipu') {
      const body = buildUpstreamBody(t);
      // 让任务卡显示真实输出参数（智谱按 size 档位出片）
      t.params.resolution = body.size === '1920x1080' ? '1080p' : '720p';
      t.upstream_model = body.model; // 查询接口虽不需要，但保留便于排查
      id = await submitZhipuWithRetry(p, body, t);
    } else if (p.name === 'siliconflow') {
      const body = buildUpstreamBody(t);
      t.params.resolution = body.image_size === '960x960' ? '720p' : '720p';
      t.upstream_model = body.model;
      const res = await fetchUpstream(p.baseUrl + '/video/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + p.apiKey },
        body: JSON.stringify(body),
      }, '硅基流动 提交');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(upstreamError(data, res.status, p.name));
      id = data.requestId || data.request_id;
      if (!id) throw new Error('硅基流动未返回 requestId，响应：' + JSON.stringify(data).slice(0, 200));
    } else if (p.name === 'minimax') {
      const body = buildUpstreamBody(t);
      t.params.duration_ms = body.duration * 1000;
      t.params.resolution = String(body.resolution).toLowerCase();
      t.upstream_model = body.model;
      const res = await fetchUpstream(p.baseUrl + '/v1/video_generation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + p.apiKey },
        body: JSON.stringify(body),
      }, 'MiniMax 提交');
      const data = await res.json().catch(() => ({}));
      const bizCode = data && data.base_resp && data.base_resp.status_code;
      if (!res.ok || (bizCode !== undefined && bizCode !== 0)) {
        throw new Error(upstreamError(data, res.status, p.name));
      }
      id = data.task_id;
      if (!id) throw new Error('MiniMax 未返回 task_id，响应：' + JSON.stringify(data).slice(0, 200));
    } else {
      const res = await fetchUpstream(p.baseUrl + '/contents/generations/tasks', {
        method: 'POST',
        headers: arkHeaders(p.apiKey),
        body: JSON.stringify(buildUpstreamBody(t)),
      }, '火山方舟 提交');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(upstreamError(data, res.status, p.name));
      id = data.id || data.task_id;
      if (!id) throw new Error('上游未返回任务 ID');
    }
    t.upstream_id = id;
    t.upstream_status = 'queued';
    t.next_poll_at = now() + 2000;
  } catch (e) {
    if (e && e.retryable) {
      // 上游排队/限流：不算失败，退回队列按退避时间再试（上限 10 次，约 20 分钟）
      t.retry_count = (t.retry_count || 0) + 1;
      if (t.retry_count > 10) {
        t.state = 'failed';
        t.error = '排队太久（已重试 10 次约 20 分钟）：' + e.message;
        t.finished_at = now();
      } else {
        t.state = 'queued';
        t.progress = 0;
        t.retry_at = now() + Math.min(30000 * Math.pow(2, t.retry_count - 1), 180000);
        t.queue_note = e.message;
        t.upstream_status = 'queueing';
        console.log('  [排队] ' + t.id + ' 第 ' + t.retry_count + ' 次退回队列，'
          + Math.round((t.retry_at - now()) / 1000) + ' 秒后再试');
      }
    } else {
      // 提交失败：任务标记失败（上游未创建成功，不计费）
      t.state = 'failed';
      t.error = '提交上游失败：' + e.message;
      t.finished_at = now();
    }
  } finally {
    t.submitting = false;
  }
}

function upstreamError(data, status, providerName) {
  const e = data && data.error;
  const detail = data && data.detail; // Agnes 用 FastAPI 风格的 detail 字段
  const raw = (e && e.message) || (typeof e === 'string' ? e : '') || (typeof detail === 'string' ? detail : '') || (detail && detail.message) || '';
  if ((providerName || PROVIDER.name) === 'agnes') {
    if (status === 401) return 'Agnes API Key 无效或未授权（401）。按可能性排查：① 接口地址与 Key 不匹配——国内站（platform.agnes-ai.cn）创建的 Key 必须配 AGNES_API_ROOT=https://api.agnes-ai.cn，国际站（platform.agnes-ai.com）的 Key 配 apihub.agnes-ai.com，混用必报 401；② 检查 .env 或 Windows 系统环境变量里的 AGNES_API_KEY（系统环境变量优先）是否从头到尾复制完整、以 sk- 开头；③ 刚创建的 Key 等 2 分钟再试';
    if (status === 429) return '触发 Agnes 限流（429）：免费档每分钟 1 条，请隔 1 分钟再试';
    if (status === 400) return 'Agnes 拒绝了请求参数（400）：' + (raw || '请检查模型与时长设置');
    if (status === 503 || status === 502 || status === 500 || status === 520) {
      return 'Agnes 视频队列繁忙（HTTP ' + status + (raw ? '，' + raw : '') + '）：已自动重试 3 次仍失败，请过几分钟再试';
    }
    if (raw) return raw;
    return 'Agnes 服务异常（HTTP ' + status + '），请稍后再试';
  }
  if ((providerName || PROVIDER.name) === 'siliconflow') {
    const code = (e && e.code) || (data && data.code);
    if (status === 401 || /invalid token/i.test(raw)) {
      return '硅基流动 API Key 无效（401）：到 cloud.siliconflow.cn → 「API 密钥」重新复制（sk- 开头）';
    }
    if (code === 50505 || status === 503) return '硅基流动模型服务过载（50505），请稍后再试';
    if (status === 429) return '硅基流动限流（429）：当前套餐有 TPM 限制，稍后再试';
    if (code === 20012) return '硅基流动参数不合法（20012）：' + (raw || '检查模型名 / image_size');
    if (raw) return raw + (code ? '（' + code + '）' : '');
    return '硅基流动服务异常（HTTP ' + status + '）';
  }
  if ((providerName || PROVIDER.name) === 'minimax') {
    const br = (data && data.base_resp) || {};
    const code = br.status_code;
    const msg = br.status_msg || raw;
    if (code === 1004 || status === 401) return 'MiniMax 鉴权失败（1004）：确认是国内站 platform.minimaxi.com 的 Key（国际站 Key 不通用）';
    if (code === 1008) return 'MiniMax 余额不足（1008）：请先充值再试';
    if (code === 2013) return 'MiniMax 参数不合法（2013）：' + (msg || '检查模型名、duration、resolution');
    if (msg) return msg + (code ? '（' + code + '）' : '');
    return 'MiniMax 服务异常（HTTP ' + status + '）';
  }
  if ((providerName || PROVIDER.name) === 'zhipu') {
    const msg = (e && e.message) || '';
    if (status === 401 || /invalid.*token|令牌|鉴权/i.test(msg)) {
      return '智谱 API Key 无效或已过期（401）：到 open.bigmodel.cn → 「API Keys」重新复制一个';
    }
    if (msg.includes('访问量过大') || String((e && e.code) || '') === '1305') {
      return '智谱免费模型排队人数太多（1305）：已自动重试 5 次仍未排上，过 1 分钟再试';
    }
    if (msg) return msg + (e.code ? '（' + e.code + '）' : '');
    if (status === 429) return '智谱接口限流（429），请稍后再试';
    return '智谱服务异常（HTTP ' + status + '）';
  }
  if (e && e.message) return e.message + (e.code ? '（' + e.code + '）' : '');
  if (typeof e === 'string') return e;
  if (status === 401) return 'API Key 无效或未授权（401）';
  if (status === 404) return '模型未开通或不存在（404），请到火山方舟控制台开通对应模型';
  if (status === 429) return '触发上游限流（429），请稍后再试';
  return 'HTTP ' + status;
}

async function downloadVideo(url, dest, apiKey) {
  let res = await fetch(url);
  if (res.status === 401 || res.status === 403) {
    res = await fetch(url, { headers: { Authorization: 'Bearer ' + apiKey } });
  }
  if (!res.ok) throw new Error('下载视频失败（HTTP ' + res.status + '），视频链接可能已过期（有效期 24 小时）');
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return buf.length;
}

async function finishWithVideo(t, videoUrl, usage) {
  if (!fs.existsSync(VIDEOS_DIR)) fs.mkdirSync(VIDEOS_DIR, { recursive: true });
  const file = path.join(VIDEOS_DIR, t.id + '.mp4');
  const p = t.provider || PROVIDER;
  const bytes = await downloadVideo(videoUrl, file, p.apiKey);
  t.video_url = '/videos/' + t.id + '.mp4';
  t.usage = usage || null;
  t.progress = 100;
  t.finished_at = now();
  t.state = t.draft ? 'draft_ready' : 'done';
  if (t.state === 'done') scrubTaskKey(t); // 样片还要留着 Key 给直出用；成品则抹掉
  console.log('  [成片] ' + t.id + ' -> ' + t.video_url + '（' + Math.round(bytes / 1024) + ' KB）');
}

function failTask(t, message) {
  t.state = 'failed';
  t.error = message;
  t.finished_at = now();
  scrubTaskKey(t);
}

/* 任务终态后抹掉内存里的 Key（访客自带 Key 的场景：服务端持有时间最小化）。
 * 只替换引用，不修改原对象——直出子任务持有的是克隆，不受影响。 */
function scrubTaskKey(t) {
  if (t && t.provider && t.provider.apiKey) {
    t.provider = { name: t.provider.name, label: t.provider.label };
  }
}

async function pollProviderTasks() {
  const el = now();
  for (const t of tasks) {
    const p = t.provider || PROVIDER; // 任务可能创建于旧通道，轮询跟着任务走
    if (p.name === 'demo') continue;
    if (!t.upstream_id) continue;
    if (t.state !== 'preprocessing' && t.state !== 'generating') continue;
    if (el < t.next_poll_at) continue;
    t.next_poll_at = el + p.pollMs;
    try {
      let r;
      if (p.name === 'mock') {
        r = mockPoll(t);
      } else if (p.name === 'agnes') {
        // Agnes 轮询：GET /agnesapi?video_id=<id>&model_name=<模型>（keyframe/reference 模式必须带 model_name）
        const url = p.apiRoot + '/agnesapi?video_id=' + encodeURIComponent(t.upstream_id) +
          '&model_name=' + encodeURIComponent(t.upstream_model || 'agnes-video-2.5-flash');
        const res = await fetch(url, { headers: { Authorization: 'Bearer ' + p.apiKey } });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(upstreamError(data, res.status, p.name));
        r = normalizeAgnesStatus(data);
        if (r.status === 'running' && typeof data.progress === 'number') {
          t.progress = clamp(data.progress * 0.85, 10, 85); // 用上游进度驱动进度条
        }
      } else if (p.name === 'siliconflow') {
        // 硅基流动轮询：GET /video/status?requestId=xxx
        const res = await fetch(p.baseUrl + '/video/status?requestId=' + encodeURIComponent(t.upstream_id), {
          headers: { Authorization: 'Bearer ' + p.apiKey },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(upstreamError(data, res.status, p.name));
        r = normalizeSiliconflowStatus(data);
      } else if (p.name === 'minimax') {
        // MiniMax 轮询：GET /v1/query/video_generation?task_id=xxx
        const res = await fetch(p.baseUrl + '/v1/query/video_generation?task_id=' + encodeURIComponent(t.upstream_id), {
          headers: { Authorization: 'Bearer ' + p.apiKey },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(upstreamError(data, res.status, p.name));
        r = normalizeMinimaxStatus(data);
      } else if (p.name === 'zhipu') {
        // 智谱轮询：GET /async-result/{id}（实测一次 5 秒 720P 任务约 60 秒出结果）
        const res = await fetch(p.baseUrl + '/async-result/' + encodeURIComponent(t.upstream_id), {
          headers: { Authorization: 'Bearer ' + p.apiKey },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(upstreamError(data, res.status, p.name));
        r = normalizeZhipuStatus(data);
      } else {
        const res = await fetch(p.baseUrl + '/contents/generations/tasks/' + encodeURIComponent(t.upstream_id), { headers: arkHeaders(p.apiKey) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(upstreamError(data, res.status, p.name));
        r = data;
      }
      t.upstream_status = r.status;
      if (r.status === 'queued') {
        t.state = 'preprocessing';
        t.progress = 10;
        t.eta_ms = null;
      } else if (r.status === 'running') {
        t.state = 'generating';
        t.progress = Math.min(85, 30 + (el - t.started_at) / 1000);
        t.eta_ms = null;
      } else if (r.status === 'succeeded') {
        let url = r.url || (r.content && r.content.video_url);
        // MiniMax 成功只给 file_id，要再调一次 /v1/files/retrieve 换下载地址
        if (!url && r.file_id) url = await resolveMinimaxFileUrl(p, r.file_id);
        if (!url) { failTask(t, '上游返回成功但没有视频地址'); continue; }
        await finishWithVideo(t, url, r.usage);
      } else if (r.status === 'failed' || r.status === 'expired') {
        const msg = r.error || (r.status === 'expired' ? '任务超时（expired）' : '上游生成失败');
        failTask(t, String(msg));
      }
    } catch (e) {
      // 网络抖动等临时错误：不立即判失败，下次轮询重试
      console.log('  [轮询警告] ' + t.id + ': ' + e.message);
    }
  }
}

/* Agnes 状态归一到内部词汇表：queued / in_progress / completed / failed → queued / running / succeeded / failed
 * 成品视频 URL 在响应顶层 url 字段（ completed 时才可交付） */
function normalizeAgnesStatus(d) {
  const s = String((d && d.status) || '').toLowerCase();
  if (s === 'completed' || s === 'succeeded' || s === 'success' || s === 'done') {
    return { status: 'succeeded', url: d.url || d.video_url || (d.content && d.content.video_url) || null, error: null };
  }
  if (s === 'failed' || s === 'error' || s === 'cancelled' || s === 'canceled') {
    const e = d.error;
    return { status: 'failed', url: null, error: (e && (e.message || e)) || 'Agnes 生成失败' };
  }
  if (s === 'in_progress' || s === 'running' || s === 'processing') return { status: 'running', url: null, error: null };
  return { status: 'queued', url: null, error: null };
}

/* 智谱任务状态：PROCESSING / SUCCESS / FAIL
 * 成品在 video_result[0].url —— 是 UCloud 的临时签名链接（带 Expires），必须立刻下载到本地，
 * 不能直接把这个 URL 下发前端（过期就打不开了）。 */
function normalizeZhipuStatus(d) {
  const s = String((d && d.task_status) || '').toUpperCase();
  if (s === 'SUCCESS') {
    const v = (d.video_result && d.video_result[0]) || {};
    return { status: 'succeeded', url: v.url || null, error: null, usage: d.usage || null };
  }
  if (s === 'FAIL' || s === 'FAILED') {
    const e = d.error;
    return { status: 'failed', url: null, error: (e && (e.message || e)) || '智谱生成失败' };
  }
  return { status: 'running', url: null, error: null };
}

/* 硅基流动：status 取 Succeed / Failed / InQueue / InProgress（大小写都兼容）
 * 成品在 results[0].url，**有效期仅 10 分钟**，必须立刻下载落地，不能下发前端。 */
function normalizeSiliconflowStatus(d) {
  const st = String((d && d.status) || '').toLowerCase();
  if (st === 'succeed' || st === 'succeeded' || st === 'success') {
    const r0 = (d.results && d.results[0]) || {};
    return { status: 'succeeded', url: r0.url || d.video_url || null, error: null, usage: null };
  }
  if (st === 'failed' || st === 'error') {
    return { status: 'failed', url: null, error: d.reason || d.message || '硅基流动生成失败' };
  }
  if (st === 'inprogress' || st === 'in_progress' || st === 'running' || st === 'processing') {
    return { status: 'running', url: null, error: null };
  }
  return { status: 'queued', url: null, error: null };
}

/* MiniMax：Preparing / Queueing / Processing / Success / Fail
 * Success 时只返回 file_id，视频地址要再调 /v1/files/retrieve 获取。 */
function normalizeMinimaxStatus(d) {
  const st = String((d && d.status) || '').toLowerCase();
  if (st === 'success') {
    return { status: 'succeeded', url: d.download_url || null, file_id: d.file_id, error: null, usage: null };
  }
  if (st === 'fail' || st === 'failed') {
    return { status: 'failed', url: null, error: d.error_message || 'MiniMax 生成失败' };
  }
  if (st === 'queueing' || st === 'preparing') return { status: 'queued', url: null, error: null };
  if (st === 'processing') return { status: 'running', url: null, error: null };
  return { status: 'queued', url: null, error: null };
}

async function resolveMinimaxFileUrl(p, fileId) {
  const res = await fetch(p.baseUrl + '/v1/files/retrieve?file_id=' + encodeURIComponent(fileId), {
    headers: { Authorization: 'Bearer ' + p.apiKey },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(upstreamError(data, res.status, p.name));
  return (data.file && data.file.download_url) || null;
}

/* ---- Mock provider：本地模拟上游 API，供开发自测（不花钱、不出真片） ---- */
const mockJobs = new Map();
function mockSubmit(t) {
  const id = 'mock-' + crypto.randomBytes(4).toString('hex');
  mockJobs.set(id, { created: now(), stage: 0 });
  return id;
}
function mockPoll(t) {
  const job = mockJobs.get(t.upstream_id);
  const el = now() - job.created;
  if (el < 1500) return { status: 'queued' };
  if (el < 5000) return { status: 'running' };
  if (!job.done) {
    job.done = true;
    job.video = 'http://127.0.0.1:' + PORT + '/mock-sample.mp4';
  }
  return { status: 'succeeded', content: { video_url: job.video }, usage: { total_tokens: 123456 } };
}

// 每 200ms 推进一次所有任务（真实系统里这里是 worker 消费队列）
function tick() {
  // 1) 启动排队中的任务：默认最多 MAX_RUNNING 个并行；加速任务排最前
  //    Agnes 免费档 1 RPM → max_parallel=1，自动串行提交，避免 429
  const maxParallel = PROVIDER.max_parallel || MAX_RUNNING;
  let running = tasks.filter((t) => t.state === 'preprocessing' || t.state === 'generating' || t.state === 'auditing').length;
  const queued = tasks
    .filter((t) => t.state === 'queued')
    .sort((a, b) => b.priority - a.priority || a.created_at - b.created_at);
  for (const t of queued) {
    if (running >= maxParallel) break;
    // 上游排队/限流时任务会退回队列并设置 retry_at，时间没到就先跳过（不占并发名额）
    if (t.retry_at && t.retry_at > now()) continue;
    startTask(t);
    running++;
  }

  // 2) 推进运行中任务的状态机与进度
  const el = now();
  for (const t of tasks) {
    if (!t.timeline) continue;
    if (t.state === 'queued' || t.state === 'done' || t.state === 'draft_ready' || t.state === 'finalized' || t.state === 'canceled' || t.state === 'failed') continue;

    if (t.state === 'preprocessing') {
      t.progress = clamp((10 * (el - t.started_at)) / (t.timeline.preEnd - t.started_at), 0, 10);
      if (el >= t.timeline.preEnd) t.state = 'generating';
    }
    if (t.state === 'generating') {
      const span = t.timeline.genEnd - t.timeline.preEnd;
      t.progress = clamp(10 + (70 * (el - t.timeline.preEnd)) / span, 10, 80);
      if (el >= t.timeline.genEnd) t.state = 'auditing';
    }
    if (t.state === 'auditing') {
      const span = t.timeline.auditEnd - t.timeline.genEnd;
      t.progress = clamp(80 + (20 * (el - t.timeline.genEnd)) / span, 80, 100);
      if (el >= t.timeline.auditEnd) {
        t.progress = 100;
        t.finished_at = now();
        t.result_svg = buildResultSvg(t);
        t.state = t.draft ? 'draft_ready' : 'done';
      }
    }
    t.eta_ms = Math.max(0, t.timeline.auditEnd - el);
  }

  // 3) 提示词润色任务（约 1.2 秒完成）
  for (const pt of promptTasks.values()) {
    if (pt.status === 'pending' && now() - pt.created_at > 1200) {
      pt.status = 'done';
      pt.enhanced = enhancePrompt(pt.prompt);
    }
  }
}

/* ---------------- 提示词润色（本地规则引擎，零依赖） ----------------
 * 旧版按哈希随机硬套风格词，"咖啡倒入杯中"也可能配上"国风水墨晕染，鹤影翩跹"。
 * 新版设计原则：
 *   1. 先"读懂"输入——用关键词打分识别主体类别（食物/动物/人物/城市/自然/机械/植物/产品/幻想）；
 *   2. 分层补全——缺什么补什么：风格 → 镜头运动 → 光影 → 画质；
 *   3. 用户已写过的风格/镜头/光影/画质词不叠加，避免堆叠重复；
 *   4. 同一输入结果稳定可复现，不同输入按哈希在同类词库里变化；
 *   5. 幂等——对已润色过的文本再跑一次不会继续膨胀。 */
const ENHANCE_CATEGORIES = [
  {
    name: '食物饮品',
    keywords: ['咖啡', '茶', '酒', '啤酒', '米饭', '面条', '泡面', '拉面', '面包', '美食', '烹饪', '料理', '倒入', '注入', '杯中', '汤汁', '甜点', '甜品', '蛋糕', '水果', '巧克力', '披萨', '火锅', '早餐', '餐桌', '菜肴'],
    style: ['美食广告微距，液体光泽与袅袅蒸汽清晰可见', '暖调美食摄影，食材新鲜质感毕现', '微距呈现表面纹理与细腻泡沫'],
    motion: ['慢动作捕捉液体流动的瞬间', '镜头缓缓拉近展现食物全貌', '热气缓缓升腾的氛围特写'],
    light: ['暖色高光，质感温润诱人', '柔和侧光，蒸汽在光束中浮动'],
    quality: ['高细节，画面稳定流畅', '质感细腻，色彩饱满'],
  },
  {
    name: '动物',
    keywords: ['猫', '猫咪', '狗', '小狗', '鸟', '飞鸟', '鱼', '鱼群', '马', '老虎', '熊猫', '兔子', '狐狸', '蝴蝶', '蜜蜂', '昆虫', '动物', '宠物', '鲸', '海豚', '企鹅', '小鹿', '翅膀', '喵', '汪'],
    style: ['毛发根根分明，灵性眼神特写', '自然光下真实的皮毛质感', '生动姿态捕捉，神情灵动'],
    motion: ['动物缓步走过，忽然驻足回望', '低角度镜头跟随主体移动', '主体自然动作的慢动作瞬间'],
    light: ['自然散射光，氛围温馨', '黄金时刻侧逆光，轮廓分明'],
    quality: ['细节丰富，动作自然流畅', '画面稳定，栩栩如生'],
  },
  {
    name: '人物',
    keywords: ['女孩', '男孩', '女人', '男人', '演员', '舞者', '舞蹈', '少女', '少年', '老人', '孩子', '肖像', '模特', '厨师', '宇航员', '科学家', '面孔', '表情', '微笑', '回眸', '行人', '路人', '人物', '侧脸', '背影', '奔跑的人'],
    style: ['人物特写，皮肤质感细腻，眼神灵动', '浅景深人像，轮廓光勾勒边缘', '电影感人物刻画，情绪张力十足'],
    motion: ['镜头缓慢环绕人物半周', '人物自然微动作，发丝与衣角轻动', '过肩视角跟随人物行动'],
    light: ['柔和轮廓光，肤色通透', '伦勃朗光，情绪深沉'],
    quality: ['肤质细节真实，画面稳定', '高细节，电影级质感'],
  },
  {
    name: '城市建筑',
    keywords: ['城市', '都市', '街道', '大街', '小巷', '大楼', '建筑', '摩天', '夜景', '霓虹', '桥梁', '大桥', '公路', '车流', '地铁', '集市', '市场', '人群', '天际线', '巷子', '街头', '市中心', '立交桥', '阳台', '屋顶'],
    style: ['都市光影，霓虹与潮湿地面反光', '宏伟建筑透视，结构细节丰富', '街头纪实感，人间烟火气'],
    motion: ['镜头沿街道缓缓推进，展现空间纵深', '从高空缓慢下降俯瞰城市', '镜头跟随主体穿行街巷'],
    light: ['霓虹与路灯交错的冷暖对比', '黄金时刻斜照，长影子拉出纵深'],
    quality: ['高细节，画面稳定流畅', '建筑纹理清晰，层次分明'],
  },
  {
    name: '自然风景',
    keywords: ['山', '雪山', '大海', '海洋', '海底', '森林', '树林', '日落', '日出', '星空', '银河', '云海', '云朵', '天空', '下雪', '雪花', '草原', '沙漠', '瀑布', '湖泊', '河流', '小溪', '田野', '极光', '海滩', '海边', '海浪', '峡谷', '黄昏', '夕阳', '下雨', '雨天', '微风', '薄雾', '小岛', '火山', '冰川', '田园', '村庄', '篝火', '风暴', '暴风雨', '暴雨', '雷雨', '闪电', '潮汐', '灯塔', '渔船', '海鸥', '彩虹'],
    style: ['大场景宏大气层次，色彩饱满自然', '天地呼应的辽阔构图', '诗意自然风光，氛围宁静'],
    motion: ['镜头缓慢横移，展现辽阔空间', '云层流动，光影缓缓扫过地面', '从地面缓缓升起拉远至全景'],
    light: ['黄金时刻暖光，天地通透', '清晨薄雾中的柔和散射光'],
    quality: ['高细节，画面稳定流畅', '大气透视自然，细节丰富'],
  },
  {
    name: '机械科技',
    keywords: ['机械', '机器人', '机甲', '科幻', '科技', '飞船', '太空', '宇宙', '空间站', '引擎', '发动机', '电路', '芯片', '赛博', '未来', '全息', '数据', '实验室', '飞行器', '无人机', '火箭', '卫星', '虚拟', '代码', '屏幕', '界面', '工厂', '齿轮', '无人机'],
    style: ['硬核机械结构，金属拉丝与倒角高光', '冷色调科技感，辉光与扫描线', '精密工业设计美感'],
    motion: ['机械部件精密运转，镜头环绕展示结构', '能量光线流转，全息界面浮动', '镜头推进穿过结构缝隙'],
    light: ['冷蓝辉光与环境光反射', '高对比布光，金属高光闪烁'],
    quality: ['细节丰富，质感真实', '画面稳定，科技感十足'],
  },
  {
    name: '植物花卉',
    keywords: ['花', '花朵', '鲜花', '樱花', '玫瑰', '向日葵', '荷花', '树木', '树叶', '叶子', '草地', '植物', '盆栽', '花园', '竹林', '苔藓', '麦田', '稻田', '藤蔓', '蘑菇', '蒲公英', '森林步道'],
    style: ['植物脉络清晰，露珠折射微光', '清新自然色彩，柔和散射光', '生机盎然的微观视角'],
    motion: ['花瓣在微风中轻轻颤动', '叶片上的露珠缓缓滑落', '镜头穿行于花丛之间'],
    light: ['柔和散射光，色彩清新', '逆光下半透明花瓣，脉络可见'],
    quality: ['细节清晰，画面稳定', '微观质感真实自然'],
  },
  {
    name: '产品静物',
    keywords: ['产品', '瓶子', '水瓶', '手表', '腕表', '手机', '相机', '耳机', '化妆品', '口红', '香水', '海报', '包装', '静物', '球鞋', '背包', '眼镜', '首饰', '项链', '戒指', '展示', '手办', '玩具', '摆件', '皮包'],
    style: ['极简产品广告风，纯色背景，柔和顶光', '高级质感陈列，材质细节毕现', '商业摄影级布光与反射'],
    motion: ['产品缓慢旋转，展示各角度细节', '光带扫过表面，凸显材质肌理', '镜头缓慢推近至产品特写'],
    light: ['柔光箱主光加轮廓光，反控精准', '干净背景布光，突出主体'],
    quality: ['高细节，质感真实', '商业级画质，画面稳定'],
  },
  {
    name: '幻想世界',
    keywords: ['龙', '凤凰', '魔法', '法师', '巫师', '城堡', '骑士', '精灵', '仙子', '神话', '仙境', '宫殿', '古风', '武侠', '江湖', '灯笼', '宝剑', '巨兽', '怪兽', '异世界', '传送门', '悬浮', '废墟', '末日', '废土', '火焰'],
    style: ['史诗奇幻氛围，细节华丽', '东方幻想美学，意境悠远', '宏大世界观视觉呈现'],
    motion: ['镜头环绕主体，展现宏大意象', '能量粒子与魔法光辉流转升腾', '衣袍与披风在动态中猎猎作响'],
    light: ['戏剧化光影，神圣辉光环绕', '冷暖对比的魔幻氛围光'],
    quality: ['高细节，画面稳定流畅', '电影级视效质感'],
  },
];

// 用户已经写明过的描述维度（命中就不再叠加同类词）
const USER_SPECIFIED = {
  style: /电影感|胶片|国风|水墨|赛博|朋克|霓虹|复古|油画|动漫|二次元|写实|3D|卡通|像素|水彩|素描|波普|极简|工业风|ins风|广告风|纪实/i,
  camera: /特写|近景|中景|远景|全景|航拍|俯视|仰视|鸟瞰|微距|慢动作|长镜头|一镜|推近|拉远|拉近|环绕|摇镜|跟随|手持|固定镜头|运镜|视角|镜头/i,
  light: /逆光|顺光|侧光|顶光|底光|黄金时刻|蓝调|体积光|丁达尔|霓虹|光影|光线|照明|打光|阳光|月光|灯光|暖光|冷光|暖色|冷色/i,
  quality: /4K|8K|16K|高清|超清|高细节|精细|电影级|杰作|精品|HD|画质|质感/i,
};

/* 候选过滤：与输入共享连续两字的一律不选（避免"清晨薄雾"式自我重复）；
 * 时段冲突不选——用户写了"夜景"就不给"黄金时刻"，写了"日落"就不给"清晨薄雾" */
function sharedBigram(a, b) {
  for (let i = 0; i + 2 <= a.length; i++) if (b.includes(a.slice(i, i + 2))) return true;
  return false;
}
const TIME_MORNING = /清晨|早晨|早上|日出|晨光|黎明/;
const TIME_EVENING = /日落|夕阳|黄昏|傍晚|黄金时刻/;
const TIME_NIGHT = /深夜|午夜|夜景|夜晚|夜里|晚上|凌晨|黑夜|夜/;
const WEATHER_STORM = /暴风雨|暴雨|雷雨|风暴|狂风|大雪|雨雪|阴天/;
function timeConflict(base, cand) {
  if (WEATHER_STORM.test(base) && (TIME_MORNING.test(cand) || TIME_EVENING.test(cand))) return true;
  if (TIME_NIGHT.test(base) && (TIME_MORNING.test(cand) || TIME_EVENING.test(cand))) return true;
  if (TIME_MORNING.test(base) && (TIME_EVENING.test(cand) || TIME_NIGHT.test(cand))) return true;
  if (TIME_EVENING.test(base) && (TIME_MORNING.test(cand) || TIME_NIGHT.test(cand))) return true;
  return false;
}
// 从候选里挑一个"合身"的；没有合身的就返回 null（调用处跳过该层，宁缺毋滥）
function pickFit(arr, base, salt) {
  const fit = arr.filter((c) => !sharedBigram(c, base) && !timeConflict(base, c));
  if (!fit.length) return null;
  return fit[(hashStr(base) + salt) % fit.length];
}

function enhancePrompt(p) {
  let base = String(p || '').trim().replace(/[，。,.\s]+$/, '');
  if (!base) return base;
  // 非中文输入：补通用英文画质词即可（本工具面向中文场景）
  if (!/[\u4e00-\u9fff]/.test(base)) return base + ', cinematic lighting, rich detail, smooth motion';

  // 1) 关键词打分识别主体类别（命中多的胜出；并列时看关键词谁在句中出现得更靠前——
  //    "女孩抱着猫坐在咖啡店"应判人物而不是食物，因为"女孩"是句子主语）
  const seed = hashStr(base);
  let cat = null, best = 0, bestPos = Infinity;
  for (const c of ENHANCE_CATEGORIES) {
    let score = 0, pos = Infinity;
    for (const kw of c.keywords) {
      const i = base.indexOf(kw);
      if (i >= 0) { score++; if (i < pos) pos = i; }
    }
    if (score > best || (score === best && score > 0 && pos < bestPos)) { best = score; bestPos = pos; cat = c; }
  }

  // 2) 分层组装，缺什么补什么
  const has = (dim) => USER_SPECIFIED[dim].test(base);
  const parts = [base];
  const add = (arr, salt) => { const s = pickFit(arr, base, salt); if (s) parts.push(s); };
  const detailed = base.length > 50; // 输入已经很详细时只做点睛补充

  if (cat) {
    if (!has('style')) add(cat.style, 0);
    if (!has('camera')) add(cat.motion, 7);
    if (!detailed && !has('light')) add(cat.light, 13);
    if (!detailed && !has('quality')) add(cat.quality, 21);
  } else {
    // 未识别类别：保守补通用镜头语言、氛围与画质
    if (!has('camera')) add(['镜头缓慢推近主体', '镜头围绕主体缓缓环绕', '缓慢横移展现环境'], 0);
    if (!detailed && !has('light')) add(['明暗层次分明，氛围光柔和自然', '光线自然，影调舒适'], 13);
    if (!detailed && !has('quality')) add(['画面稳定流畅，细节清晰', '高保真画质，细节丰富'], 21);
  }
  // 去重（保持顺序），防止任何意外重复
  return parts.filter((s, i) => parts.indexOf(s) === i).join('，');
}

/* ---------------- 结果生成（演示用：程序化 SVG 动画） ----------------
 * 接入真实模型时，把这里换成：把任务参数发给你的推理服务，
 * 拿到视频 URL 后存到 task.result_url，前端改渲染 <video> 即可。 */
function buildResultSvg(t) {
  const h = hashStr(t.id + '|' + t.prompt);
  const palettes = [
    ['#0f2027', '#2c5364', '#7aa2ff'],
    ['#200122', '#6c4892', '#f5c542'],
    ['#0b3866', '#1f8fe0', '#7ef0ff'],
    ['#2b0a3d', '#7a3ff2', '#ff7ad9'],
    ['#14301f', '#2e8b57', '#c8f5a0'],
    ['#3d1f00', '#c96f1b', '#ffd9a0'],
  ];
  const pal = palettes[h % palettes.length];
  const uid = h.toString(36);
  const W = t.draft ? 480 : 640;
  const H = t.draft ? 270 : 360;
  const cx = 120 + (h % 400);
  const cy = 90 + ((h >> 3) % 180);
  const promptText = escapeXml(t.prompt.length > 42 ? t.prompt.slice(0, 42) + '…' : t.prompt || '未命名作品');
  const badge = escapeXml(t.model_name + ' · ' + t.params.resolution + ' · ' + (t.params.duration_ms / 1000) + 's · ' + t.params.steps + ' 步');
  const draftTag = t.draft ? '<g><rect x="16" y="16" rx="8" width="120" height="30" fill="#00000088"/><text x="26" y="36" fill="#f5c542" font-size="15" font-weight="700">480P 样片</text></g>' : '';

  let orbs = '';
  const n = 4 + (h % 4);
  for (let i = 0; i < n; i++) {
    const ox = 60 + ((h >> (i + 1)) % 520);
    const oy = 50 + ((h >> (i + 2)) % 260);
    const r = 18 + ((h >> (i + 3)) % 46);
    const dur = (5 + (i % 4)) + 's';
    orbs +=
      '<circle cx="' + ox + '" cy="' + oy + '" r="' + r + '" fill="url(#glow' + uid + ')" opacity="0.75">' +
      '<animate attributeName="cy" values="' + oy + ';' + (oy - 40) + ';' + oy + '" dur="' + dur + '" repeatCount="indefinite"/>' +
      '<animate attributeName="opacity" values="0.75;0.35;0.75" dur="' + dur + '" repeatCount="indefinite"/>' +
      '</circle>';
  }

  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="100%" preserveAspectRatio="xMidYMid slice">' +
    '<defs>' +
    '<linearGradient id="bg' + uid + '" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="' + pal[0] + '"><animate attributeName="stop-color" values="' + pal[0] + ';' + pal[1] + ';' + pal[0] + '" dur="9s" repeatCount="indefinite"/></stop>' +
    '<stop offset="1" stop-color="' + pal[1] + '"><animate attributeName="stop-color" values="' + pal[1] + ';' + pal[2] + ';' + pal[1] + '" dur="11s" repeatCount="indefinite"/></stop>' +
    '</linearGradient>' +
    '<radialGradient id="glow' + uid + '">' +
    '<stop offset="0" stop-color="' + pal[2] + '" stop-opacity="0.95"/>' +
    '<stop offset="1" stop-color="' + pal[2] + '" stop-opacity="0"/>' +
    '</radialGradient>' +
    '</defs>' +
    '<rect width="' + W + '" height="' + H + '" fill="url(#bg' + uid + ')"/>' +
    orbs +
    '<circle cx="' + cx + '" cy="' + cy + '" r="46" fill="none" stroke="#ffffff66" stroke-width="2">' +
    '<animate attributeName="r" values="46;60;46" dur="6s" repeatCount="indefinite"/>' +
    '</circle>' +
    '<text x="' + (W / 2) + '" y="' + (H - 58) + '" text-anchor="middle" fill="#ffffff" font-size="' + (t.draft ? 13 : 16) + '" font-weight="700" font-family="sans-serif">' + promptText + '</text>' +
    '<text x="' + (W / 2) + '" y="' + (H - 34) + '" text-anchor="middle" fill="#ffffffaa" font-size="' + (t.draft ? 10 : 12) + '" font-family="sans-serif">' + badge + '</text>' +
    '<text x="' + (W - 12) + '" y="' + (H - 10) + '" text-anchor="end" fill="#ffffff66" font-size="10" font-family="sans-serif">DreamForge 程序化演示</text>' +
    draftTag +
    '</svg>'
  );
}

function publicTask(t) {
  return {
    id: t.id,
    parent_id: t.parent_id,
    model_key: t.model_key,
    model_name: t.model_name,
    prompt: t.prompt,
    params: t.params,
    draft: t.draft,
    state: t.state,
    progress: Math.round(t.progress),
    eta_ms: t.eta_ms,
    accelerated: t.accelerated,
    first_frame_name: t.first_frame_name,
    created_at: t.created_at,
    finished_at: t.finished_at,
    result_svg: t.result_svg,
    video_url: t.video_url,
    upstream_id: t.upstream_id,
    usage: t.usage,
    error: t.error,
    queue_note: t.queue_note || null,   // 上游排队中给用户看的说明（不是错误）
    retry_count: t.retry_count || 0,
  };
}

/* ---------------- HTTP 层 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/* 统一安全响应头：缺 CSP 时一旦出现 XSS 就没有第二道防线；
 * 缺 X-Frame-Options 可被点击劫持；nosniff 防老浏览器 MIME 嗅探。
 * CSP 里保留 style-src 'unsafe-inline' 是为了兼容既有的内联样式写法，
 * img-src data: 是 favicon（data URI）。 */
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  // 本地 http 访问时浏览器会忽略 HSTS，只有 HTTPS 部署才生效
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

function sendJson(res, code, obj) {
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, SECURITY_HEADERS));
  res.end(JSON.stringify(obj));
}

function readBody(req, res) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => {
      d += c;
      if (d.length > 16e6) { // 首帧图 base64 后可达 ~12MB，上限留到 16MB
        if (!res.writableEnded) {
          sendJson(res, 413, { error: '请求体过大：首帧图片请压缩到 9MB 以内' });
        }
        req.destroy();
        reject(new Error('请求体过大'));
      }
    });
    req.on('end', () => {
      if (!d) return resolve({});
      try {
        resolve(JSON.parse(d));
      } catch (e) {
        // 畸形 JSON 属于客户端错误：回 400，不要让它落到外层变成 500
        if (!res.writableEnded) sendJson(res, 400, { error: '请求体不是合法的 JSON' });
        reject(new Error('JSON 解析失败'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let p = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  // 防目录穿越：必须严格位于 public 目录内（file === PUBLIC_DIR 或以 public + 分隔符开头，
  // 不能只用 startsWith——那会让 public-evil 这种同级目录也通过）
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403, SECURITY_HEADERS);
    return res.end('Forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, SECURITY_HEADERS));
      return res.end('404 Not Found: ' + p);
    }
    res.writeHead(200, Object.assign({ 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }, SECURITY_HEADERS));
    res.end(data);
  });
}

async function route(req, res) {
  let pathname;
  try {
    const u = new URL(req.url, 'http://localhost');
    pathname = decodeURIComponent(u.pathname); // 畸形编码（如 /%zz）在这里就会抛
  } catch {
    // 公网部署时扫描器会大量发送畸形请求，回 400 而不是 500，避免污染错误日志
    return sendJson(res, 400, { error: '请求地址不合法' });
  }
  const method = req.method || 'GET';

  // ---- API ----
  if (method === 'GET' && pathname === '/api/config') {
    const eff = effectiveProvider(req);
    const v = PUBLIC_MODE ? readVisitor(req) : null;
    return sendJson(res, 200, {
      app: { name: CONFIG.app.name, tagline: CONFIG.app.tagline, max_running: MAX_RUNNING },
      video_models: CONFIG.video_models,
      provider: publicProvider(eff),
      channels: channelList(eff, v),
      public_mode: PUBLIC_MODE, // 前端据此启用「访客自带 Key」形态
    });
  }

  // 切换出片通道（页面「切换通道」按钮）：目标通道没配 Key 时返回 400 + need_key，前端据此弹配置面板
  if (method === 'POST' && pathname === '/api/channel') {
    const body = await readBody(req, res);
    const name = safeStr(body.channel);
    const def = CHANNEL_DEFS.find((c) => c.name === name);
    if (!def) return sendJson(res, 400, { error: '未知出片通道: ' + name });
    if (PUBLIC_MODE) {
      // 公开模式：会话级切换——不碰服务端任何状态，实际生效靠访客后续请求带的头
      const v = readVisitor(req);
      if (def.key_env && !(v && v.apiKey)) {
        return sendJson(res, 400, {
          error: '切换到「' + def.label + '」需要先粘贴你自己的 API Key：在下方输入框填好点「保存并切换」。Key 只保存在你的浏览器里，服务器不存储、也看不到。',
          need_key: def.key_env,
          channel: name,
        });
      }
      const p = resolveProvider(name, v);
      return sendJson(res, 200, { provider: publicProvider(p), channels: channelList(p, v), public_mode: true });
    }
    const p = resolveProvider(name);
    if (p.name !== name) {
      return sendJson(res, 400, {
        error: '切换到「' + def.label + '」需要先配置 ' + def.key_env + '：点「通道配置」填入即可（只保存在本机 .env）',
        need_key: def.key_env,
        channel: name,
      });
    }
    const before = PROVIDER.name;
    PROVIDER = p;
    // 仍在原通道进行的任务数（切过去不影响它们，只是告知用户）
    const inflight = tasks.filter((t) => (t.provider || {}).name === before && ['preprocessing', 'generating', 'auditing', 'queued'].includes(t.state)).length;
    console.log('  [通道切换] ' + before + ' → ' + name + (inflight ? '（' + inflight + ' 个在途任务仍在原通道）' : ''));
    return sendJson(res, 200, { provider: publicProvider(p), channels: channelList(p), inflight });
  }

  // 保存 API Key 到 .env 并立即生效（页面「通道配置」面板）：只收白名单内的变量名
  const ALLOWED_KEYS = {
    VOLC_API_KEY: { label: '火山方舟 API Key' },
    AGNES_API_KEY: { label: 'Agnes API Key' },
    AGNES_API_ROOT: { label: 'Agnes 接口地址' },
    ZHIPU_API_KEY: { label: '智谱 BigModel API Key' },
    SILICONFLOW_API_KEY: { label: '硅基流动 API Key' },
    MINIMAX_API_KEY: { label: 'MiniMax 海螺 API Key' },
  };
  if (method === 'POST' && pathname === '/api/keys') {
    const body = await readBody(req, res);
    const name = safeStr(body.name).toUpperCase();
    const def = ALLOWED_KEYS[name];
    if (!def) return sendJson(res, 400, { error: '不允许通过页面配置的变量: ' + name });
    const value = safeStr(body.value).trim();
    if (!value) return sendJson(res, 400, { error: def.label + '不能为空' });
    if (name === 'AGNES_API_ROOT' && !AGNES_ROOTS.includes(value)) {
      return sendJson(res, 400, { error: '接口地址只支持官方两个域名：https://api.agnes-ai.cn（国内站 Key 用）或 https://apihub.agnes-ai.com（国际站 Key 用）' });
    }
    if (PUBLIC_MODE) {
      // 公开模式：只做格式校验，绝不存储——访客的 Key 由他自己浏览器保管（localStorage），
      // 之后每次请求带头信息上来，服务端不落盘、不写内存全局、不回显
      return sendJson(res, 200, { ok: true, stored: false, note: 'Key 只保存在你的浏览器里，服务器不存储' });
    }
    process.env[name] = value;
    saveEnvVar(name, value);
    console.log('  [Key 配置] ' + name + ' 已更新（写入 .env，立即生效）');
    return sendJson(res, 200, { ok: true, channels: channelList() });
  }

  // Mock 模式专用：给模拟上游提供样本视频（仅开发自测用）
  if (method === 'GET' && pathname === '/mock-sample.mp4' && PROVIDER.name === 'mock') {
    const sample = path.join(__dirname, '.dev', 'sample.mp4');
    if (!fs.existsSync(sample)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('mock 模式缺少样本视频：请把任意一个小 mp4 放到 dreamforge\\.dev\\sample.mp4');
    }
    return res.end(fs.readFileSync(sample));
  }

  if (method === 'POST' && pathname === '/api/prompt/enhance') {
    const body = await readBody(req, res);
    const promptStr = safeStr(body.prompt);
    if (!promptStr.trim()) return sendJson(res, 400, { error: '提示词不能为空' });
    const id = rid('prompt');
    promptTasks.set(id, { id, prompt: promptStr.slice(0, 500), status: 'pending', enhanced: null, created_at: now() });
    if (promptTasks.size > PROMPT_TASK_KEEP_MAX) {
      promptTasks.delete(promptTasks.keys().next().value); // Map 保持插入序，删最早的一条
    }
    return sendJson(res, 200, { task_id: id });
  }

  if (method === 'GET' && pathname.startsWith('/api/prompt/task/')) {
    const id = pathname.slice('/api/prompt/task/'.length);
    const pt = promptTasks.get(id);
    if (!pt) return sendJson(res, 404, { error: '润色任务不存在' });
    return sendJson(res, 200, { status: pt.status, enhanced: pt.enhanced });
  }

  if (method === 'POST' && pathname === '/api/generate') {
    const body = await readBody(req, res);
    const promptStr = safeStr(body.prompt);
    if (!promptStr.trim()) return sendJson(res, 400, { error: '提示词不能为空' });
    // 公开部署的三层闸门：防脚本刷任务把队列/内存打满（本地自己用不受影响）
    const cid = PUBLIC_MODE ? readClientId(req) : '';
    if (PUBLIC_MODE) {
      if (!cid) return sendJson(res, 400, { error: '请用浏览器打开本页面后再创建任务' });
      const inflight = (list) => list.filter((t) => INFLIGHT_STATES.includes(t.state)).length;
      if (inflight(tasks.filter((t) => t.owner === cid)) >= MAX_RUNNING) {
        return sendJson(res, 429, { error: '你已有 ' + MAX_RUNNING + ' 个任务在排队/生成中，等它们完成后再提交' });
      }
      if (inflight(tasks) >= 60) {
        return sendJson(res, 503, { error: '当前使用人数较多、队列已满，请过几分钟再试' });
      }
    }
    // 按本次请求解析通道：本地模式=全局通道；公开模式=访客请求头里的 Key（没有就 demo）
    const p = effectiveProvider(req);
    const r = createTask({
      model_key: body.model_key,
      prompt: body.prompt,
      params: body.params || {},
      first_frame_name: body.first_frame_name || null,
      first_frame_data: body.first_frame_data || null,
      draft: !!body.draft,
      accelerated: !!body.accelerate,
      parent_id: null,
      provider: p,
      owner: PUBLIC_MODE ? cid : null, // 公开模式：任务归这个浏览器
    });
    if (r.error) return sendJson(res, 400, { error: r.error });
    return sendJson(res, 200, { task: r.task });
  }

  // 对应即梦的 get_history_queue_info：一次拉走全部任务状态
  if (method === 'POST' && pathname === '/api/queue_info') {
    // 公开模式：只看得到自己这个浏览器创建的任务（别人的 prompt/视频/失败原因都不可见）。
    // 没有 clientId 的请求（curl/脚本）看不到任何任务——避免测试任务污染真实访客。
    const cid = PUBLIC_MODE ? readClientId(req) : '';
    const visible = PUBLIC_MODE ? (cid ? tasks.filter((t) => t.owner === cid) : []) : tasks;
    const running = visible.filter((t) => t.state === 'preprocessing' || t.state === 'generating' || t.state === 'auditing').length;
    return sendJson(res, 200, {
      running,
      max_running: MAX_RUNNING,
      tasks: visible.slice(0, 40).map(publicTask),
    });
  }

  const taskAction = pathname.match(/^\/api\/task\/([^/]+)\/(accelerate|cancel|finalize|export)$/);
  if (taskAction) {
    const id = taskAction[1];
    const action = taskAction[2];
    const t = tasks.find((x) => x.id === id);
    // 公开模式：只能操作自己这个浏览器创建的任务。别人的任务一律当"不存在"回 404，
    // 不暴露它是否存在（否则可以逐个试 id 探测别人的作品）
    if (t && PUBLIC_MODE && t.owner !== readClientId(req)) {
      return sendJson(res, 404, { error: '任务不存在' });
    }
    if (!t) return sendJson(res, 404, { error: '任务不存在' });

    if (action === 'export') {
      if (method !== 'GET') return sendJson(res, 405, { error: '请用 GET' });
      // 真实模式：下载本地转存的 MP4
      if (t.video_url) {
        const file = path.join(VIDEOS_DIR, t.id + '.mp4');
        if (!fs.existsSync(file)) return sendJson(res, 400, { error: '视频文件不存在，请重新生成' });
        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Content-Disposition': 'attachment; filename="dreamforge-' + t.id + '.mp4"',
        });
        return res.end(fs.readFileSync(file));
      }
      if (!t.result_svg) return sendJson(res, 400, { error: '该任务还没有结果' });
      res.writeHead(200, {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Content-Disposition': 'attachment; filename="dreamforge-' + t.id + '.svg"',
      });
      return res.end(t.result_svg);
    }

    if (method !== 'POST') return sendJson(res, 405, { error: '请用 POST' });

    if (action === 'cancel') {
      if (['done', 'draft_ready', 'finalized', 'canceled', 'failed'].includes(t.state)) {
        return sendJson(res, 400, { error: '任务已结束，无法取消' });
      }
      t.state = 'canceled';
      t.finished_at = now();
      scrubTaskKey(t);
      return sendJson(res, 200, { ok: true });
    }

    if (action === 'accelerate') {
      if (['done', 'draft_ready', 'finalized', 'canceled', 'failed'].includes(t.state)) {
        return sendJson(res, 400, { error: '任务已结束，无法加速' });
      }
      if (PROVIDER.name !== 'demo') {
        return sendJson(res, 400, { error: '真实出片模式下速度由上游队列决定，暂不支持中途加速' });
      }
      if (t.accelerated) return sendJson(res, 400, { error: '该任务已经加速过了' });
      t.accelerated = true;
      t.priority = 1;
      // 运行中：把剩余时间压缩一半；排队中：优先被调度
      if (t.timeline && t.state !== 'queued') {
        const el = now();
        t.timeline = {
          preEnd: el + (t.timeline.preEnd - el) * 0.5,
          genEnd: el + (t.timeline.genEnd - el) * 0.5,
          auditEnd: el + (t.timeline.auditEnd - el) * 0.5,
        };
      }
      return sendJson(res, 200, { ok: true });
    }

    if (action === 'finalize') {
      if (t.state !== 'draft_ready') return sendJson(res, 400, { error: '只有“样片就绪”的任务可以直出高清' });
      const model = findModel(t.model_key);
      // 用用户当初请求的参数（样片任务的 params.resolution 被强制压成了 480p，不能拿来直出）
      const req = t.requested || { duration_ms: t.params.duration_ms, resolution: t.params.resolution, steps: t.params.steps };
      const r = createTask({
        model_key: t.model_key,
        prompt: t.prompt,
        params: { duration_ms: req.duration_ms, resolution: req.resolution, steps: req.steps },
        first_frame_name: t.first_frame_name,
        first_frame_data: t.first_frame_data, // 直出要带上原首帧图，否则图生视频会退化成文生视频
        draft: false,
        accelerated: false,
        parent_id: t.id,
        provider: t.provider ? { ...t.provider } : undefined, // 克隆：直出任务跟着样片任务的通道走（克隆后抹父任务 Key 不影响它）
        owner: t.owner, // 直出任务归同一个访客
      });
      if (r.error) return sendJson(res, 400, { error: r.error });
      t.state = 'finalized'; // 样片任务标记为已直出，避免重复点击
      scrubTaskKey(t);        // 父任务终态：抹掉内存里的访客 Key
      return sendJson(res, 200, { task: r.task });
    }
  }

  // ---- 静态文件 ----
  if (method === 'GET') return serveStatic(req, res, pathname);
  sendJson(res, 404, { error: '接口不存在: ' + method + ' ' + pathname });
}

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (e) {
    if (!res.writableEnded) {
      sendJson(res, 500, { error: '服务器内部错误: ' + String(e.message || e) });
    }
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log('\n[启动失败] 端口 ' + PORT + ' 已被占用。');
    console.log('解决办法：换一个端口再启动，例如：');
    console.log('  Windows PowerShell:  $env:PORT=3001; node server.js\n');
  } else {
    console.log('[启动失败]', e.message);
  }
  process.exit(1);
});

setInterval(tick, TICK_MS);
setInterval(pollProviderTasks, 2000); // 上游任务轮询（真实/Mock 模式）

server.listen(PORT, () => {
  console.log('');
  console.log('  ◆ ' + CONFIG.app.name + ' 已启动');
  console.log('  出片模式:     ' + PROVIDER.label + (PROVIDER.reason ? '（' + PROVIDER.reason + '）' : ''));
  if (PROVIDER.name === 'agnes') {
    console.log('  免费通道:     agnes-video-2.5-flash · 720P · 4–12 秒 · 每分钟 1 条（限时免费，以官网公告为准）');
    console.log('  注意:        该通道暂只支持文生视频；需要首帧图可点页面右上角「切换通道」一键换到火山方舟（按提示配 Key 即可）');
  }
  if (PROVIDER.name === 'demo' && (PROVIDER.requested === 'volcengine' || PROVIDER.requested === 'agnes')) {
    console.log('  接入真实出片: 把 API Key 写进 .env 文件后重启，详见《接入AgnesAI.md》或《接入真实模型.md》');
  }
  console.log('  在浏览器打开:  http://localhost:' + PORT);
  console.log('  停止服务:     按 Ctrl + C');
  console.log('');
});
