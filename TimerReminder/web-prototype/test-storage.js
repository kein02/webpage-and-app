/* ============================================================
 * test-storage.js — 持久化往返 + 校验联动冒烟测试（Node 直接运行）
 * 模拟 app.js 的 save/load 流程（localStorage → JSON → normalizeTask）
 * ============================================================ */
'use strict';
const assert = require('assert');
const Core = require('./core.js');

let passed = 0;
function ok(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    console.error('  ✗ ' + name + ' -> ' + e.message);
    process.exitCode = 1;
  }
}

// 模拟 localStorage（内存版）
const mem = new Map();
const fakeStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v))
};

// 与 app.js 相同的存取流程
function save(tasks) { fakeStorage.setItem('reminder_tasks_v1', JSON.stringify(tasks)); }
function load() {
  const raw = fakeStorage.getItem('reminder_tasks_v1');
  return raw ? JSON.parse(raw).map(Core.normalizeTask) : [];
}

console.log('== 序列化往返 ==');
ok('任务保存后可完整读回（字段无损）', () => {
  const original = [
    { id: 'a1', name: '喝水', intervalMin: 30, mode: 'both', sound: true, vibrate: false, enabled: true, nextAt: 12345, lastAt: 999 },
    { id: 'a2', name: '站起来', intervalMin: 120, mode: 'notification', sound: false, vibrate: true, enabled: false, nextAt: null, lastAt: null }
  ];
  save(original);
  const back = load();
  assert.deepStrictEqual(back, original);
});
ok('保存的 JSON 中 nextAt 等数字仍为数字（非字符串）', () => {
  save([{ id: 'a1', name: '喝水', intervalMin: 30, mode: 'both', sound: true, vibrate: true, enabled: true, nextAt: 12345, lastAt: null }]);
  const raw = fakeStorage.getItem('reminder_tasks_v1');
  assert.ok(raw.includes('"nextAt":12345'));
});

console.log('== 容错 ==');
ok('无数据时返回空数组', () => {
  mem.clear();
  assert.deepStrictEqual(load(), []);
});
ok('损坏的 JSON 不会崩溃（由调用方 try/catch 处理）', () => {
  mem.set('reminder_tasks_v1', '{oops');
  let threw = false;
  try { load(); } catch (e) { threw = true; }
  assert.ok(threw, 'parse 失败应抛错，app.js 捕获后重置为空');
});
ok('旧数据缺字段时读回自动补默认值', () => {
  mem.set('reminder_tasks_v1', JSON.stringify([{ name: '旧任务' }]));
  const back = load();
  assert.strictEqual(back[0].intervalMin, 30);
  assert.strictEqual(back[0].mode, 'both');
  assert.strictEqual(back[0].enabled, false);
  assert.ok(back[0].id);
});

console.log('== 校验联动（模拟 app.js 保存流程）==');
ok('非法输入不会进入存储', () => {
  mem.clear();
  const bad = Core.validateForm('', 'abc');
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.intervalMin, null);
  // 只有 ok 的输入才会 push 进 tasks（对应 app.js submit 逻辑）
  const tasks = [];
  if (bad.ok) tasks.push(Core.normalizeTask({ name: bad.name, intervalMin: bad.intervalMin }));
  assert.strictEqual(tasks.length, 0);
  save(tasks);
  assert.deepStrictEqual(load(), []);
});
ok('合法输入正常入库', () => {
  mem.clear();
  const good = Core.validateForm('喝水', '15');
  assert.strictEqual(good.ok, true);
  const tasks = [];
  if (good.ok) tasks.push(Core.normalizeTask({ name: good.name, intervalMin: good.intervalMin, enabled: true }));
  save(tasks);
  const back = load();
  assert.strictEqual(back.length, 1);
  assert.strictEqual(back[0].name, '喝水');
  assert.strictEqual(back[0].intervalMin, 15);
  assert.strictEqual(back[0].enabled, true);
});

console.log('\n共 ' + passed + ' 项断言通过' + (process.exitCode ? '（有失败）' : ' ✔'));
if (process.exitCode) process.exit(process.exitCode);
