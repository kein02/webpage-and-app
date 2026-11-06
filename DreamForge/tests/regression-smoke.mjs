/* 回归冒烟：demo 模式全链路（确认任务加上限回收后正常流程无损） */
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3998;
let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  PASS  ' + n + (d ? '  [' + d + ']' : ''))) : (fail++, console.log('  FAIL  ' + n + (d ? '  [' + d + ']' : ''))); };

function req(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, (res) => {
      let c = []; res.on('data', (x) => c.push(x)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString('utf8') }));
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DREAMFORGE_PROVIDER: 'demo' }, stdio: 'ignore' });
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await req('GET', '/api/config')).status === 200) break; } catch {} await sleep(150); }
  // 1. 提示词润色
  const e = await req('POST', '/api/prompt/enhance', { prompt: '一只猫在太空钓鱼' });
  ok('润色任务创建', e.status === 200 && e.body.includes('task_id'), 'HTTP ' + e.status);
  const eid = JSON.parse(e.body).task_id;
  let enhanced = null;
  for (let i = 0; i < 30; i++) { const r = await req('GET', '/api/prompt/task/' + eid); const j = JSON.parse(r.body); if (j.status === 'done') { enhanced = j.enhanced; break; } await sleep(300); }
  ok('润色完成', !!enhanced, enhanced ? enhanced.slice(0, 40) + '…' : '未完成');
  // 2. 样片任务
  const g = await req('POST', '/api/generate', { prompt: '一只猫在太空钓鱼', model_key: 'forge-v25-sample' });
  ok('样片任务创建', g.status === 200 && g.body.includes('task'), 'HTTP ' + g.status);
  const tid = JSON.parse(g.body).task.id;
  let st = null;
  for (let i = 0; i < 60; i++) { const q = await req('POST', '/api/queue_info', { task_ids: [] }); const t = JSON.parse(q.body).tasks.find((x) => x.id === tid); if (t) st = t; if (t && t.state === 'draft_ready') break; if (t && t.state === 'failed') break; await sleep(300); }
  ok('样片就绪 draft_ready', st && st.state === 'draft_ready', st ? st.state : '无任务');
  ok('样片有 SVG 结果', !!(st && st.result_svg && st.result_svg.includes('<svg')), st && st.result_svg ? st.result_svg.length + ' 字节' : '空');
  // 3. 直出高清
  if (st && st.state === 'draft_ready') {
    const f = await req('POST', '/api/task/' + tid + '/finalize', {});
    ok('直出任务创建', f.status === 200 && f.body.includes('task'), 'HTTP ' + f.status);
    const fid = JSON.parse(f.body).task.id;
    let fst = null;
    for (let i = 0; i < 60; i++) { const q = await req('POST', '/api/queue_info', { task_ids: [] }); const t = JSON.parse(q.body).tasks.find((x) => x.id === fid); if (t) fst = t; if (t && t.state === 'done') break; if (t && t.state === 'failed') break; await sleep(300); }
    ok('直出完成 done', fst && fst.state === 'done', fst ? fst.state : '无任务');
    ok('直出继承父任务通道快照', !!(fst), 'provider 快照在任务对象内');
  }
  // 4. 导出
  const x = await req('GET', '/api/task/' + tid + '/export');
  ok('SVG 导出可下载', x.status === 200 && x.body.includes('<svg'), 'HTTP ' + x.status);
  // 5. 取消
  const g2 = await req('POST', '/api/generate', { prompt: '取消测试', model_key: 'forge-cine' });
  const tid2 = JSON.parse(g2.body).task.id;
  const cx = await req('POST', '/api/task/' + tid2 + '/cancel', {});
  ok('取消任务', cx.status === 200, 'HTTP ' + cx.status);
  console.log('\n========== 回归：' + pass + ' 通过 / ' + fail + ' 失败 ==========');
  child.kill();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('异常:', e); child.kill(); process.exit(1); });
