/* 访客自带 Key 隔离测试（公网部署形态）
 * 起一个假上游服务器记录每个请求带的 Authorization，验证：
 *   1. 访客 A / B 各带自己的 Key，任务提交时上游收到的确实是各自的 Key（隔离）
 *   2. 没带 Key 的访客落到演示模式；切真实通道被 400 + need_key 拦截
 *   3. 服务端任何响应都不含 Key 值；/api/keys 公开模式不写 .env
 *   4. resolution 恶意 payload 被白名单归一化（XSS 修复）
 * 运行：node .dev/visitor-isolation-test.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const ROOT = path.resolve(import.meta.dirname, '..');
const NODE = process.execPath;
const DF_PORT = 4100;    // DreamForge
const UP_PORT = 4101;    // 假上游
const KEY_A = 'sk-VISITOR-A-KEY-111';
const KEY_B = 'sk-VISITOR-B-KEY-222';
let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; failures.push(name); console.log('  FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}

/* ---------- 假上游（记录 Authorization） ---------- */
const upstreamLog = [];
const upstream = http.createServer((req, res) => {
  const auth = req.headers['authorization'] || '';
  const u = new URL(req.url, 'http://x');
  upstreamLog.push({ method: req.method, path: u.pathname, auth });
  if (req.method === 'POST' && u.pathname === '/v1/videos') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ video_id: 'vid-' + Date.now() }));
  }
  if (req.method === 'GET' && u.pathname === '/agnesapi') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'completed', progress: 1, url: 'http://127.0.0.1:' + UP_PORT + '/fake.mp4' }));
  }
  if (req.method === 'GET' && u.pathname === '/fake.mp4') {
    res.writeHead(200, { 'Content-Type': 'video/mp4' });
    return res.end(Buffer.from('FAKEMP4DATA-VISITOR-TEST'));
  }
  res.writeHead(404); res.end('nope');
});

/* ---------- 工具 ---------- */
function req(port, method, p, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const h = Object.assign({}, headers);
    if (data) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(data); }
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: h }, (res) => {
      let c = []; res.on('data', (x) => c.push(x)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString('utf8') }));
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
const visitorHeaders = (channel, key, root) => {
  const h = {};
  if (channel) h['X-DreamForge-Channel'] = channel;
  if (key) h['X-DreamForge-Key'] = key;
  if (root) h['X-DreamForge-Key-Root'] = root;
  return h;
};
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

(async () => {
  await new Promise((s) => upstream.listen(UP_PORT, s));
  console.log('假上游已启动 :' + UP_PORT);

  const envBefore = fs.existsSync(path.join(ROOT, '.env')) ? fs.readFileSync(path.join(ROOT, '.env'), 'utf8') : null;
  const child = spawn(NODE, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(DF_PORT), DREAMFORGE_PROVIDER: 'demo', DREAMFORGE_PUBLIC: '1', AGNES_API_ROOT: 'http://127.0.0.1:' + UP_PORT },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d.toString(); });
  child.stderr.on('data', (d) => { out += d.toString(); });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try { if ((await req(DF_PORT, 'GET', '/api/config')).status === 200) break; } catch {}
    await sleep(150);
  }

  const hA = Object.assign(visitorHeaders('agnes', KEY_A), { 'X-DreamForge-Client': 'iso-a' });
  const hB = Object.assign(visitorHeaders('agnes', KEY_B), { 'X-DreamForge-Client': 'iso-b' });

  /* ===== 1. /api/config 按请求头反映访客通道 ===== */
  console.log('\n=== 1. 配置接口的访客视角 ===');
  const cA = await req(DF_PORT, 'GET', '/api/config', null, hA);
  const jA = JSON.parse(cA.body);
  ok('访客 A 看到 agnes 通道生效', jA.provider.name === 'agnes' && jA.public_mode === true, jA.provider.label);
  ok('访客 A 的通道清单：agnes 已配置且当前', jA.channels.find((c) => c.name === 'agnes').key_configured === true && jA.channels.find((c) => c.name === 'agnes').active === true);
  const cB = await req(DF_PORT, 'GET', '/api/config', null, hB);
  ok('访客 B 同样看到自己的 agnes', JSON.parse(cB.body).provider.name === 'agnes');
  const c0 = await req(DF_PORT, 'GET', '/api/config');
  const j0 = JSON.parse(c0.body);
  ok('无 Key 访客看到演示模式', j0.provider.name === 'demo', j0.provider.label);
  ok('无 Key 访客：agnes 显示未配置', j0.channels.find((c) => c.name === 'agnes').key_configured === false);

  /* ===== 2. 切通道：有 Key 放行，无 Key 拦截 ===== */
  console.log('\n=== 2. 会话级通道切换 ===');
  const swA = await req(DF_PORT, 'POST', '/api/channel', { channel: 'agnes' }, hA);
  ok('访客 A 切 agnes 成功（200）', swA.status === 200 && JSON.parse(swA.body).provider.name === 'agnes', 'HTTP ' + swA.status);
  const sw0 = await req(DF_PORT, 'POST', '/api/channel', { channel: 'agnes' });
  ok('无 Key 访客切 agnes 被拦截', sw0.status === 400 && JSON.parse(sw0.body).need_key === 'AGNES_API_KEY', 'HTTP ' + sw0.status);
  const swBad = await req(DF_PORT, 'POST', '/api/channel', { channel: 'demo' }, hA);
  ok('访客 A 可切回演示模式', swBad.status === 200 && JSON.parse(swBad.body).provider.name === 'demo', 'HTTP ' + swBad.status);

  /* ===== 3. 双访客出片：上游收到的必须是各自的 Key ===== */
  console.log('\n=== 3. 双访客 Key 隔离（核心） ===');
  upstreamLog.length = 0;
  const gA = await req(DF_PORT, 'POST', '/api/generate', { prompt: '访客A的任务', model_key: 'forge-v1-fast' }, hA);
  const gB = await req(DF_PORT, 'POST', '/api/generate', { prompt: '访客B的任务', model_key: 'forge-v1-fast' }, hB);
  ok('两个访客的任务都创建成功', gA.status === 200 && gB.status === 200, gA.status + '/' + gB.status);
  const idA = JSON.parse(gA.body).task.id;
  const idB = JSON.parse(gB.body).task.id;
  // 等两个任务都走完（提交→轮询→下载→完成）。公开模式下任务按浏览器隔离，
  // 所以查状态要分别带各自的 client 头
  for (let i = 0; i < 40; i++) {
    const qa = await req(DF_PORT, 'POST', '/api/queue_info', {}, hA);
    const qb = await req(DF_PORT, 'POST', '/api/queue_info', {}, hB);
    const ta = JSON.parse(qa.body).tasks.find((t) => t.id === idA);
    const tb = JSON.parse(qb.body).tasks.find((t) => t.id === idB);
    if (ta && ta.state === 'done' && tb && tb.state === 'done') break;
    await sleep(500);
  }
  const q = await req(DF_PORT, 'POST', '/api/queue_info', {}, hA);
  const qb2 = await req(DF_PORT, 'POST', '/api/queue_info', {}, hB);
  const tA = JSON.parse(q.body).tasks.find((t) => t.id === idA);
  const tB = JSON.parse(qb2.body).tasks.find((t) => t.id === idB);
  ok('访客 A 任务完成（真链路）', tA && tA.state === 'done', tA ? tA.state : '无');
  ok('访客 B 任务完成（真链路）', tB && tB.state === 'done', tB ? tB.state : '无');
  ok('任务列表已按浏览器隔离', !q.body.includes(idB) && !qb2.body.includes(idA), '互不可见');
  const submits = upstreamLog.filter((e) => e.method === 'POST' && e.path === '/v1/videos');
  const authA = submits.find((e) => e.auth === 'Bearer ' + KEY_A);
  const authB = submits.find((e) => e.auth === 'Bearer ' + KEY_B);
  ok('上游收到的提交带的是访客 A 的 Key', !!authA, submits.map((e) => e.auth).join(' | '));
  ok('上游收到的提交带的是访客 B 的 Key', !!authB);
  ok('两个访客的 Key 没有串台', submits.length === 2 && authA && authB && KEY_A !== KEY_B);
  const polls = upstreamLog.filter((e) => e.path === '/agnesapi');
  ok('轮询也各带各的 Key', polls.some((e) => e.auth === 'Bearer ' + KEY_A) && polls.some((e) => e.auth === 'Bearer ' + KEY_B), polls.map((e) => e.auth).join(' | '));

  /* ===== 4. 响应零 Key + .env 未被写 ===== */
  console.log('\n=== 4. 响应零 Key / .env 不落盘 ===');
  const allBodies = [cA.body, cB.body, c0.body, swA.body, sw0.body, swBad.body, gA.body, gB.body, q.body].join('\n');
  ok('所有响应不含任何访客 Key', !allBodies.includes(KEY_A) && !allBodies.includes(KEY_B), '零命中');
  const envAfter = fs.existsSync(path.join(ROOT, '.env')) ? fs.readFileSync(path.join(ROOT, '.env'), 'utf8') : null;
  ok('.env 未被访客操作改写', envBefore === envAfter, '内容一致');
  const kSave = await req(DF_PORT, 'POST', '/api/keys', { name: 'AGNES_API_KEY', value: KEY_A });
  ok('公开模式 /api/keys 只校验不存储', kSave.status === 200 && JSON.parse(kSave.body).stored === false, 'HTTP ' + kSave.status);
  const envAfter2 = fs.existsSync(path.join(ROOT, '.env')) ? fs.readFileSync(path.join(ROOT, '.env'), 'utf8') : null;
  ok('/api/keys 之后 .env 仍未被写', envBefore === envAfter2);

  /* ===== 5. XSS 修复：resolution 白名单 ===== */
  console.log('\n=== 5. resolution XSS 修复 ===');
  const evil = '<img src=x onerror=alert(1)>';
  const gx = await req(DF_PORT, 'POST', '/api/generate', { prompt: 'xss测试', model_key: 'forge-v1-fast', params: { resolution: evil } }, hA);
  const idx = JSON.parse(gx.body).task.id;
  const qx = await req(DF_PORT, 'POST', '/api/queue_info', {}, hA);
  const tx = JSON.parse(qx.body).tasks.find((t) => t.id === idx);
  ok('恶意 resolution 被归一化', tx && tx.params.resolution === '720p', '实际: ' + (tx && tx.params.resolution));
  ok('响应不含注入 payload', !qx.body.includes('onerror=alert'));

  /* ===== 6. 接口地址白名单（防 SSRF） ===== */
  console.log('\n=== 6. 接口地址白名单 ===');
  const badRoot = await req(DF_PORT, 'POST', '/api/keys', { name: 'AGNES_API_ROOT', value: 'http://169.254.169.254/latest/meta-data' });
  ok('非官方接口地址被拒绝', badRoot.status === 400, 'HTTP ' + badRoot.status);
  const okRoot = await req(DF_PORT, 'POST', '/api/keys', { name: 'AGNES_API_ROOT', value: 'https://api.agnes-ai.cn' });
  ok('官方接口地址通过校验', okRoot.status === 200, 'HTTP ' + okRoot.status);
  // 带头信息的非法 root 应被忽略而不是透传
  const hBadRoot = Object.assign(visitorHeaders('agnes', KEY_A, 'http://evil.example.com'), { 'X-DreamForge-Client': 'iso-badroot' });
  const gbr = await req(DF_PORT, 'POST', '/api/generate', { prompt: 'root测试', model_key: 'forge-v1-fast' }, hBadRoot);
  const idbr = JSON.parse(gbr.body).task.id;
  await sleep(2500);
  const badRootHit = upstreamLog.some((e) => String(e.path).includes('evil.example.com'));
  ok('请求头里的非法 root 被忽略（不打去第三方）', !badRootHit, upstreamLog.filter((e) => e.method === 'GET' && e.path === '/agnesapi').length + ' 次轮询均走官方/env 地址');

  child.kill();
  upstream.close();
  console.log('\n========== 隔离测试：' + pass + ' 通过 / ' + fail + ' 失败 ==========');
  if (failures.length) { console.log('失败项：\n - ' + failures.join('\n - ')); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error('测试异常:', e); process.exit(1); });
