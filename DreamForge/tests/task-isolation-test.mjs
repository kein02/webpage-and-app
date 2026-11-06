/* 任务隔离测试（公开部署形态）
 * 验证：每个浏览器只看得到自己的任务；别人的任务看不到、操作不了、导不出；
 *      无 clientId 的请求（测试脚本/curl）看不到任何任务；
 *      owner 字段不下发前端；本地模式仍全量可见。
 * 运行：node .dev/task-isolation-test.mjs
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import http from 'node:http';

const ROOT = path.resolve(import.meta.dirname, '..');
const NODE = process.execPath;
const DF_PORT = 4120;
let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; failures.push(name); console.log('  FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}

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
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

async function startServer(port, env) {
  const child = spawn(NODE, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d.toString(); });
  child.stderr.on('data', (d) => { out += d.toString(); });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try { if ((await req(port, 'GET', '/api/config')).status === 200) return child; } catch {}
    await sleep(150);
  }
  child.kill();
  throw new Error('服务未就绪：' + out);
}
const hA = { 'X-DreamForge-Client': 'client-aaa-111' };
const hB = { 'X-DreamForge-Client': 'client-bbb-222' };

(async () => {
  /* ===== 公开模式 ===== */
  console.log('=== 公开模式：任务按浏览器隔离 ===');
  let child = await startServer(DF_PORT, { DREAMFORGE_PROVIDER: 'demo', DREAMFORGE_PUBLIC: '1' });

  // 无主任务（模拟测试脚本 curl 建的任务）——不该被任何访客看到
  // 无 clientId 的请求在公开模式下被闸门拒绝（防脚本刷任务）
  const orphan = await req(DF_PORT, 'POST', '/api/generate', { prompt: '部署者测试任务-不该被别人看到', model_key: 'forge-v1-fast' });
  ok('无 clientId 建任务被拒绝', orphan.status === 400, 'HTTP ' + orphan.status);

  // 访客 A / B 各建一个任务
  const gA = await req(DF_PORT, 'POST', '/api/generate', { prompt: 'A的私有任务', model_key: 'forge-v1-fast' }, hA);
  const gB = await req(DF_PORT, 'POST', '/api/generate', { prompt: 'B的私有任务', model_key: 'forge-v1-fast' }, hB);
  const idA = JSON.parse(gA.body).task.id;
  const idB = JSON.parse(gB.body).task.id;
  ok('两个访客都能建任务', gA.status === 200 && gB.status === 200, gA.status + '/' + gB.status);
  ok('创建响应不含 owner 字段', !gA.body.includes('"owner"'), '已隐藏');

  const qA = await req(DF_PORT, 'POST', '/api/queue_info', {}, hA);
  const qB = await req(DF_PORT, 'POST', '/api/queue_info', {}, hB);
  const q0 = await req(DF_PORT, 'POST', '/api/queue_info', {});
  const listA = JSON.parse(qA.body).tasks;
  const listB = JSON.parse(qB.body).tasks;
  const list0 = JSON.parse(q0.body).tasks;

  ok('A 只看到自己的任务', listA.length === 1 && listA[0].id === idA, '数量 ' + listA.length);
  ok('B 只看到自己的任务', listB.length === 1 && listB[0].id === idB, '数量 ' + listB.length);
  ok('A 看不到 B 的提示词', !qA.body.includes('B的私有任务'), '零命中');
  ok('A 看不到部署者的测试任务', !qA.body.includes('部署者测试任务'), '零命中');
  ok('无 clientId 请求看不到任何任务', list0.length === 0, '数量 ' + list0.length);
  ok('任务列表不含 owner 字段', !qA.body.includes('"owner"'), '已隐藏');

  // 跨访客操作：A 对 B 的任务
  const xB = await req(DF_PORT, 'GET', '/api/task/' + idB + '/export', null, hA);
  ok('A 导出 B 的任务被 404 拒绝', xB.status === 404, 'HTTP ' + xB.status);
  const cB = await req(DF_PORT, 'POST', '/api/task/' + idB + '/cancel', {}, hA);
  ok('A 取消 B 的任务被 404 拒绝', cB.status === 404, 'HTTP ' + cB.status);
  const fB = await req(DF_PORT, 'POST', '/api/task/' + idB + '/finalize', {}, hA);
  ok('A 直出 B 的任务被 404 拒绝', fB.status === 404, 'HTTP ' + fB.status);
  const aB = await req(DF_PORT, 'POST', '/api/task/' + idB + '/accelerate', {}, hA);
  ok('A 加速 B 的任务被 404 拒绝', aB.status === 404, 'HTTP ' + aB.status);

  // 自己的任务可以操作（对照）
  const xA = await req(DF_PORT, 'GET', '/api/task/' + idA + '/export', null, hA);
  ok('A 导出自己的任务正常（对照）', xA.status === 200 || xA.status === 400, 'HTTP ' + xA.status + '（任务可能还在跑）');

  // 等任务跑完，确认 A 的列表里有 SVG 而 B 的没有
  let stA = null;
  for (let i = 0; i < 30; i++) {
    const q = await req(DF_PORT, 'POST', '/api/queue_info', {}, hA);
    stA = JSON.parse(q.body).tasks[0];
    if (stA && stA.state === 'done') break;
    await sleep(500);
  }
  ok('A 的任务完成且有 SVG', stA && stA.state === 'done' && !!stA.result_svg, stA ? stA.state + '/' + (stA.result_svg || '').length + 'B' : '无');
  const qA2 = await req(DF_PORT, 'POST', '/api/queue_info', {}, hA);
  const qB2 = await req(DF_PORT, 'POST', '/api/queue_info', {}, hB);
  const listB2 = JSON.parse(qB2.body).tasks;
  ok('B 的列表里只有 B 自己的任务（成品后仍隔离）', listB2.length === 1 && listB2[0].id === idB, '数量 ' + listB2.length);
  ok('A 的提示词不出现在 B 的列表', !qB2.body.includes('A的私有任务'), '零命中');
  ok('B 的列表里没有 A 的任务 id', !qB2.body.includes(idA), '零命中');

  child.kill();
  await sleep(500);

  /* ===== 本地模式：不过滤 ===== */
  console.log('\n=== 本地模式：仍全量可见 ===');
  child = await startServer(DF_PORT + 1, { DREAMFORGE_PROVIDER: 'demo' });
  const l1 = await req(DF_PORT + 1, 'POST', '/api/generate', { prompt: '本地任务1', model_key: 'forge-v1-fast' });
  const l2 = await req(DF_PORT + 1, 'POST', '/api/generate', { prompt: '本地任务2', model_key: 'forge-v1-fast' });
  const ql = await req(DF_PORT + 1, 'POST', '/api/queue_info', {});
  const listL = JSON.parse(ql.body).tasks;
  ok('本地模式无 clientId 也能看到全部任务', listL.length === 2, '数量 ' + listL.length);
  ok('本地模式任务不带 owner 过滤', !ql.body.includes('"owner"'), '已隐藏');

  child.kill();
  console.log('\n========== 任务隔离测试：' + pass + ' 通过 / ' + fail + ' 失败 ==========');
  if (failures.length) { console.log('失败项：\n - ' + failures.join('\n - ')); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error('测试异常:', e); process.exit(1); });
