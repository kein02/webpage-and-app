/* 前端公开模式分支测试（vm + 迷你 DOM 垫片）
 * 覆盖：访客 Key 的请求头透传 / switchChannel 公开分支 / saveChannelKeys 公开分支 /
 *       renderChannelRows 公开模式 UI / clearVisitorKey / 本地模式不受影响
 * 运行：node .dev/ui-public-test.mjs
 */
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; failures.push(name); console.log('  FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}

/* ---------- 迷你 DOM ---------- */
class El {
  constructor(tag) {
    this.tagName = (tag || 'div').toLowerCase();
    this.children = []; this.dataset = {}; this.style = {};
    this._html = ''; this.hidden = false; this.disabled = false;
    this.value = ''; this.textContent = ''; this.className = '';
    this._listeners = {}; this.files = null; this.labels = [];
    this.classList = { toggle: () => {}, add: () => {}, remove: () => {}, contains: () => false };
  }
  set innerHTML(h) { this._html = String(h); this.children = parseStubs(this._html); }
  get innerHTML() { return this._html; }
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
  fire(t, ev) { (this._listeners[t] || []).forEach((fn) => fn(ev || { target: this })); }
  appendChild(c) { this.children.push(c); return c; }
  remove() {} focus() {} closest() { return null; }
  querySelectorAll(sel) { return matchAll(this.children, sel); }
  querySelector(sel) { return matchAll(this.children, sel)[0] || new El('div'); }
}
// 从 innerHTML 字符串里提取 input/button 桩（带 data-* 属性）
function parseStubs(html) {
  const out = [];
  const tagRe = /<(input|button)\b([^>]*)>/g;
  let m;
  while ((m = tagRe.exec(html))) {
    const el = new El(m[1]);
    const attrs = m[2];
    const dm = /data-key="([^"]*)"/.exec(attrs); if (dm) el.dataset.key = dm[1];
    const ds = /data-save="([^"]*)"/.exec(attrs); if (ds) el.dataset.save = ds[1];
    const dw = /data-switch="([^"]*)"/.exec(attrs); if (dw) el.dataset.switch = dw[1];
    const dc = /data-clear="([^"]*)"/.exec(attrs); if (dc) el.dataset.clear = dc[1];
    const da = /data-act="([^"]*)"/.exec(attrs); if (da) el.dataset.act = da[1];
    const dv = /value="([^"]*)"/.exec(attrs); if (dv) el.value = dv[1];
    if (/disabled/.test(attrs)) el.disabled = true;
    const cm = /class="([^"]*)"/.exec(attrs); if (cm) el.className = cm[1];
    out.push(el);
  }
  return out;
}
function matchAll(children, sel) {
  // 支持：input[data-key] / [data-save] / .ch-row[data-channel="x"] / .task-card
  const rowM = /\.ch-row\[data-channel="([^"]*)"\]/.exec(sel);
  if (rowM) return children.filter((c) => c.className.includes('ch-row') && c.dataset.channel === rowM[1]);
  if (sel === 'input[data-key]') return children.filter((c) => c.tagName === 'input' && c.dataset.key);
  const attrM = /^\[data-([a-z]+)\]$/.exec(sel);
  if (attrM) return children.filter((c) => c.dataset[attrM[1]] !== undefined);
  const cls = sel.replace(/^\./, '');
  return children.filter((c) => c.className.split(/\s+/).includes(cls));
}

/* ---------- 环境 ---------- */
const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const byId = {};
let domReady = null;
const document = {
  getElementById: (id) => byId[id] || (byId[id] = new El('div')),
  createElement: (t) => new El(t),
  // 支持 "#id .cls[attr=\"v\"]" 与 "[attr]" 两类选择器（够 app.js 用）
  querySelector(sel) {
    const idM = /^#([\w-]+)/.exec(sel);
    const rest = idM ? sel.slice(idM[0].length).trim() : sel;
    const scope = idM ? (byId[idM[1]] || new El('div')) : { children: [] };
    return matchAll(scope.children, rest)[0] || new El('div');
  },
  querySelectorAll(sel) {
    const idM = /^#([\w-]+)/.exec(sel);
    const rest = idM ? sel.slice(idM[0].length).trim() : sel;
    const scope = idM ? (byId[idM[1]] || new El('div')) : { children: [] };
    return matchAll(scope.children, rest);
  },
  addEventListener: (t, fn) => { if (t === 'DOMContentLoaded') domReady = fn; },
};

let fetchCalls = [];
let configResponse = null;
let channelResponse = null;
const fetch = (p, options) => {
  fetchCalls.push({ path: p, options });
  const body = (() => {
    if (p === '/api/config') return configResponse;
    if (p === '/api/channel') return channelResponse || { provider: { name: 'demo' }, channels: [] };
    if (p === '/api/keys') return { ok: true, stored: false };
    if (p === '/api/queue_info') return { tasks: [], running: 0, max_running: 2 };
    if (String(p).startsWith('/api/prompt/task/')) return { status: 'done', enhanced: 'x' };
    return {};
  })();
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
};

const sandbox = {
  document, localStorage, fetch, console,
  setInterval: () => 0, clearInterval: () => {}, setTimeout: (fn) => 0,
  JSON, Math, Date, Object, Array, String, Number, Boolean, RegExp, Error, Promise, encodeURIComponent, decodeURIComponent,
};
vm.createContext(sandbox);
const appSrc = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
vm.runInContext(appSrc, sandbox);
const run = (code) => vm.runInContext(code, sandbox);

/* ---------- 编排数据 ---------- */
const MODEL = { key: 'forge-v25-sample', name: '样片模型', badge: '草稿', tagline: 't', speed_ms: 8000, options: { duration_ms: [5000], resolution: ['480p', '720p'], steps: { default: 16 } }, supports: ['draft_only', 'first_frame'] };
const PUBLIC_CONFIG = {
  app: { name: 'DreamForge', tagline: 'x', max_running: 2 },
  video_models: [MODEL],
  provider: { name: 'demo', label: '演示模式', requested: 'demo', supports_first_frame: true },
  channels: [
    { name: 'agnes', label: 'Agnes AI · 免费通道', cost: 'c', supports_first_frame: false, key_env: 'AGNES_API_KEY', key_configured: false, active: false },
    { name: 'volcengine', label: '火山方舟 · Seedance', cost: 'c', supports_first_frame: true, key_env: 'VOLC_API_KEY', key_configured: false, active: false },
    { name: 'demo', label: '演示模式', cost: 'c', supports_first_frame: true, key_env: null, key_configured: true, active: true },
  ],
  public_mode: true,
};

(async () => {
  /* ===== 初始化（公开模式） ===== */
  configResponse = PUBLIC_CONFIG;
  fetchCalls = [];
  domReady(); // 触发 init()
  await new Promise((s) => setTimeout(s, 20));
  ok('init 拉取 /api/config', fetchCalls.some((c) => c.path === '/api/config'));
  ok('公开模式徽章为演示模式', run("$('modeBadge').textContent") === '演示模式', run("$('modeBadge').textContent"));

  /* ===== A. 访客 Key 请求头透传 ===== */
  console.log('\n=== A. 访客 Key 请求头透传 ===');
  run("saveVisitor({ active: 'agnes', agnes: { key: 'sk-UI-TEST-KEY', keyRoot: '' } })");
  fetchCalls = [];
  await run("api('/api/prompt/task/x')");
  const last = fetchCalls[fetchCalls.length - 1];
  ok('请求带 X-DreamForge-Key 头', last.options.headers['X-DreamForge-Key'] === 'sk-UI-TEST-KEY', last.options.headers['X-DreamForge-Key']);
  ok('请求带 X-DreamForge-Channel 头', last.options.headers['X-DreamForge-Channel'] === 'agnes');
  run("saveVisitor(null)");
  fetchCalls = [];
  await run("api('/api/prompt/task/x')");
  ok('清空访客配置后不带头', !fetchCalls[0].options.headers['X-DreamForge-Key']);

  /* ===== B. switchChannel：无 Key → 打开配置面板 ===== */
  console.log('\n=== B. switchChannel 公开分支 ===');
  fetchCalls = [];
  run("$('channelModal').hidden = true");
  await run("switchChannel('agnes')");
  ok('无 Key 访客切 agnes：不发请求，改为打开面板', fetchCalls.length === 0 && run("$('channelModal').hidden") === false, 'fetch 次数 ' + fetchCalls.length);

  /* ===== C. switchChannel：有 Key → 切过去并记住 ===== */
  run("saveVisitor({ active: 'demo', agnes: { key: 'sk-UI-TEST-KEY', keyRoot: '' } })");
  channelResponse = { provider: { name: 'agnes', label: '真实出片 · Agnes AI（免费通道）', supports_first_frame: false }, channels: PUBLIC_CONFIG.channels.map((c) => (c.name === 'agnes' ? { ...c, active: true } : { ...c, active: false })) };
  fetchCalls = [];
  await run("switchChannel('agnes')");
  ok('有 Key 访客切 agnes： POST /api/channel', fetchCalls.some((c) => c.path === '/api/channel' && c.options.headers['X-DreamForge-Key'] === 'sk-UI-TEST-KEY'));
  ok('切换后记住访客选择', JSON.parse(store.get('dreamforge_visitor')).active === 'agnes');
  ok('切换后面板关闭', run("$('channelModal').hidden") === true);

  /* ===== D. saveChannelKeys：存 localStorage + 校验 + 切换 ===== */
  console.log('\n=== D. saveChannelKeys 公开分支 ===');
  run("saveVisitor(null)");
  run("config = " + JSON.stringify(PUBLIC_CONFIG));
  run("renderChannelRows()");
  const row = run("$('channelRows').querySelector('.ch-row[data-channel=\"agnes\"]')");
  const keyInput = row.querySelectorAll('input[data-key]').find((i) => i.dataset.key === 'AGNES_API_KEY');
  keyInput.value = 'sk-NEW-UI-KEY';
  fetchCalls = [];
  channelResponse = { provider: { name: 'agnes', label: 'Agnes', supports_first_frame: false }, channels: PUBLIC_CONFIG.channels };
  await run("saveChannelKeys('agnes')");
  ok('先 POST /api/keys 让服务端校验', fetchCalls[0].path === '/api/keys' && fetchCalls[0].options.body.includes('sk-NEW-UI-KEY'));
  ok('再 POST /api/channel 切换', fetchCalls[1] && fetchCalls[1].path === '/api/channel');
  ok('Key 写入访客 localStorage', JSON.parse(store.get('dreamforge_visitor')).agnes.key === 'sk-NEW-UI-KEY');

  /* ===== E. renderChannelRows 公开模式 UI ===== */
  console.log('\n=== E. 公开模式面板 UI ===');
  run("renderChannelRows()");
  const row2 = run("$('channelRows').querySelector('.ch-row[data-channel=\"agnes\"]')");
  const inputs2 = row2.querySelectorAll('input[data-key]');
  ok('输入框可编辑（无 disabled）', inputs2.every((i) => !i.disabled));
  ok('已存 Key 的输入框回填', inputs2.find((i) => i.dataset.key === 'AGNES_API_KEY').value === 'sk-NEW-UI-KEY');
  ok('显示「清除我的 Key」按钮', row2.querySelectorAll('[data-clear]').length === 1);
  const note = run("$('channelRows').children[0]");
  ok('面板顶部有访客 Key 说明', note.textContent.includes('只保存在你这台电脑的浏览器里'));

  /* ===== F. clearVisitorKey ===== */
  console.log('\n=== F. 清除访客 Key ===');
  fetchCalls = [];
  channelResponse = { provider: { name: 'demo', label: '演示模式' }, channels: PUBLIC_CONFIG.channels };
  await run("clearVisitorKey('agnes')");
  ok('localStorage 里的 Key 被删除', !JSON.parse(store.get('dreamforge_visitor') || '{}').agnes);
  ok('回退演示模式（POST /api/channel demo）', fetchCalls.some((c) => c.path === '/api/channel' && c.options.body.includes('demo')));

  /* ===== G. 本地模式不受影响 ===== */
  console.log('\n=== G. 本地模式回归 ===');
  configResponse = Object.assign({}, PUBLIC_CONFIG, { public_mode: false });
  run("config = " + JSON.stringify(configResponse));
  run("saveVisitor({ active: 'agnes', agnes: { key: 'sk-LOCAL' } })");
  fetchCalls = [];
  await run("api('/api/prompt/task/x')");
  ok('本地模式不带头信息', !fetchCalls[0].options.headers['X-DreamForge-Key']);
  fetchCalls = [];
  await run("switchChannel('agnes')");
  ok('本地模式 switchChannel 直接 POST', fetchCalls.some((c) => c.path === '/api/channel'));

  console.log('\n========== UI 测试：' + pass + ' 通过 / ' + fail + ' 失败 ==========');
  if (failures.length) { console.log('失败项：\n - ' + failures.join('\n - ')); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error('测试异常:', e); process.exit(1); });
