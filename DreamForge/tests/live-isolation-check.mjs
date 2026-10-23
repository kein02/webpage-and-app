/* 线上隔离实测（重新部署后）
 * 验证：1) 旧测试任务已随重启清空 2) 每个浏览器只看自己的任务
 *      3) 跨客户端操作/导出被拒 4) 无 clientId 看不到任何任务
 */
const BASE = process.env.DF_BASE || '';
const SC = process.env.DF_SC || '';
if (!BASE || !SC) {
  console.error('用法：DF_BASE=https://你的域名 DF_SC=你的分享码 node tests/live-isolation-check.mjs');
  process.exit(2);
}
const q = (p) => BASE + p + (p.includes('?') ? '&' : '?') + 'sharecode=' + SC;
const hA = { 'Content-Type': 'application/json', 'X-DreamForge-Client': 'live-client-aaa' };
const hB = { 'Content-Type': 'application/json', 'X-DreamForge-Client': 'live-client-bbb' };

async function jpost(path, body, headers) {
  const r = await fetch(q(path), { method: 'POST', headers: headers || { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}

(async () => {
  console.log('1) 无 clientId 请求（旧测试任务是否已清空 / 是否会泄露别人的）');
  const q0 = await jpost('/api/queue_info', {});
  console.log('   任务数:', (q0.json.tasks || []).length, '（应为 0）');

  console.log('\n2) A / B 各建一个任务');
  const gA = await jpost('/api/generate', { prompt: 'A线上私有任务', model_key: 'forge-v1-fast' }, hA);
  const gB = await jpost('/api/generate', { prompt: 'B线上私有任务', model_key: 'forge-v1-fast' }, hB);
  const idA = gA.json.task.id, idB = gB.json.task.id;
  console.log('   A:', gA.status, idA, '| B:', gB.status, idB);

  console.log('\n3) 各自的任务列表');
  const lA = await jpost('/api/queue_info', {}, hA);
  const lB = await jpost('/api/queue_info', {}, hB);
  const tA = (lA.json.tasks || []);
  const tB = (lB.json.tasks || []);
  console.log('   A 看到:', tA.length, '个 ->', tA.map((t) => t.id).join(','));
  console.log('   B 看到:', tB.length, '个 ->', tB.map((t) => t.id).join(','));
  console.log('   A 列表里有 B 的任务:', lA.text.includes(idB), '（应为 false）');
  console.log('   B 列表里有 A 的提示词:', lB.text.includes('A线上私有任务'), '（应为 false）');

  console.log('\n4) 跨客户端操作');
  const xB = await fetch(q('/api/task/' + idB + '/export'), { headers: hA });
  console.log('   A 导出 B 的任务: HTTP', xB.status, '（应为 404）');
  const cB = await jpost('/api/task/' + idB + '/cancel', {}, hA);
  console.log('   A 取消 B 的任务: HTTP', cB.status, '（应为 404）');
  const xA = await fetch(q('/api/task/' + idA + '/export'), { headers: hA });
  console.log('   A 导出自己的任务: HTTP', xA.status, '（200 或 400=还在跑）');

  console.log('\n5) 等 A 的任务出成品，再看 B 是否可见');
  for (let i = 0; i < 20; i++) {
    await new Promise((s) => setTimeout(s, 1000));
    const t = (await jpost('/api/queue_info', {}, hA)).json.tasks || [];
    if (t[0] && t[0].state === 'done') break;
  }
  const lA2 = await jpost('/api/queue_info', {}, hA);
  const lB2 = await jpost('/api/queue_info', {}, hB);
  const doneA = (lA2.json.tasks || [])[0];
  console.log('   A 任务终态:', doneA && doneA.state, '| 有 SVG:', !!(doneA && doneA.result_svg));
  console.log('   B 的列表含 A 的成品:', lB2.text.includes(idA), '（应为 false）');
  console.log('   B 的列表含 A 的提示词:', lB2.text.includes('A线上私有任务'), '（应为 false）');
})().catch((e) => { console.error('实测异常:', e.message); process.exit(1); });
