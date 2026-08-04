/* ============================================================
 * core.js — 定时提醒 · 核心纯逻辑（无 DOM 依赖）
 * 浏览器中以 window.ReminderCore 暴露；Node 中 module.exports
 * 包含：间隔毫秒计算、下次触发时间、任务标准化、表单校验
 * ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.ReminderCore = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MIN_INTERVAL = 1;     // 分钟
  var MAX_INTERVAL = 9999;  // 分钟（约 7 天）

  function clampInt(v, min, max, def) {
    var n = parseInt(v, 10);
    if (!isFinite(n)) return def;
    return Math.min(max, Math.max(min, n));
  }

  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* 任务间隔毫秒数：普通模式按分钟；测试模式 1 分钟 = 1 秒 */
  function intervalMs(task, testMode) {
    var min = clampInt(task.intervalMin, MIN_INTERVAL, MAX_INTERVAL, 30);
    return testMode ? min * 1000 : min * 60000;
  }

  /* 下次触发时间戳：
   * 已有合法 nextAt（未来）→ 沿用；
   * 否则 → now + 间隔 */
  function nextTriggerAt(task, now, testMode) {
    now = (now == null) ? Date.now() : now;
    if (task.nextAt != null && task.nextAt > now) return task.nextAt;
    return now + intervalMs(task, testMode);
  }

  /* 把任意对象标准化为合法任务（兼容旧数据/缺字段/脏数据） */
  function normalizeTask(t) {
    var mode = ['notification', 'alarm', 'both'].indexOf(t.mode) !== -1 ? t.mode : 'both';
    return {
      id: (t.id != null && t.id !== '') ? String(t.id) : genId(),
      name: (t.name != null ? String(t.name) : '').trim() || '未命名提醒',
      intervalMin: clampInt(t.intervalMin, MIN_INTERVAL, MAX_INTERVAL, 30),
      mode: mode,
      sound: t.sound !== false,
      vibrate: t.vibrate !== false,
      enabled: !!t.enabled,
      nextAt: (t.nextAt != null && isFinite(t.nextAt)) ? Number(t.nextAt) : null,
      lastAt: (t.lastAt != null && isFinite(t.lastAt)) ? Number(t.lastAt) : null
    };
  }

  /* 表单校验，返回 { ok, errors, name, intervalMin } */
  function validateForm(name, intervalMin) {
    var errors = [];
    var trimmed = (name == null ? '' : String(name)).trim();
    if (!trimmed) {
      errors.push('请填写提醒名称');
    } else if (trimmed.length > 30) {
      errors.push('提醒名称不能超过 30 个字');
    }
    var n = Number(intervalMin);
    var numOk = Number.isInteger(n);
    if (!numOk) {
      errors.push('提醒间隔必须是整数（分钟）');
    } else if (n < MIN_INTERVAL || n > MAX_INTERVAL) {
      errors.push('提醒间隔必须在 ' + MIN_INTERVAL + ' ~ ' + MAX_INTERVAL + ' 分钟之间');
    }
    return {
      ok: errors.length === 0,
      errors: errors,
      name: trimmed,
      intervalMin: numOk ? n : null
    };
  }

  return {
    MIN_INTERVAL: MIN_INTERVAL,
    MAX_INTERVAL: MAX_INTERVAL,
    clampInt: clampInt,
    genId: genId,
    intervalMs: intervalMs,
    nextTriggerAt: nextTriggerAt,
    normalizeTask: normalizeTask,
    validateForm: validateForm
  };
});
