/* 线上部署实测：公开模式字段 / demo 出片 / 访客 Key 视角
 * 用法（不把任何真实链接/分享码写进仓库）：
 *   DF_BASE=https://你的域名 DF_SC=你的sharecode node tests/live-check.mjs
 */
const BASE = process.env.DF_BASE || '';
const SC = process.env.DF_SC || '';
const TEST_KEY = 'sk-LIVECHECK-placeholder';

if (!BASE || !SC) {
  console.error('用法：DF_BASE=https://你的域名 DF_SC=你的分享码 node tests/live-check.mjs');
  process.exit(2);
}

(async () => {
  // 1. 默认访客视角
  const c1 = await fetch(BASE + '/api/config?sharecode=' + SC);
  const j1 = await c1.json();
  console.log('1) 默认访客:');
  console.log('   public_mode:', j1.public_mode);
  console.log('   provider:', j1.provider.name, '-', j1.provider.label);
  console.log('   channels:', j1.channels.map((c) => c.name + '(' + (c.key_configured ? '已配置' : '未配置') + (c.active ? '·当前' : '') + ')').join(' | '));
  console.log('   响应含 sk-:', /sk-/.test(JSON.stringify(j1)));

  // 2. demo 出片
  const CLIENT = { 'Content-Type': 'application/json', 'X-DreamForge-Client': 'live-check-client' };
  const g = await fetch(BASE + '/api/generate?sharecode=' + SC, {
    method: 'POST', headers: CLIENT,
    body: JSON.stringify({ prompt: '线上部署验证：一只猫在太空钓鱼', model_key: 'forge-v1-fast' }),
  });
  const jg = await g.json();
  console.log('2) demo 建任务: HTTP', g.status, '| task:', jg.task && jg.task.id, '| state:', jg.task && jg.task.state);
  // 等它跑完（demo 约 6 秒）
  let st = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((s) => setTimeout(s, 1000));
    const q = await fetch(BASE + '/api/queue_info?sharecode=' + SC, { method: 'POST', headers: CLIENT, body: '{}' });
    const jq = await q.json();
    const t = (jq.tasks || []).find((x) => x.id === jg.task.id);
    if (t) st = t;
    if (t && (t.state === 'done' || t.state === 'failed')) break;
  }
  console.log('   任务终态:', st ? st.state : '未找到', '| 有 SVG 结果:', !!(st && st.result_svg));

  // 3. 访客自带 Key 视角（不落任何存储）
  const c3 = await fetch(BASE + '/api/config?sharecode=' + SC, {
    headers: { 'X-DreamForge-Key': TEST_KEY, 'X-DreamForge-Channel': 'agnes' },
  });
  const raw3 = await c3.text();
  const j3 = JSON.parse(raw3);
  console.log('3) 带头信息的访客视角:');
  console.log('   provider:', j3.provider.name, '-', j3.provider.label);
  console.log('   agnes key_configured:', j3.channels.find((c) => c.name === 'agnes').key_configured, '| active:', j3.channels.find((c) => c.name === 'agnes').active);
  console.log('   响应不含测试 Key:', !raw3.includes(TEST_KEY));

  // 4. 无 Key 切真实通道被拦截
  const ch = await fetch(BASE + '/api/channel?sharecode=' + SC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: 'agnes' }),
  });
  const jch = await ch.json();
  console.log('4) 无 Key 切 agnes: HTTP', ch.status, '| need_key:', jch.need_key || '(无)');
})().catch((e) => { console.error('实测异常:', e.message); process.exit(1); });
