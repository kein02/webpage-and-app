/* ============================================================
 * test-core.js — core.js 单元测试（Node 直接运行：node test-core.js）
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

console.log('== intervalMs（间隔毫秒计算）==');
ok('普通模式 30 分钟 = 1800000ms', () => {
  assert.strictEqual(Core.intervalMs({ intervalMin: 30 }, false), 30 * 60000);
});
ok('测试模式 30 分钟 = 30000ms（1 分钟=1 秒）', () => {
  assert.strictEqual(Core.intervalMs({ intervalMin: 30 }, true), 30 * 1000);
});
ok('非法间隔回退默认 30 分钟', () => {
  assert.strictEqual(Core.intervalMs({ intervalMin: 'abc' }, false), 30 * 60000);
});
ok('间隔越界被 clamp 到 [1, 9999]', () => {
  assert.strictEqual(Core.intervalMs({ intervalMin: 99999 }, false), 9999 * 60000);
  assert.strictEqual(Core.intervalMs({ intervalMin: 0 }, false), 1 * 60000);
});

console.log('== nextTriggerAt（下次触发时间）==');
const now = 1_000_000_000_000;
ok('nextAt 在未来时沿用', () => {
  const t = { intervalMin: 30, nextAt: now + 5000 };
  assert.strictEqual(Core.nextTriggerAt(t, now, false), now + 5000);
});
ok('nextAt 为空时 = now + 间隔', () => {
  const t = { intervalMin: 5, nextAt: null };
  assert.strictEqual(Core.nextTriggerAt(t, now, false), now + 5 * 60000);
});
ok('nextAt 已过期时重新计算 = now + 间隔', () => {
  const t = { intervalMin: 5, nextAt: now - 1000 };
  assert.strictEqual(Core.nextTriggerAt(t, now, false), now + 5 * 60000);
});

console.log('== normalizeTask（任务标准化）==');
ok('完整字段原样保留', () => {
  const t = Core.normalizeTask({ id: 'a1', name: '喝水', intervalMin: 45, mode: 'alarm', sound: false, vibrate: true, enabled: true, nextAt: 123, lastAt: 456 });
  assert.deepStrictEqual(t, { id: 'a1', name: '喝水', intervalMin: 45, mode: 'alarm', sound: false, vibrate: true, enabled: true, nextAt: 123, lastAt: 456 });
});
ok('缺字段补默认值', () => {
  const t = Core.normalizeTask({});
  assert.strictEqual(t.name, '未命名提醒');
  assert.strictEqual(t.intervalMin, 30);
  assert.strictEqual(t.mode, 'both');
  assert.strictEqual(t.sound, true);
  assert.strictEqual(t.vibrate, true);
  assert.strictEqual(t.enabled, false);
  assert.strictEqual(t.nextAt, null);
});
ok('非法 mode 回退为 both', () => {
  assert.strictEqual(Core.normalizeTask({ mode: 'buzz' }).mode, 'both');
});
ok('非法 nextAt 置为 null', () => {
  assert.strictEqual(Core.normalizeTask({ nextAt: 'oops' }).nextAt, null);
});
ok('id 缺失时自动生成且唯一', () => {
  const a = Core.normalizeTask({}).id;
  const b = Core.normalizeTask({}).id;
  assert.notStrictEqual(a, b);
});

console.log('== validateForm（表单校验）==');
ok('合法输入通过', () => {
  const r = Core.validateForm('喝水', '30');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.name, '喝水');
  assert.strictEqual(r.intervalMin, 30);
});
ok('空名称报错', () => {
  const r = Core.validateForm('   ', '30');
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('名称')));
});
ok('名称超长报错', () => {
  const r = Core.validateForm('一'.repeat(31), '30');
  assert.strictEqual(r.ok, false);
});
ok('非整数间隔报错', () => {
  const r = Core.validateForm('喝水', '2.5');
  assert.strictEqual(r.ok, false);
});
ok('间隔越界报错', () => {
  assert.strictEqual(Core.validateForm('喝水', '0').ok, false);
  assert.strictEqual(Core.validateForm('喝水', '10000').ok, false);
});
ok('名称自动去空格', () => {
  assert.strictEqual(Core.validateForm('  喝水  ', '10').name, '喝水');
});

console.log('== clampInt / genId ==');
ok('clampInt 边界', () => {
  assert.strictEqual(Core.clampInt(5, 1, 10, 3), 5);
  assert.strictEqual(Core.clampInt(-1, 1, 10, 3), 1);
  assert.strictEqual(Core.clampInt(99, 1, 10, 3), 10);
  assert.strictEqual(Core.clampInt('x', 1, 10, 3), 3);
});
ok('genId 为字符串且长度合理', () => {
  const id = Core.genId();
  assert.strictEqual(typeof id, 'string');
  assert.ok(id.length >= 8);
});

console.log('\n共 ' + passed + ' 项断言通过' + (process.exitCode ? '（有失败）' : ' ✔'));
if (process.exitCode) process.exit(process.exitCode);
