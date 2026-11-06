/* ============================================================
 * DreamForge 造梦工坊 —— 前端逻辑（原生 JS，零依赖）
 *
 * 与 server.js 的接口契约：
 *   GET  /api/config                  → { app, video_models, provider, channels }
 *   POST /api/prompt/enhance          → { task_id }        提示词润色（提交）
 *   GET  /api/prompt/task/:id         → { status, enhanced } 提示词润色（轮询）
 *   POST /api/generate                → { task }            提交生成任务
 *   POST /api/queue_info              → { running, max_running, tasks[] }
 *   POST /api/task/:id/accelerate     → { ok }              加速（剩余时间减半，演示模式）
 *   POST /api/task/:id/cancel         → { ok }              取消
 *   POST /api/task/:id/finalize       → { task }            样片 → 直出高清
 *   GET  /api/task/:id/export         → SVG 文件下载
 *   POST /api/channel                 → { provider, channels, inflight }  切换出片通道
 *   POST /api/keys                    → { ok, channels }  保存 API Key 到 .env（白名单变量）
 * ============================================================ */

'use strict';

/* ---------------- 常量与状态 ---------------- */

const POLL_MS = 800; // 轮询队列间隔（复刻即梦的提交-轮询契约）

const STATE_LABEL = {
  queued: '排队中',
  preprocessing: '预处理',
  generating: '生成中',
  auditing: '审核中',
  done: '已完成',
  draft_ready: '样片就绪',
  finalized: '已直出',
  canceled: '已取消',
  failed: '失败',
};
const RUNNING_STATES = ['queued', 'preprocessing', 'generating', 'auditing'];

/* 通道配置面板：每个通道要填的字段（变量名与 server.js 的 ALLOWED_KEYS 一一对应）。
 * 付费通道（火山方舟）没配 Key 时，一键切换会先弹这个面板让用户填 Key。 */
const CHANNEL_FORM = {
  volcengine: {
    cta: '保存并切换到火山方舟',
    fields: [
      {
        name: 'VOLC_API_KEY', label: 'API Key', type: 'password',
        placeholder: '在火山方舟控制台 → API Key 管理创建',
        help: '需在控制台开通 Seedance 视频模型；按量付费，新用户有免费额度。',
      },
    ],
  },
  siliconflow: {
    cta: '保存并切换到硅基流动',
    fields: [
      {
        name: 'SILICONFLOW_API_KEY', label: 'API Key', type: 'password',
        placeholder: '在 cloud.siliconflow.cn → API 密钥 创建（sk- 开头）',
        help: 'Wan 2.2：约 2 元/条（5 秒 720P），支持首帧图，注册送额度。',
      },
    ],
  },
  minimax: {
    cta: '保存并切换到 MiniMax',
    fields: [
      {
        name: 'MINIMAX_API_KEY', label: 'API Key', type: 'password',
        placeholder: '在 platform.minimaxi.com → 接口密钥 创建',
        help: '海螺 v2.3：约 ¥0.3/秒（768P），支持原生音频与首帧图。注意国内站 Key 与国际站不通用。',
      },
    ],
  },
  zhipu: {
    cta: '保存并切换到智谱',
    fields: [
      {
        name: 'ZHIPU_API_KEY', label: 'API Key', type: 'password',
        placeholder: '在 open.bigmodel.cn → API Keys 创建',
        help: '免费档（CogVideoX-Flash）：0 元、带水印、5–10 秒；高峰期可能排队，会自动重试。',
      },
    ],
  },
  agnes: {
    cta: '保存并切换到 Agnes',
    fields: [
      {
        name: 'AGNES_API_KEY', label: 'API Key', type: 'password',
        placeholder: 'sk- 开头，注册后创建',
        help: '免费通道：720P · 4–12 秒 · 每分钟 1 条，暂不支持本地首帧图。',
      },
      {
        name: 'AGNES_API_ROOT', label: '接口地址（选填）', type: 'text',
        placeholder: 'https://apihub.agnes-ai.com',
        help: '国内站（platform.agnes-ai.cn）的 Key 必须填 https://api.agnes-ai.cn；国际站保持默认。',
      },
    ],
  },
};

let config = null;            // /api/config 返回
let selectedKey = null;       // 当前选中的模型 key
let params = {                // 当前参数（随模型切换重置）
  duration_ms: 5000,
  resolution: '720p',
  steps: 16,
};
const taskEls = new Map();    // taskId -> 任务卡 DOM（增量更新，避免动画重启）
const galleryEls = new Map(); // taskId -> 作品库条目 DOM
const prevStates = new Map(); // taskId -> 上一次 state（用于完成提示）
let pollFail = 0;
let enhancing = false;

/* ---------------- 小工具 ---------------- */

const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function shortText(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function fmtEta(ms) {
  if (ms == null) return '';
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 1 ? '约 ' + s + ' 秒' : '即将完成';
}

function toast(msg, type) {
  const box = $('toasts');
  const div = document.createElement('div');
  div.className = 'toast' + (type ? ' ' + type : '');
  div.textContent = msg;
  box.appendChild(div);
  setTimeout(() => div.remove(), 3800);
}

/* ---------------- 访客自带 Key（公开部署） ----------------
 * 公网部署时服务器不存任何人的 Key。访客在通道面板填自己的 Key，只存在他自己
 * 浏览器的 localStorage，之后每个请求经头信息带给服务器（服务器零存储、零回显）。
 * 存储结构：{ active: 'agnes'|'zhipu'|'volcengine'|'demo', agnes: {key, keyRoot}, zhipu: {key}, volcengine: {key} } */
const VISITOR_STORE = 'dreamforge_visitor';
/* 匿名浏览器 ID：公开部署时任务按它归属——只看得到自己创建的任务，
 * 别人（包括部署者的测试任务）不会出现在你的列表里。本地模式服务端不理会这个值。 */
const CLIENT_STORE = 'dreamforge_client';
function clientId() {
  let v = null;
  try { v = localStorage.getItem(CLIENT_STORE); } catch (e) { /* 隐私模式 */ }
  if (!v) {
    try {
      v = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(CLIENT_STORE, v);
    } catch (e) {
      v = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    }
  }
  return v;
}
function loadVisitor() {
  try { return JSON.parse(localStorage.getItem(VISITOR_STORE) || 'null'); } catch (e) { return null; }
}
function saveVisitor(v) {
  try { v ? localStorage.setItem(VISITOR_STORE, JSON.stringify(v)) : localStorage.removeItem(VISITOR_STORE); } catch (e) { /* 隐私模式等场景下静默失败 */ }
}
function visitorChannelCfg(v, channel) {
  return (v && v[channel]) || null;
}

async function api(path, options) {
  const opts = options || {};
  const headers = Object.assign({}, opts.headers);
  // 匿名浏览器 ID：公开部署下服务端按它隔离任务列表（每个访客只看自己的任务）
  headers['X-DreamForge-Client'] = clientId();
  // 公开模式：把访客自己的 Key/通道经头信息带上（只存在他自己浏览器里）
  const v = loadVisitor();
  if (config && config.public_mode && v && v.active && v.active !== 'demo' && v[v.active] && v[v.active].key) {
    headers['X-DreamForge-Key'] = v[v.active].key;
    headers['X-DreamForge-Channel'] = v.active;
    if (v[v.active].keyRoot) headers['X-DreamForge-Key-Root'] = v[v.active].keyRoot;
  }
  const res = await fetch(path, Object.assign({}, opts, { headers }));
  let data = {};
  try { data = await res.json(); } catch (e) { /* 忽略非 JSON */ }
  if (!res.ok) {
    const err = new Error(data.error || ('请求失败 ' + res.status));
    err.data = data;
    throw err;
  }
  return data;
}

function post(path, body) {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
}

function findModel(key) {
  return (config.video_models || []).find((m) => m.key === key) || null;
}

/* ---------------- 连接状态 ---------------- */

function setConn(ok, text) {
  $('connDot').classList.toggle('ok', !!ok);
  $('connText').textContent = text;
}

/* ---------------- 模型卡片 ---------------- */

function renderModels() {
  const box = $('modelCards');
  box.innerHTML = '';
  for (const m of config.video_models) {
    const card = document.createElement('div');
    card.className = 'model-card' + (m.key === selectedKey ? ' selected' : '');
    card.dataset.key = m.key;
    card.innerHTML =
      '<div class="mc-head">' +
      '<span class="mc-name">' + escapeHtml(m.name) + '</span>' +
      '<span class="mc-badge">' + escapeHtml(m.badge || '') + '</span>' +
      '</div>' +
      '<div class="mc-tagline">' + escapeHtml(m.tagline || '') + '</div>' +
      '<div class="mc-meta">约 ' + Math.round((m.speed_ms || 8000) / 1000) + ' 秒出片' +
      (frameBlockedByChannel(m) ? ' · <span class="mc-flag" title="切换到支持首帧图的通道后即可用">首帧图当前通道不可用</span>' : '') +
      '</div>';
    card.addEventListener('click', () => selectModel(m.key));
    box.appendChild(card);
  }
}

// 模型本身支持首帧图，但当前出片通道不支持（如 Agnes 免费通道只认公网图 URL）
function frameBlockedByChannel(m) {
  return !!(m.supports || []).includes('first_frame') &&
    !!(config && config.provider && config.provider.supports_first_frame === false);
}

function selectModel(key) {
  if (selectedKey === key) return;
  selectedKey = key;
  applyModelDefaults(); // 只有切换模型时才把参数与控件复位到该模型默认形态
  renderModels();
  renderParamBlocks();
}

/* 切换模型（或首次加载）时：把参数、草稿开关、首帧图状态复位到该模型的默认形态。
 * 注意：renderParamBlocks 在点选项时也会被调用，绝不能再碰这些状态——
 * 历史上正是把复位写进了渲染函数，导致用户刚勾的草稿、刚选的首帧文件
 * 一点选项就被打回默认（表现为"草稿选不了/文件被清空"）。 */
function applyModelDefaults() {
  const m = findModel(selectedKey);
  if (!m) return;
  const opt = m.options || {};
  const supports = m.supports || [];

  // 参数复位
  params.duration_ms = (opt.duration_ms || [5000])[0];
  params.resolution = (opt.resolution || ['720p'])[0];
  params.steps = (opt.steps && opt.steps.default) || 16;

  // 草稿模式：draft_only 固定开启且禁用；draft 可自由开关（默认关）；不支持则隐藏
  // （文案直接写 #draftLabel——早先写成 labels[0].lastChild，那其实是 span 后面的
  //   空白文本节点，导致同样的句子在界面上渲染两遍）
  const draftBlock = $('draftBlock');
  const draftToggle = $('draftToggle');
  const draftLabel = $('draftLabel');
  if (supports.includes('draft_only')) {
    draftBlock.hidden = false;
    draftToggle.checked = true;
    draftToggle.disabled = true;
    draftLabel.textContent = ' 该模型固定为样片模式（先出 480P，满意后直出高清）';
  } else if (supports.includes('draft')) {
    draftBlock.hidden = false;
    draftToggle.checked = false;
    draftToggle.disabled = false;
    draftLabel.textContent = ' 草稿模式（先出 480P 样片，满意再直出高清）';
  } else {
    draftBlock.hidden = true;
    draftToggle.checked = false;
    draftToggle.disabled = false;
  }

  // 首帧图：模型支持才显示；当前通道不收本地图时（如 Agnes 免费通道只认公网图 URL）
  // 收起选择器，给出一键切换入口——别让用户选完文件提交时才报错
  const frameBlock = $('firstFrameBlock');
  const frameInput = $('firstFrame');
  const frameName = $('firstFrameName');
  const frameHint = $('firstFrameHint');
  const frameLabel = $('firstFrameLabel');
  const switchBtn = $('switchFrameChannelBtn');
  const supportsFrame = supports.includes('first_frame');
  const channelNoFrame = !!(config && config.provider && config.provider.supports_first_frame === false);
  const publicMode = !!(config && config.public_mode);
  frameBlock.hidden = !supportsFrame;
  frameInput.value = '';
  frameName.textContent = '';
  if (supportsFrame && channelNoFrame) {
    frameInput.hidden = true;
    frameName.hidden = true;
    frameHint.hidden = false;
    frameLabel.textContent = '首帧图片（当前通道不支持）';
    if (publicMode) {
      // 公开模式：不切服务端通道，而是引导访客填自己的火山方舟 Key
      frameHint.textContent = '当前出片通道（' + (config.provider.label || '') + '）不支持本地首帧图。粘贴你自己的火山方舟 Key 即可解锁：';
      switchBtn.hidden = false;
      switchBtn.textContent = '⚡ 配置火山方舟 Key 解锁首帧图';
    } else {
      frameHint.textContent = '当前出片通道（' + (config.provider.label || '') + '）不支持本地首帧图，可一键切换：';
      switchBtn.hidden = false;
      switchBtn.textContent = '⚡ 切换到火山方舟通道（支持首帧图）';
    }
  } else {
    frameInput.hidden = false;
    frameName.hidden = false;
    frameHint.hidden = true;
    frameHint.textContent = '';
    frameLabel.textContent = '首帧图片（图生视频，可选）';
    switchBtn.hidden = true;
  }
}

/* ---------------- 参数区 ---------------- */

function renderChips(container, items, current, onPick) {
  container.innerHTML = '';
  for (const it of items) {
    const chip = document.createElement('span');
    chip.className = 'chip' + (String(it.value) === String(current) ? ' on' : '');
    chip.textContent = it.label;
    chip.addEventListener('click', () => onPick(it.value));
    container.appendChild(chip);
  }
}

function renderParamBlocks() {
  const m = findModel(selectedKey);
  if (!m) return;
  const opt = m.options || {};
  const durs = (opt.duration_ms || [5000]).map((v) => ({ label: (v / 1000) + ' 秒', value: v }));
  const ress = (opt.resolution || ['720p']).map((v) => ({ label: v, value: v }));
  const steps = opt.steps || { min: 10, max: 30, default: 16 };

  // 保留用户当前选择；只有当前值不在该模型选项里时才兜底取第一项
  // （正常流程切换模型时已由 applyModelDefaults 复位，这里是安全网）
  if (!durs.some((d) => d.value === params.duration_ms)) params.duration_ms = durs[0].value;
  if (!ress.some((r) => r.value === params.resolution)) params.resolution = ress[0].value;
  if (!(params.steps >= steps.min && params.steps <= steps.max)) params.steps = steps.default;

  renderChips($('durationChips'), durs, params.duration_ms, (v) => {
    params.duration_ms = v;
    renderParamBlocks();
  });
  renderChips($('resolutionChips'), ress, params.resolution, (v) => {
    params.resolution = v;
    renderParamBlocks();
  });

  const range = $('stepsRange');
  range.min = steps.min;
  range.max = steps.max;
  range.value = params.steps;
  $('stepsValue').textContent = params.steps + ' 步';
}

/* ---------------- 出片通道切换 / 配置 ---------------- */

// 当前通道不支持首帧图时，一键切到支持首帧的真实通道（火山方舟）
function frameChannelTarget() {
  const list = (config && config.channels) || [];
  const t = list.find((c) => c.supports_first_frame && !c.active && c.name !== 'demo');
  return t ? t.name : 'volcengine';
}

async function switchChannel(name) {
  if (config && config.public_mode) {
    // 公开模式：会话级切换——不碰服务端，实际生效靠之后请求带头信息
    const v = loadVisitor() || {};
    const def = (config.channels || []).find((c) => c.name === name);
    if (def && def.key_env && !visitorChannelCfg(v, name)) {
      // 目标通道要 Key 而访客没存过：打开配置面板引导他填自己的
      openChannelModal(name);
      toast('切换到「' + def.label + '」需要先粘贴你自己的 API Key（只存在你的浏览器里）', 'warn');
      return;
    }
  try {
    // 先记住访客的选择：这样紧接着的切换请求才会带上目标通道的 Key 头
    // （否则 active 还是旧值，服务端收到无 Key 请求会误判成"没配 Key"而拒绝）
    saveVisitor(Object.assign({}, v, { active: name }));
    const r = await post('/api/channel', { channel: name });
    applyProvider(r.provider, r.channels);
    closeChannelModal();
    toast('已切换到：' + r.provider.label, 'ok');
  } catch (e) {
    saveVisitor(Object.assign({}, v)); // 切换失败：回滚选择
    if (e.data && e.data.need_key) {
      openChannelModal(e.data.channel || name);
      toast(e.message, 'warn');
    } else {
      toast(e.message, 'err');
    }
  }
  return;
}
  try {
    const r = await post('/api/channel', { channel: name });
    applyProvider(r.provider, r.channels);
    closeChannelModal();
    let msg = '已切换到：' + r.provider.label;
    if (r.inflight) msg += '（' + r.inflight + ' 个在途任务仍在原通道进行，不受影响）';
    toast(msg, 'ok');
  } catch (e) {
    if (e.data && e.data.need_key) {
      // 目标通道需要付费 Key：打开配置面板并定位到该通道，引导用户填 Key
      openChannelModal(e.data.channel || name);
      toast(e.message, 'warn');
    } else {
      toast(e.message, 'err');
    }
  }
}

// 配置面板：把该通道填了的 Key 保存到 .env，再执行切换（留空的字段保持原值）
async function saveChannelKeys(name) {
  const form = CHANNEL_FORM[name];
  if (!form) return;
  const row = document.querySelector('#channelRows .ch-row[data-channel="' + name + '"]');
  const inputs = row ? row.querySelectorAll('input[data-key]') : [];
  const vals = {};
  for (const input of inputs) {
    const v = String(input.value || '').trim();
    if (v) vals[input.dataset.key] = v;
  }
  if (config && config.public_mode) {
    // 公开模式：Key 只存访客浏览器（localStorage），服务器不存储——出片走他自己的额度
    const KEY_ENV = { agnes: 'AGNES_API_KEY', zhipu: 'ZHIPU_API_KEY', siliconflow: 'SILICONFLOW_API_KEY', minimax: 'MINIMAX_API_KEY', volcengine: 'VOLC_API_KEY' };
    const keyName = KEY_ENV[name] || 'AGNES_API_KEY';
    if (!vals[keyName]) {
      toast('请先填写要保存的 Key', 'warn');
      return;
    }
    // 让服务端做一次格式校验（公开模式下服务端只校验、不存储）
    try {
      await post('/api/keys', { name: keyName, value: vals[keyName] });
      if (name === 'agnes' && vals.AGNES_API_ROOT) {
        await post('/api/keys', { name: 'AGNES_API_ROOT', value: vals.AGNES_API_ROOT });
      }
    } catch (e) {
      toast(e.message, 'err');
      return;
    }
    const v = loadVisitor() || {};
    const entry = { key: vals[keyName] };
    if (name === 'agnes' && vals.AGNES_API_ROOT) entry.keyRoot = vals.AGNES_API_ROOT;
    v[name] = entry;
    v.active = name;
    saveVisitor(v);
    // 立即切过去（带头信息请求，服务端解析到访客的 Key）
    try {
      const r = await post('/api/channel', { channel: name });
      applyProvider(r.provider, r.channels);
      closeChannelModal();
      toast('已保存并切换到：' + r.provider.label + '（Key 只存在你的浏览器里）', 'ok');
    } catch (e) {
      toast(e.message, 'err');
    }
    return;
  }
  let saved = 0;
  for (const input of inputs) {
    const v = String(input.value || '').trim();
    if (!v) continue;
    try {
      await post('/api/keys', { name: input.dataset.key, value: v });
      saved++;
    } catch (e) {
      toast(e.message, 'err');
      return;
    }
  }
  if (!saved) {
    toast('请先填写要保存的 Key', 'warn');
    return;
  }
  await switchChannel(name); // 保存成功后切过去；若仍缺 Key 会再次提示
}

// 公开模式：抹掉访客存在浏览器里的某个通道 Key
function clearVisitorKey(name) {
  const v = loadVisitor();
  if (!v) return;
  delete v[name];
  if (v.active === name) v.active = 'demo';
  saveVisitor(v);
  // 会话回退到演示模式并刷新界面
  post('/api/channel', { channel: 'demo' })
    .then((r) => { applyProvider(r.provider, r.channels); renderChannelRows(); })
    .catch(() => {});
  const NICE = { agnes: 'Agnes', zhipu: '智谱', siliconflow: '硅基流动', minimax: 'MiniMax', volcengine: '火山方舟' };
  toast('已清除你保存的 ' + (NICE[name] || name) + ' Key', 'ok');
}

function openChannelModal(focusChannel) {
  renderChannelRows(focusChannel);
  $('channelModal').hidden = false;
}

function closeChannelModal() {
  $('channelModal').hidden = true;
}

function renderChannelRows(focusChannel) {
  const box = $('channelRows');
  box.innerHTML = '';
  const publicMode = !!(config && config.public_mode);
  const visitor = loadVisitor() || {};
  const list = (config && config.channels) || [];
  if (publicMode) {
    const note = document.createElement('div');
    note.className = 'ch-public-note';
    note.textContent = '本实例为公网部署：默认演示模式（免费，不出真片）。想产出真视频，在下面粘贴你自己的 API Key——Key 只保存在你这台电脑的浏览器里，服务器不存储、也看不到，出片走你自己的额度。';
    box.appendChild(note);
  }
  for (const ch of list) {
    const form = CHANNEL_FORM[ch.name];
    const row = document.createElement('div');
    row.className = 'ch-row' + (ch.active ? ' active' : '');
    row.dataset.channel = ch.name;
    // 公开模式下「Key 已配置」看的是访客自己浏览器里存没存，不是服务端配没配
    const visitorHas = publicMode && !!visitorChannelCfg(visitor, ch.name);
    let html =
      '<div class="ch-head">' +
      '<span class="ch-name">' + escapeHtml(ch.label) + '</span>' +
      (ch.active ? '<span class="ch-now">当前</span>' : '') +
      '</div>' +
      '<div class="ch-cost">' + escapeHtml(ch.cost || '') + '</div>';
    if (form) {
      for (const f of form.fields) {
        const savedVal = visitorHas && f.name !== 'AGNES_API_ROOT' ? visitor[ch.name].key : '';
        html +=
          '<label class="ch-field">' +
          '<span class="ch-field-label">' + escapeHtml(f.label) + '</span>' +
          '<input type="' + f.type + '" data-key="' + f.name + '" placeholder="' + escapeHtml(f.placeholder || '') + '" autocomplete="off" spellcheck="false"' +
          (savedVal ? ' value="' + escapeHtml(savedVal) + '"' : '') + ' />' +
          (f.help ? '<span class="ch-help">' + escapeHtml(f.help) + '</span>' : '') +
          '</label>';
      }
      const stateOk = publicMode ? visitorHas : !!ch.key_configured;
      const stateText = ch.key_env
        ? (publicMode ? (visitorHas ? '已保存你的 Key' : '未配置你的 Key') : (ch.key_configured ? 'Key 已配置' : 'Key 未配置'))
        : '无需 Key';
      html +=
        '<div class="ch-actions">' +
        '<span class="ch-key-state' + (stateOk ? ' ok' : '') + '">' +
        stateText +
        '</span>' +
        '<button type="button" class="btn ' + (ch.active ? 'ghost' : 'primary') + '" data-save="' + ch.name + '">' + escapeHtml(form.cta) + '</button>' +
        (visitorHas ? '<button type="button" class="btn ghost small-btn" data-clear="' + ch.name + '">清除我的 Key</button>' : '') +
        '</div>';
    } else {
      // 演示模式：无需 Key，直接切
      html += '<div class="ch-actions"><button type="button" class="btn ' + (ch.active ? 'ghost' : 'primary') + '" data-switch="' + ch.name + '">切换到演示模式</button></div>';
    }
    row.innerHTML = html;
    box.appendChild(row);
  }
  box.querySelectorAll('[data-save]').forEach((b) => b.addEventListener('click', () => saveChannelKeys(b.dataset.save)));
  box.querySelectorAll('[data-switch]').forEach((b) => b.addEventListener('click', () => switchChannel(b.dataset.switch)));
  box.querySelectorAll('[data-clear]').forEach((b) => b.addEventListener('click', () => clearVisitorKey(b.dataset.clear)));
  if (focusChannel) {
    const row = box.querySelector('.ch-row[data-channel="' + focusChannel + '"]');
    const first = row && row.querySelector('input[data-key]');
    if (first) first.focus();
  }
}

// 切换通道后：刷新 config 里的 provider/channels，并重渲染所有依赖通道的 UI
function applyProvider(provider, channels) {
  if (!config) return;
  config.provider = provider;
  if (channels) config.channels = channels;
  applyModeBadge(provider);
  applyFooter(provider);
  applyModelDefaults(); // 首帧图可用性随通道变化
  renderModels();       // 模型卡上的"首帧图不可用"标注随之变化
  renderParamBlocks();
}

/* ---------------- 提示词润色 ---------------- */

async function enhancePrompt() {
  if (enhancing) return;
  const text = $('prompt').value.trim();
  if (!text) {
    toast('请先输入提示词', 'warn');
    return;
  }
  enhancing = true;
  $('enhanceBtn').disabled = true;
  $('enhanceStatus').textContent = '润色中…';
  try {
    const { task_id } = await post('/api/prompt/enhance', { prompt: text });
    // 轮询润色结果（对应即梦 prompt_enhancement/create → query）
    const timer = setInterval(async () => {
      try {
        const r = await api('/api/prompt/task/' + encodeURIComponent(task_id));
        if (r.status === 'done' && r.enhanced) {
          clearInterval(timer);
          $('prompt').value = r.enhanced;
          $('enhanceStatus').textContent = '已润色 ✨';
          enhancing = false;
          $('enhanceBtn').disabled = false;
        } else if (r.status === 'failed') {
          clearInterval(timer);
          $('enhanceStatus').textContent = '润色失败';
          enhancing = false;
          $('enhanceBtn').disabled = false;
        }
      } catch (e) {
        clearInterval(timer);
        $('enhanceStatus').textContent = '润色失败';
        enhancing = false;
        $('enhanceBtn').disabled = false;
      }
    }, 400);
  } catch (e) {
    toast(e.message, 'err');
    $('enhanceStatus').textContent = '';
    enhancing = false;
    $('enhanceBtn').disabled = false;
  }
}

/* ---------------- 提交生成 ---------------- */

async function generate() {
  const m = findModel(selectedKey);
  if (!m) {
    toast('请先选择模型', 'warn');
    return;
  }
  const prompt = $('prompt').value.trim();
  if (!prompt) {
    toast('请先输入提示词', 'warn');
    return;
  }
  // 首帧图：真实出片需要图片内容，读成 base64 一起提交
  const fileInput = $('firstFrame');
  let frameData = null;
  const file = fileInput.files && fileInput.files[0];
  if (file) {
    if (file.size > 9 * 1024 * 1024) {
      toast('首帧图片过大：请压缩到 9MB 以内再试', 'warn');
      return;
    }
    frameData = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('图片读取失败'));
      r.readAsDataURL(file);
    }).catch((e) => {
      toast(e.message, 'err');
      return null;
    });
    if (!frameData) return;
  }
  const body = {
    model_key: m.key,
    prompt,
    params: {
      duration_ms: params.duration_ms,
      resolution: params.resolution,
      steps: Number($('stepsRange').value),
    },
    first_frame_name: file ? file.name : null,
    first_frame_data: frameData,
    draft: $('draftToggle').checked,
    accelerate: false,
  };
  $('generateBtn').disabled = true;
  try {
    const { task } = await post('/api/generate', body);
    toast('已提交任务，进入队列', 'ok');
    refreshQueue(); // 立即拉一次，让任务卡马上出现
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    $('generateBtn').disabled = false;
  }
}

/* ---------------- 任务卡（增量渲染） ---------------- */

function taskActionKey(t) {
  let acts = [];
  if (RUNNING_STATES.includes(t.state)) {
    acts.push('cancel');
    // 演示模式才能中途加速；真实模式速度由上游队列决定
    if (!t.accelerated && config.provider.name === 'demo') acts.push('accelerate');
  }
  if (t.state === 'draft_ready') acts.push('finalize');
  if (t.result_svg || t.video_url) acts.push('export');
  return t.state + '|' + t.accelerated + '|' + acts.join(',');
}

function buildTaskCard(t) {
  const card = document.createElement('div');
  card.className = 'task-card';
  card.dataset.id = t.id;
  card.dataset.state = t.state;
  card.innerHTML =
    '<div class="tc-head">' +
    '<span class="tc-prompt" title="' + escapeHtml(t.prompt) + '">' + escapeHtml(shortText(t.prompt, 36)) + '</span>' +
    '<span class="state-tag"></span>' +
    '</div>' +
    '<div class="tc-meta"></div>' +
    '<div class="progress"><i></i></div>' +
    '<div class="tc-actions"></div>' +
    '<div class="tc-error" hidden></div>' +
    '<div class="tc-result" hidden></div>';
  return card;
}

function updateTaskCard(card, t) {
  card.dataset.state = t.state;

  const tag = card.querySelector('.state-tag');
  const cls = 'state-tag s-' + t.state;
  if (tag.className !== cls) tag.className = cls;
  tag.textContent = (STATE_LABEL[t.state] || t.state) + (t.state === 'queued' && t.retry_count ? ' ×' + t.retry_count : '');

  const meta = card.querySelector('.tc-meta');
  // 注意：这里的值都会进 innerHTML，全部要转义——服务端虽已白名单化 resolution，
  // 前端仍做双层防御（历史数据/接口变更都可能带上未预期内容）
  const parts = [escapeHtml(t.model_name), escapeHtml(t.params.resolution), (t.params.duration_ms / 1000) + 's', t.params.steps + ' 步'];
  if (t.draft) parts.push('样片');
  if (t.accelerated) parts.push('<span class="speedup">⚡ 已加速</span>');
  if (t.state === 'queued' && t.queue_note) {
    // 上游（智谱免费档等）在排队：如实告诉用户在等，而不是让进度条干挂着
    parts.push('上游排队 · 第 ' + ((t.retry_count || 0) + 1) + ' 次重试');
  } else if (RUNNING_STATES.includes(t.state)) {
    parts.push(t.eta_ms != null ? '剩余 ' + fmtEta(t.eta_ms) : '上游处理中…');
  } else if (t.state === 'done' || t.state === 'draft_ready' || t.state === 'finalized') {
    parts.push('进度 100%');
  } else if (t.state === 'canceled') {
    parts.push('已退出队列');
  }
  if (t.usage && t.usage.total_tokens) parts.push(t.usage.total_tokens.toLocaleString() + ' tokens');
  if (t.upstream_id) parts.push('<span class="upstream-id" title="上游任务 ID，遇到问题时请提供它">上游 ' + escapeHtml(t.upstream_id) + '</span>');
  meta.innerHTML = parts.join(' · ');

  // 失败原因
  const errBox = card.querySelector('.tc-error');
  if (t.state === 'failed' && t.error) {
    errBox.hidden = false;
    errBox.textContent = '失败原因：' + t.error;
  } else {
    errBox.hidden = true;
    errBox.textContent = '';
  }

  const bar = card.querySelector('.progress > i');
  bar.style.width = Math.max(0, Math.min(100, t.progress)) + '%';

  // 操作按钮：仅在按钮集合变化时重建（重建按钮不会动视频/动画，不受影响）
  const actions = card.querySelector('.tc-actions');
  const key = taskActionKey(t);
  if (actions.dataset.key !== key) {
    actions.dataset.key = key;
    actions.innerHTML = '';
    const add = (label, act, cls) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + (cls || 'ghost');
      b.textContent = label;
      b.dataset.act = act;
      actions.appendChild(b);
    };
    if (RUNNING_STATES.includes(t.state)) {
      add('取消', 'cancel');
      if (!t.accelerated && config.provider.name === 'demo') add('⚡ 加速', 'accelerate');
    }
    if (t.state === 'draft_ready') {
      add('🎬 直出高清', 'finalize', 'primary');
    }
    if (t.result_svg || t.video_url) {
      add(t.video_url ? '⬇ 下载视频' : '⬇ 下载 SVG', 'export');
    }
  }

  // 结果预览：video_url（真实成片）或 result_svg（演示动画），只注入一次
  if (t.video_url || t.result_svg) {
    const box = card.querySelector('.tc-result');
    if (!box.dataset.done) {
      box.dataset.done = '1';
      box.hidden = false;
      if (t.video_url) {
        const v = document.createElement('video');
        v.src = t.video_url;
        v.controls = true;
        v.preload = 'metadata';
        v.playsInline = true;
        box.appendChild(v);
      } else {
        const wrap = document.createElement('div');
        wrap.className = 'svg-box';
        wrap.innerHTML = t.result_svg;
        box.appendChild(wrap);
      }
    }
  }
}

/* ---------------- 作品库（增量追加） ---------------- */

function buildGalleryItem(t) {
  const item = document.createElement('div');
  item.className = 'gallery-item';
  item.dataset.id = t.id;
  if (t.video_url) {
    const v = document.createElement('video');
    v.src = t.video_url;
    v.controls = true;
    v.preload = 'metadata';
    v.playsInline = true;
    item.appendChild(v);
  } else {
    const wrap = document.createElement('div');
    wrap.className = 'svg-box';
    wrap.innerHTML = t.result_svg;
    item.appendChild(wrap);
  }
  const info = document.createElement('div');
  info.className = 'gi-info';
  info.innerHTML =
    '<div class="gi-prompt" title="' + escapeHtml(t.prompt) + '">' + escapeHtml(shortText(t.prompt, 24)) + '</div>' +
    '<div>' + escapeHtml(t.model_name) + ' · ' + t.params.resolution + ' · ' + (t.params.duration_ms / 1000) + 's' + (t.draft ? ' · 样片' : '') + '</div>';
  item.appendChild(info);
  const actions = document.createElement('div');
  actions.className = 'gi-actions';
  const a = document.createElement('a');
  a.className = 'btn ghost';
  a.href = '/api/task/' + encodeURIComponent(t.id) + '/export';
  a.setAttribute('download', '');
  a.textContent = t.video_url ? '⬇ 下载视频' : '⬇ 下载 SVG';
  actions.appendChild(a);
  item.appendChild(actions);
  return item;
}

/* ---------------- 轮询队列 ---------------- */

async function refreshQueue() {
  try {
    const data = await post('/api/queue_info', {});
    pollFail = 0;
    setConn(true, '已连接');

    $('runningInfo').textContent = '运行中 ' + data.running + ' / ' + data.max_running;

    const tasks = data.tasks || [];

    // 任务卡：新卡片整体插到最上方（保持“最新在上”），老卡片原地更新（不触发动画重启）
    const list = $('taskList');
    const anchor = list.querySelector('.task-card'); // 当前最上方（最新）的已有卡片
    const seen = new Set();
    const newCards = [];
    for (const t of tasks) {
      seen.add(t.id);
      let card = taskEls.get(t.id);
      if (!card) {
        card = buildTaskCard(t);
        taskEls.set(t.id, card);
        newCards.push(card);
      }
      updateTaskCard(card, t);

      // 状态跃迁提示
      const prev = prevStates.get(t.id);
      if (prev && prev !== t.state) {
        if (t.state === 'done') toast('✅ 生成完成：' + shortText(t.prompt, 18), 'ok');
        else if (t.state === 'draft_ready') toast('🎬 样片就绪：' + shortText(t.prompt, 18) + '，可预览后直出', 'ok');
        else if (t.state === 'canceled') toast('任务已取消', 'warn');
        else if (t.state === 'failed') toast('❌ 任务失败：' + shortText(t.error || '请查看任务卡', 30), 'err');
      }
      prevStates.set(t.id, t.state);
    }
    // 新卡按“最新在前”插到锚点之前；没有锚点时按同样顺序追加
    for (const card of newCards) {
      if (anchor) list.insertBefore(card, anchor);
      else list.appendChild(card);
    }
    // 清理滑出窗口（超过 40 条）的旧卡片
    for (const [id, card] of taskEls) {
      if (!seen.has(id)) {
        card.remove();
        taskEls.delete(id);
        prevStates.delete(id);
      }
    }

    // 作品库：有结果的任务（done / draft_ready / finalized）
    const gallery = $('gallery');
    for (const t of tasks) {
      if ((!t.result_svg && !t.video_url) || galleryEls.has(t.id)) continue;
      galleryEls.set(t.id, buildGalleryItem(t));
      gallery.appendChild(galleryEls.get(t.id));
    }

    // 空态提示
    document.querySelectorAll('.task-empty').forEach((n) => n.remove());
    if (!list.children.length) {
      const empty = document.createElement('div');
      empty.className = 'task-empty';
      empty.textContent = '还没有任务，选个模型开始创作吧';
      list.appendChild(empty);
    }
    document.querySelectorAll('.gallery-empty').forEach((n) => n.remove());
    if (!gallery.children.length) {
      const empty = document.createElement('div');
      empty.className = 'gallery-empty';
      empty.textContent = '完成的任务会出现在这里';
      gallery.appendChild(empty);
    }
  } catch (e) {
    pollFail++;
    if (pollFail >= 2) {
      setConn(false, '连接中断，请确认服务已启动');
    }
  }
}

/* ---------------- 任务操作（事件委托） ---------------- */

async function onTaskAction(id, act) {
  try {
    if (act === 'cancel') {
      await post('/api/task/' + encodeURIComponent(id) + '/cancel', {});
      toast('已取消任务', 'warn');
    } else if (act === 'accelerate') {
      await post('/api/task/' + encodeURIComponent(id) + '/accelerate', {});
      toast('⚡ 已加速，剩余时间压缩一半', 'ok');
    } else if (act === 'finalize') {
      const { task } = await post('/api/task/' + encodeURIComponent(id) + '/finalize', {});
      toast('已创建直出任务', 'ok');
    } else if (act === 'export') {
      const a = document.createElement('a');
      a.href = '/api/task/' + encodeURIComponent(id) + '/export';
      a.setAttribute('download', '');
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
    refreshQueue();
  } catch (e) {
    toast(e.message, 'err');
  }
}

/* ---------------- 启动 ---------------- */

function init() {
  // 控件绑定
  $('enhanceBtn').addEventListener('click', enhancePrompt);
  $('generateBtn').addEventListener('click', generate);
  $('stepsRange').addEventListener('input', () => {
    $('stepsValue').textContent = $('stepsRange').value + ' 步';
  });
  $('firstFrame').addEventListener('change', () => {
    const f = $('firstFrame').files && $('firstFrame').files[0];
    $('firstFrameName').textContent = f ? '已选择：' + f.name : '';
  });
  $('taskList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const card = btn.closest('.task-card');
    if (card) onTaskAction(card.dataset.id, btn.dataset.act);
  });
  $('channelBtn').addEventListener('click', () => openChannelModal());
  $('channelModalClose').addEventListener('click', closeChannelModal);
  $('switchFrameChannelBtn').addEventListener('click', () => {
    // 公开模式：服务端通道不可切，打开面板引导访客填自己的火山方舟 Key
    if (config && config.public_mode) openChannelModal('volcengine');
    else switchChannel(frameChannelTarget());
  });
  // 点模态框遮罩空白处关闭
  $('channelModal').addEventListener('click', (e) => {
    if (e.target === $('channelModal')) closeChannelModal();
  });

  // 拉取模型注册表（对应即梦 SSR 下发 model_list：前端零硬编码）
  api('/api/config')
    .then((cfg) => {
      config = cfg;
      selectedKey = cfg.video_models[0].key;
      applyModelDefaults(); // 初始参数与控件形态取第一个模型的默认值，与切换模型的行为一致
      renderModels();
      renderParamBlocks();
      setConn(true, '已连接');
      applyModeBadge(cfg.provider);
      applyFooter(cfg.provider);
      refreshQueue();
      setInterval(refreshQueue, POLL_MS);
    })
    .catch((e) => {
      setConn(false, '连接失败：请先启动服务');
      toast('无法连接服务：' + e.message, 'err');
    });
}

// 顶栏出片模式徽章
function applyModeBadge(p) {
  p = p || { name: 'demo' };
  const el = $('modeBadge');
  if (p.name === 'agnes') {
    el.textContent = '🔥 真实出片 · Agnes AI';
    el.className = 'mode-badge ok';
  } else if (p.name === 'zhipu') {
    el.textContent = '🔥 真实出片 · 智谱（免费）';
    el.className = 'mode-badge ok';
  } else if (p.name === 'siliconflow') {
    el.textContent = '🔥 真实出片 · 硅基流动 Wan';
    el.className = 'mode-badge ok';
  } else if (p.name === 'minimax') {
    el.textContent = '🔥 真实出片 · MiniMax 海螺';
    el.className = 'mode-badge ok';
  } else if (p.name === 'volcengine') {
    el.textContent = '🔥 真实出片 · 火山方舟';
    el.className = 'mode-badge ok';
  } else if (p.name === 'mock') {
    el.textContent = 'Mock 测试';
    el.className = 'mode-badge warn';
  } else if (['agnes', 'zhipu', 'siliconflow', 'minimax', 'volcengine'].includes(p.requested)) {
    el.textContent = '演示模式（未配置 Key）';
    el.className = 'mode-badge warn';
    toast('未检测到 API Key，当前为演示模式：' + (p.reason || ''), 'warn');
  } else {
    el.textContent = '演示模式';
    el.className = 'mode-badge warn';
  }
}

/* 页脚说明：前半句固定（产品定位），后半句跟着当前出片通道走——
 * 演示模式说不调外部模型，真实模式就说在调真实模型，别让页脚说谎。 */
const FOOTER_BASE = '本工具为教学演示：复刻自即梦AI 的架构逆向分析（服务端模型注册表 / 提交-轮询 / 草稿-直出 / 独立润色服务 / 页面内一键切换出片通道）。';
const FOOTER_MODE = {
  demo: '当前为演示模式：生成结果为程序化 SVG 动画，不调用任何外部 AI 模型。',
  agnes: '当前为 Agnes AI 免费通道：正在调用真实模型生成 MP4（720P · 4–12 秒 · 每分钟 1 条，限时免费）。',
  zhipu: '当前为智谱 CogVideoX 免费通道：正在调用真实模型生成 MP4（720P/1080P · 5–10 秒 · 0 元，成片带水印）。',
  siliconflow: '当前为硅基流动 Wan 2.2 通道：正在调用真实模型生成 MP4（720P · 约 2 元/条，支持首帧图）。',
  minimax: '当前为 MiniMax 海螺通道：正在调用真实模型生成 MP4（768P/1080P · 约 ¥0.3/秒，支持原生音频）。',
  volcengine: '当前为火山方舟通道：正在调用真实模型生成 MP4（支持首帧图 / 草稿样片，按量付费）。',
  mock: '当前为 Mock 自测模式：不调用外部服务，用本地样本视频模拟上游出片。',
};
function applyFooter(p) {
  p = p || { name: 'demo' };
  $('footerText').textContent = FOOTER_BASE + (FOOTER_MODE[p.name] || FOOTER_MODE.demo);
}

document.addEventListener('DOMContentLoaded', init);
