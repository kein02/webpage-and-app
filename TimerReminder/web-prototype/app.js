/* ============================================================
 * app.js — 定时提醒 · 浏览器原型主逻辑
 * 依赖：core.js（window.ReminderCore）
 * 功能：任务 CRUD、分钟级循环调度（测试模式 1 分钟=1 秒）、
 *       通知横幅、全屏闹钟（Web Audio 持续响铃）、localStorage 持久化
 * ============================================================ */
'use strict';
(function () {
  const Core = window.ReminderCore;
  const STORAGE_KEY = 'reminder_tasks_v1';

  let tasks = [];
  const timers = new Map();        // task.id -> setTimeout handle
  let testMode = false;            // 测试模式：1 分钟 = 1 秒
  let audioCtx = null;             // Web Audio 上下文
  let ringTimer = null;            // 铃声循环句柄
  let currentAlarmTaskId = null;   // 正在响铃的任务（防止重复弹闹钟）

  /* ---------- DOM 引用 ---------- */
  const $ = (s) => document.querySelector(s);
  const taskForm = $('#taskForm');
  const editId = $('#editId');
  const nameInput = $('#nameInput');
  const intervalInput = $('#intervalInput');
  const soundCheck = $('#soundCheck');
  const vibrateCheck = $('#vibrateCheck');
  const enabledCheck = $('#enabledCheck');
  const saveBtn = $('#saveBtn');
  const cancelBtn = $('#cancelBtn');
  const formError = $('#formError');
  const formTitle = $('#formTitle');
  const taskList = $('#taskList');
  const taskCount = $('#taskCount');
  const emptyHint = $('#emptyHint');
  const bannerContainer = $('#bannerContainer');
  const alarmOverlay = $('#alarmOverlay');
  const alarmTitle = $('#alarmTitle');
  const alarmSub = $('#alarmSub');
  const alarmStopBtn = $('#alarmStopBtn');
  const testModeSwitch = $('#testModeSwitch');

  /* ---------- 工具 ---------- */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
  function fmtTime(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function fmtCountdown(ts) {
    let s = Math.max(0, Math.round((ts - Date.now()) / 1000));
    if (s < 60) return s + ' 秒后';
    const m = Math.floor(s / 60);
    if (m < 60) return m + ' 分 ' + (s % 60) + ' 秒后';
    return Math.floor(m / 60) + ' 小时 ' + (m % 60) + ' 分后';
  }

  /* ---------- 持久化 ---------- */
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      tasks = raw ? JSON.parse(raw).map(Core.normalizeTask) : [];
    } catch (e) {
      console.warn('读取本地数据失败，已重置', e);
      tasks = [];
    }
  }
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch (e) {
      console.error('保存失败', e);
    }
  }

  /* ---------- 调度 ---------- */
  function scheduleAll() {
    timers.forEach((h) => clearTimeout(h));
    timers.clear();
    tasks.forEach(schedule);
  }
  function schedule(task) {
    if (!task.enabled) return;
    const next = Core.nextTriggerAt(task, Date.now(), testMode);
    task.nextAt = next;
    const delay = Math.max(0, next - Date.now());
    const handle = setTimeout(() => trigger(task.id), delay);
    timers.set(task.id, handle);
  }

  function trigger(id) {
    const task = tasks.find((t) => t.id === id);
    if (!task || !task.enabled) return;
    task.lastAt = Date.now();
    task.nextAt = null;          // 触发后由 schedule 重排下一轮
    scheduleAll();               // 重排所有启用任务（含本任务下一轮）
    save();
    render();
    if (task.mode === 'notification' || task.mode === 'both') notify(task);
    if (task.mode === 'alarm' || task.mode === 'both') alarm(task);
  }

  /* ---------- 通知横幅（页面内模拟系统通知） ---------- */
  function notify(task) {
    showBanner(task);
    if (task.vibrate && navigator.vibrate) {
      try { navigator.vibrate([200, 100, 200]); } catch (e) { /* 桌面浏览器无震动，忽略 */ }
    }
    // 可选：浏览器系统通知（file:// 下可能受限，失败静默）
    try {
      if ('Notification' in window) {
        if (Notification.permission === 'granted') {
          new Notification('定时提醒', { body: task.name + ' — 该提醒了', tag: 'rem-' + task.id });
        } else if (Notification.permission !== 'denied') {
          Notification.requestPermission();
        }
      }
    } catch (e) { /* 静默 */ }
  }
  function showBanner(task) {
    const el = document.createElement('div');
    el.className = 'banner';
    el.innerHTML =
      '<span class="b-icon">🔔</span>' +
      '<div>' +
      '  <div class="b-title">' + escapeHtml(task.name) + '</div>' +
      '  <div class="b-body">循环提醒 · 每 ' + task.intervalMin + ' 分钟一次</div>' +
      '</div>' +
      '<button class="b-close" title="关闭">✕</button>';
    el.querySelector('.b-close').addEventListener('click', () => dismissBanner(el));
    bannerContainer.appendChild(el);
    setTimeout(() => dismissBanner(el), 5000);
  }
  function dismissBanner(el) {
    if (!el.parentNode) return;
    el.classList.add('out');
    setTimeout(() => el.remove(), 260);
  }

  /* ---------- 全屏闹钟（Web Audio 持续响铃） ---------- */
  function ensureAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') { try { audioCtx.resume(); } catch (e) { /* 自动播放策略限制 */ } }
    return audioCtx;
  }
  function beep() {
    const ctx = ensureAudio();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    osc.start(t);
    osc.stop(t + 0.45);
  }
  function startRing() {
    beep();
    ringTimer = setInterval(beep, 700);
  }
  function stopRing() {
    if (ringTimer) { clearInterval(ringTimer); ringTimer = null; }
  }
  function alarm(task) {
    if (currentAlarmTaskId !== null) return; // 已有闹钟在响，忽略新的
    currentAlarmTaskId = task.id;
    alarmTitle.textContent = task.name;
    alarmSub.textContent = '每 ' + task.intervalMin + ' 分钟循环 · ' + fmtTime(Date.now()) + ' 到点 · 点击下方按钮停止响铃';
    alarmOverlay.hidden = false;
    startRing();
  }
  function stopAlarm() {
    stopRing();
    alarmOverlay.hidden = true;
    currentAlarmTaskId = null;
  }
  alarmStopBtn.addEventListener('click', stopAlarm);

  /* ---------- 渲染 ---------- */
  const MODE_TEXT = { notification: '通知', alarm: '闹钟', both: '通知+闹钟' };
  function render() {
    taskCount.textContent = String(tasks.length);
    emptyHint.hidden = tasks.length > 0;
    taskList.innerHTML = tasks.map(cardHtml).join('');
  }
  function cardHtml(t) {
    const running = t.enabled;
    const extras = [(t.sound ? '响铃' : '静音'), (t.vibrate ? '震动' : '无震动')].join(' · ');
    const nextText = (running && t.nextAt)
      ? fmtTime(t.nextAt) + '（' + fmtCountdown(t.nextAt) + '）'
      : '—';
    return '' +
      '<div class="task-card ' + (running ? '' : 'paused') + '" data-id="' + t.id + '">' +
      '  <div class="task-head">' +
      '    <span class="task-name">' + escapeHtml(t.name) + '</span>' +
      '    <span class="badge ' + (running ? 'running' : 'paused') + '">' + (running ? '运行中' : '已暂停') + '</span>' +
      '  </div>' +
      '  <div class="task-meta">每 ' + t.intervalMin + ' 分钟 · ' + MODE_TEXT[t.mode] + ' · ' + extras + (testMode ? ' · ⚡测试模式' : '') + '</div>' +
      '  <div class="task-next">下次提醒：<span class="countdown" data-next="' + (t.nextAt || '') + '">' + nextText + '</span></div>' +
      '  <div class="task-actions">' +
      '    <button class="btn" data-act="toggle">' + (running ? '暂停' : '恢复') + '</button>' +
      '    <button class="btn" data-act="preview">立即测试</button>' +
      '    <button class="btn" data-act="edit">编辑</button>' +
      '    <button class="btn danger" data-act="delete">删除</button>' +
      '  </div>' +
      '</div>';
  }
  function refreshCountdowns() {
    document.querySelectorAll('.countdown').forEach((el) => {
      const next = el.dataset.next;
      el.textContent = next
        ? fmtTime(Number(next)) + '（' + fmtCountdown(Number(next)) + '）'
        : '—';
    });
  }
  setInterval(refreshCountdowns, 1000);

  /* ---------- 任务操作 ---------- */
  function toggleEnabled(id) {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    t.enabled = !t.enabled;
    if (t.enabled) t.nextAt = null; // 恢复时从现在起重新计间隔
    scheduleAll();
    save();
    render();
  }
  function removeTask(id) {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    if (!confirm('确定删除「' + t.name + '」吗？')) return;
    tasks = tasks.filter((x) => x.id !== id);
    scheduleAll();
    save();
    render();
  }
  function preview(id) { // 立即触发一次提醒表现，不影响调度
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    if (t.mode === 'notification' || t.mode === 'both') notify(t);
    if (t.mode === 'alarm' || t.mode === 'both') alarm(t);
  }
  function openEdit(id) {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    editId.value = t.id;
    nameInput.value = t.name;
    intervalInput.value = String(t.intervalMin);
    const radio = document.querySelector('input[name="mode"][value="' + t.mode + '"]');
    if (radio) radio.checked = true;
    soundCheck.checked = t.sound;
    vibrateCheck.checked = t.vibrate;
    enabledCheck.checked = t.enabled;
    formTitle.textContent = '编辑提醒';
    saveBtn.textContent = '保存修改';
    cancelBtn.hidden = false;
    formError.hidden = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    nameInput.focus();
  }
  function resetForm() {
    taskForm.reset();
    editId.value = '';
    formTitle.textContent = '添加提醒';
    saveBtn.textContent = '保存提醒';
    cancelBtn.hidden = true;
    formError.hidden = true;
  }
  function showFormError(msg) {
    formError.textContent = msg;
    formError.hidden = false;
  }

  /* ---------- 事件绑定 ---------- */
  taskForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const r = Core.validateForm(nameInput.value, intervalInput.value);
    if (!r.ok) { showFormError(r.errors.join('；')); return; }
    const mode = document.querySelector('input[name="mode"]:checked').value;
    const editing = editId.value;
    const existing = editing ? tasks.find((x) => x.id === editing) : null;
    const enabled = enabledCheck.checked;
    if (existing) {
      const intervalChanged = existing.intervalMin !== r.intervalMin;
      Object.assign(existing, {
        name: r.name, intervalMin: r.intervalMin, mode,
        sound: soundCheck.checked, vibrate: vibrateCheck.checked, enabled
      });
      if (intervalChanged || !enabled) existing.nextAt = null;
    } else {
      tasks.push(Core.normalizeTask({
        name: r.name, intervalMin: r.intervalMin, mode,
        sound: soundCheck.checked, vibrate: vibrateCheck.checked, enabled
      }));
    }
    scheduleAll();
    save();
    resetForm();
    render();
  });

  cancelBtn.addEventListener('click', resetForm);

  taskList.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const card = btn.closest('.task-card');
    if (!card) return;
    const act = btn.dataset.act;
    const id = card.dataset.id;
    if (act === 'toggle') toggleEnabled(id);
    else if (act === 'preview') preview(id);
    else if (act === 'edit') openEdit(id);
    else if (act === 'delete') removeTask(id);
  });

  testModeSwitch.addEventListener('change', () => {
    testMode = testModeSwitch.checked;
    tasks.forEach((t) => { t.nextAt = null; }); // 切换后从当前时刻重新起算
    scheduleAll();
    save();
    render();
  });

  /* ---------- 启动 ---------- */
  load();
  scheduleAll();
  render();
})();
