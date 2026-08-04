/* ============================================================
 * test-browser.js — 浏览器端自动化自测（puppeteer-core + 本机 Chrome）
 * 运行：node test-browser.js
 * 覆盖：页面加载、测试模式、表单校验、循环触发、多任务并行、
 *       暂停/恢复、编辑、删除、闹钟表现、刷新持久化
 * ============================================================ */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = __dirname;
const PORT = 8123;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };

/* ---------- 静态服务器 ---------- */
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

/* ---------- 断言工具 ---------- */
const results = [];
function t(name, ok, detail) {
  results.push({ name, ok, detail: detail || '' });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  [' + detail + ']' : ''));
}

/* ---------- 页面助手 ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function setValue(page, sel, value) {
  await page.evaluate(([s, v]) => {
    const el = document.querySelector(s);
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, [sel, value]);
}
async function addTask(page, { name, interval, mode, sound = true, vibrate = true, enabled = true }) {
  await setValue(page, '#nameInput', name);
  await setValue(page, '#intervalInput', String(interval));
  if (mode !== 'notification') await page.evaluate((m) => { document.querySelector(`input[name="mode"][value="${m}"]`).click(); }, mode);
  const set = (sel, val) => page.evaluate(([s, v]) => { const el = document.querySelector(s); if (el.checked !== v) el.click(); }, [sel, val]);
  await set('#soundCheck', sound);
  await set('#vibrateCheck', vibrate);
  await set('#enabledCheck', enabled);
  await page.evaluate(() => document.getElementById('saveBtn').click());
  await page.waitForFunction((n) => [...document.querySelectorAll('.task-name')].some((e) => e.textContent === n), {}, name);
}
async function cardAction(page, name, act) {
  await page.evaluate(([n, a]) => {
    const card = [...document.querySelectorAll('.task-card')].find((c) => c.querySelector('.task-name').textContent === n);
    if (!card) throw new Error('未找到任务卡片: ' + n);
    card.querySelector(`[data-act="${a}"]`).click();
  }, [name, act]);
}
async function bannerTitles(page) {
  return page.$$eval('.banner .b-title', (els) => els.map((e) => e.textContent));
}
async function clearBanners(page) {
  await page.evaluate(() => { document.getElementById('bannerContainer').innerHTML = ''; });
}

/* ---------- 主流程 ---------- */
async function main() {
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-first-run', '--autoplay-policy=no-user-gesture-required']
  });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => {
    pageErrors.push(String(e));
    page.evaluate((msg) => { window.__pageErrors = window.__pageErrors || []; window.__pageErrors.push(msg); }, String(e)).catch(() => {});
  });
  page.on('dialog', (d) => d.accept()); // 自动确认所有对话框（删除确认）

  try {
    /* T1 页面加载 */
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'load' });
    await page.waitForSelector('#taskForm');
    t('T1 页面加载成功，无未捕获异常', pageErrors.length === 0, pageErrors.join('; '));

    /* T2 开启测试模式（1 分钟 = 1 秒） */
    await page.click('#testModeRow');
    const testModeOn = await page.evaluate(() => document.getElementById('testModeSwitch').checked);
    t('T2 测试模式开关已开启', testModeOn);

    /* T3 表单校验 */
    await page.evaluate(() => document.getElementById('saveBtn').click()); // 空名称
    const err1 = await page.evaluate(() => document.getElementById('formError').textContent);
    await setValue(page, '#nameInput', '喝水');
    await setValue(page, '#intervalInput', '0'); // 间隔 0 越界
    await page.evaluate(() => document.getElementById('saveBtn').click());
    const err2 = await page.evaluate(() => document.getElementById('formError').textContent);
    t('T3 空名称与非法间隔均被拦截', err1.includes('名称') && err2.includes('间隔'), err1 + ' / ' + err2);
    await page.evaluate(() => { document.getElementById('taskForm').reset(); document.getElementById('formError').hidden = true; });

    /* T4 添加任务 A（1 分钟→1 秒循环，通知模式） */
    await addTask(page, { name: '喝水', interval: 1, mode: 'notification' });
    const cardA = await page.evaluate(() => {
      const c = [...document.querySelectorAll('.task-card')].find((x) => x.querySelector('.task-name').textContent === '喝水');
      return { badge: c.querySelector('.badge').textContent, next: c.querySelector('.countdown').textContent };
    });
    t('T4 任务 A 添加成功且运行中', cardA.badge === '运行中' && cardA.next.includes('秒后'), cardA.badge + ' / ' + cardA.next);

    /* T5 循环触发：1 秒间隔，3.5 秒内应至少触发 2 次横幅 */
    await page.waitForFunction(() => document.querySelectorAll('.banner').length >= 2, { timeout: 8000 });
    const titles5 = await bannerTitles(page);
    t('T5 循环触发（≥2 次横幅，含“喝水”）', titles5.filter((x) => x === '喝水').length >= 2, '横幅: ' + JSON.stringify(titles5));

    /* T6 多任务并行：添加任务 B（2 秒循环） */
    await clearBanners(page);
    await addTask(page, { name: '站立活动', interval: 2, mode: 'notification' });
    await page.waitForFunction(() => [...document.querySelectorAll('.banner .b-title')].some((e) => e.textContent === '站立活动'), { timeout: 8000 });
    const titles6 = await bannerTitles(page);
    t('T6 多任务并行（A 与 B 各自循环触发）',
      titles6.includes('站立活动') && titles6.includes('喝水'),
      '横幅: ' + JSON.stringify(titles6));

    /* T7 暂停 A：A 停止触发，B 继续 */
    await cardAction(page, '喝水', 'toggle');
    await page.waitForFunction(() => {
      const c = [...document.querySelectorAll('.task-card')].find((x) => x.querySelector('.task-name').textContent === '喝水');
      return c && c.querySelector('.badge').textContent === '已暂停';
    });
    await clearBanners(page);
    await sleep(3500);
    const titles7 = await bannerTitles(page);
    t('T7 暂停 A 后 A 不再触发、B 仍循环', titles7.every((x) => x === '站立活动') && titles7.length >= 1, '横幅: ' + JSON.stringify(titles7));

    /* T8 恢复 A */
    await cardAction(page, '喝水', 'toggle');
    await page.waitForFunction(() => [...document.querySelectorAll('.banner .b-title')].some((e) => e.textContent === '喝水'), { timeout: 8000 });
    t('T8 恢复 A 后重新开始循环', true);

    /* T9 编辑 B：改名 + 改间隔 + 提醒方式改 both */
    await cardAction(page, '站立活动', 'edit');
    await setValue(page, '#nameInput', '站立拉伸');
    await setValue(page, '#intervalInput', '3');
    await page.evaluate(() => { document.querySelector('input[name="mode"][value="both"]').click(); });
    await page.evaluate(() => document.getElementById('saveBtn').click());
    await page.waitForFunction(() => [...document.querySelectorAll('.task-name')].some((e) => e.textContent === '站立拉伸'));
    t('T9 编辑保存成功（改名/改间隔/改方式）', true);

    /* T10 删除 A */
    await cardAction(page, '喝水', 'delete');
    await page.waitForFunction(() => [...document.querySelectorAll('.task-name')].every((e) => e.textContent !== '喝水'));
    const remain = await page.$$eval('.task-card', (els) => els.length);
    t('T10 删除 A 成功，列表剩 1 个', remain === 1, '剩余 ' + remain + ' 个');

    /* T11 闹钟表现：对 B 点“立即测试”（通知横幅 + 全屏闹钟 + 响铃） */
    await cardAction(page, '站立拉伸', 'preview');
    await page.waitForSelector('#alarmOverlay:not([hidden])', { timeout: 5000 });
    const alarmTitle = await page.$eval('#alarmTitle', (e) => e.textContent);
    await page.click('#alarmStopBtn');
    const overlayHidden = await page.evaluate(() => document.getElementById('alarmOverlay').hidden);
    const titles11 = await bannerTitles(page);
    t('T11 全屏闹钟弹出→停止→关闭，横幅同时出现',
      alarmTitle === '站立拉伸' && overlayHidden && titles11.includes('站立拉伸'),
      '闹钟标题: ' + alarmTitle + ' / 已关闭: ' + overlayHidden);

    /* T12 刷新页面：任务仍在（localStorage 持久化） */
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.task-card');
    const afterReload = await page.evaluate(() => [...document.querySelectorAll('.task-card')].map((c) => ({
      name: c.querySelector('.task-name').textContent,
      badge: c.querySelector('.badge').textContent
    })));
    t('T12 刷新后任务仍在（持久化）',
      afterReload.length === 1 && afterReload[0].name === '站立拉伸' && afterReload[0].badge === '运行中',
      JSON.stringify(afterReload));

    /* T13 测试模式开关双向生效：打开→B 加速触发；关闭→回到分钟级无触发 */
    await page.evaluate(() => { // 先确保全屏闹钟遮罩已关闭（B 为 both 模式会弹闹钟遮挡页面）
      const ov = document.getElementById('alarmOverlay');
      if (!ov.hidden) document.getElementById('alarmStopBtn').click();
    });
    await clearBanners(page);
    const wasOn = await page.evaluate(() => document.getElementById('testModeSwitch').checked);
    if (!wasOn) await page.click('#testModeRow'); // 打开测试模式（3 分钟→3 秒）
    await page.waitForFunction(() => [...document.querySelectorAll('.banner .b-title')].some((e) => e.textContent === '站立拉伸'), { timeout: 8000 });
    await page.evaluate(() => { // 停止循环触发的全屏闹钟，避免遮挡后续点击
      const ov = document.getElementById('alarmOverlay');
      if (!ov.hidden) document.getElementById('alarmStopBtn').click();
    });
    await clearBanners(page);
    await page.click('#testModeRow'); // 关闭测试模式（回到 3 分钟间隔）
    const off = await page.evaluate(() => document.getElementById('testModeSwitch').checked);
    await sleep(4000);                // 覆盖关闭瞬间已在队列中的旧 3 秒触发
    await clearBanners(page);         // 清掉遗留横幅
    await sleep(3500);                // 3 分钟间隔下不应再触发
    const titles13 = await bannerTitles(page);
    const detail13 = await page.evaluate(() => {
      const c = document.querySelector('.task-card');
      return JSON.stringify({
        checked: document.getElementById('testModeSwitch').checked,
        meta: c ? c.querySelector('.task-meta').textContent : '(无卡片)',
        next: c ? c.querySelector('.task-next').textContent : '',
        overlayHidden: document.getElementById('alarmOverlay').hidden,
        pageErrors: window.__pageErrors || []
      });
    });
    t('T13 关闭测试模式后（3 分钟间隔）3.5 秒内无触发', off === false && titles13.length === 0, detail13);

    /* 汇总 */
    const failed = results.filter((r) => !r.ok);
    console.log('\n====================================');
    console.log('浏览器自测：' + (results.length - failed.length) + '/' + results.length + ' 通过');
    if (failed.length) {
      console.log('失败项：' + failed.map((f) => f.name).join('；'));
      process.exitCode = 1;
    } else {
      console.log('全部通过 ✔');
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.error('自测运行出错:', e);
  process.exitCode = 1;
});
