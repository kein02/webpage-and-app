/* 分享前安全测试：目录穿越 / 公开部署锁 / 响应零 Key
 * 运行：node .dev/security-test.mjs
 * 通过标准：全部 PASS，任何一条 FAIL 都会以退出码 1 结束
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const ROOT = path.resolve(import.meta.dirname, '..');
const NODE = process.execPath;
const FAKE_KEY = 'sk-FAKE-KEY-FOR-TEST-ONLY-NOT-REAL'; // 假 Key（格式明显不成立，避免被密钥扫描误报）
let pass = 0, fail = 0;
const failures = [];

const ENV_PATH = path.join(ROOT, '.env');
/* 刚 clone 下来的仓库没有 .env（它被 gitignore）。测试必须能在这种干净环境下跑通，
 * 所以所有读取都走这个助手：不存在就返回 null，而不是抛 ENOENT。 */
const readEnvMaybe = () => (fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : null);

function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; failures.push(name + (detail ? ' [' + detail + ']' : '')); console.log('  FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}

function req(port, method, urlPath, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const h = Object.assign({}, headers);
    if (data) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(data); }
    const r = http.request({
      host: '127.0.0.1', port, method, path: urlPath, headers: h,
    }, (res) => {
      let chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function startServer(port, extraEnv) {
  const child = spawn(NODE, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DREAMFORGE_PROVIDER: 'demo', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d.toString(); });
  child.stderr.on('data', (d) => { out += d.toString(); });
  // 等监听就绪
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const r = await req(port, 'GET', '/api/config');
      if (r.status === 200) return { child, out: () => out };
    } catch { /* 还没起来 */ }
    await new Promise((s) => setTimeout(s, 150));
  }
  child.kill();
  throw new Error('服务器 10 秒内未就绪。输出：\n' + out);
}

/* ============ A. 目录穿越攻击 ============ */
async function testTraversal() {
  console.log('\n=== A. 目录穿越攻击（demo 模式） ===');
  // 造一个 public 的同级目录 public-evil，验证 startsWith 前缀绕过已被修掉
  const evilDir = path.join(ROOT, 'public-evil');
  const evilFile = path.join(evilDir, 'secret.txt');
  fs.mkdirSync(evilDir, { recursive: true });
  fs.writeFileSync(evilFile, 'SECRET_MARKER_9F3A 同级目录穿越靶子');

  const { child } = await startServer(3995, {});
  try {
    const cases = [
      ['/../server.js', '经典 ../ 穿越', [403, 404]],
      ['/..%2f..%2fserver.js', 'URL 编码 ../', [403, 404]],
      ['/..\\..\\server.js', '反斜杠 ..\\', [403, 404]],
      ['/%2e%2e%2fserver.js', '全编码 %2e%2e%2f', [403, 404]],
      ['/.env', '直接要 .env（不在 public）', [403, 404]],
      ['/../.env', '穿越要 .env', [403, 404]],
      ['/..%2f.env', '编码穿越要 .env', [403, 404]],
      ['/..%252f..%252fserver.js', '双重编码（解码一次后仍是编码串）', [403, 404]],
      ['/..%5c..%5cserver.js', '编码反斜杠', [403, 404]],
      ['/%2e%2e/%2e%2e/server.js', '混合编码多级穿越', [403, 404]],
      ['/../public-evil/secret.txt', '同级目录前缀绕过（旧代码的洞）', [403, 404]],
      ['/..%2Fpublic-evil%2Fsecret.txt', '编码版同级目录绕过', [403, 404]],
      ['/../README.md', '穿越要 README', [403, 404]],
      ['/videos/../../server.js', 'videos 内穿越', [403, 404]],
    ];
    for (const [p, name, allowed] of cases) {
      const r = await req(3995, 'GET', p);
      const leaks = /require\(|SECRET_MARKER_9F3A|sk-|DREAMFORGE_PUBLIC/.test(r.body);
      ok('穿越 ' + name, allowed.includes(r.status) && !leaks, 'HTTP ' + r.status + (leaks ? '，且响应含敏感内容！' : ''));
    }
    // 畸形 URI 不能打挂服务器
    const r1 = await req(3995, 'GET', '/%zz');
    ok('畸形 URI /%zz 返回 400', r1.status === 400, 'HTTP ' + r1.status);
    const r2 = await req(3995, 'GET', '/api/config');
    ok('畸形请求后服务器仍存活', r2.status === 200, 'HTTP ' + r2.status);
    // 正常路径不能被打断
    const r3 = await req(3995, 'GET', '/');
    ok('首页正常访问', r3.status === 200 && r3.body.includes('DreamForge'), 'HTTP ' + r3.status);
    const r4 = await req(3995, 'GET', '/app.js');
    ok('静态资源正常访问', r4.status === 200 && r4.body.includes('function'), 'HTTP ' + r4.status);
    const r5 = await req(3995, 'GET', '/public/../app.js');
    ok('public 内归一化路径仍可用', r5.status === 200, 'HTTP ' + r5.status);
  } finally {
    child.kill();
    fs.rmSync(evilDir, { recursive: true, force: true });
  }
}

/* ============ B. 公开部署锁 ============ */
async function testPublicLock() {
  console.log('\n=== B. 公开部署（DREAMFORGE_PUBLIC=1）语义 ===');
  const envBefore = readEnvMaybe();
  const { child } = await startServer(3996, { DREAMFORGE_PUBLIC: '1' });
  try {
    const c = await req(3996, 'GET', '/api/config');
    ok('/api/config 标记 public_mode', c.status === 200 && c.body.includes('"public_mode":true'), 'HTTP ' + c.status);
    ok('/api/config 不泄漏假 Key', !c.body.includes(FAKE_KEY), '零命中');

    // 公开模式：/api/keys 只校验不存储（访客 Key 存他自己浏览器）
    const k = await req(3996, 'POST', '/api/keys', { name: 'VOLC_API_KEY', value: FAKE_KEY });
    ok('POST /api/keys 不存储（stored:false）', k.status === 200 && k.body.includes('"stored":false'), 'HTTP ' + k.status);

    // 公开模式：无 Key 访客切真实通道被 400 + need_key 拦截（不是 403，是会话级引导）
    const ch = await req(3996, 'POST', '/api/channel', { channel: 'agnes' });
    ok('POST /api/channel 无 Key 被拦截', ch.status === 400 && ch.body.includes('need_key'), 'HTTP ' + ch.status);

    // 带访客 Key 的会话级切换放行，但服务端状态不变
    const ch2 = await req(3996, 'POST', '/api/channel', { channel: 'agnes' }, { 'X-DreamForge-Key': FAKE_KEY, 'X-DreamForge-Channel': 'agnes' });
    ok('POST /api/channel 带 Key 会话级放行', ch2.status === 200 && ch2.body.includes('"name":"agnes"'), 'HTTP ' + ch2.status);

    // 接口地址白名单（防把服务当代理）
    const badRoot = await req(3996, 'POST', '/api/keys', { name: 'AGNES_API_ROOT', value: 'http://169.254.169.254/' });
    ok('非官方接口地址被拒绝', badRoot.status === 400, 'HTTP ' + badRoot.status);

    const home = await req(3996, 'GET', '/');
    ok('公开模式下页面仍可访问', home.status === 200, 'HTTP ' + home.status);

    const CLIENT = { 'X-DreamForge-Client': 'sec-test-client' };
    const g = await req(3996, 'POST', '/api/generate', { prompt: '公开锁测试', model_key: 'forge-v1-fast' }, CLIENT);
    ok('公开模式下 demo 出片不受影响', g.status === 200 && g.body.includes('task'), 'HTTP ' + g.status);
    const gNoClient = await req(3996, 'POST', '/api/generate', { prompt: '无客户端头', model_key: 'forge-v1-fast' });
    ok('无 clientId 建任务被闸门拒绝', gNoClient.status === 400, 'HTTP ' + gNoClient.status);
    const LIMIT = { 'X-DreamForge-Client': 'sec-limit-client' }; // 独立访客，避免前面任务的计数干扰
    const g3 = await req(3996, 'POST', '/api/generate', { prompt: '超限测试1', model_key: 'forge-v1-fast' }, LIMIT);
    const g4 = await req(3996, 'POST', '/api/generate', { prompt: '超限测试2', model_key: 'forge-v1-fast' }, LIMIT);
    const g5 = await req(3996, 'POST', '/api/generate', { prompt: '超限测试3', model_key: 'forge-v1-fast' }, LIMIT);
    ok('单访客在途任务有上限（第 3 个被 429）', g3.status === 200 && g4.status === 200 && g5.status === 429, g3.status + '/' + g4.status + '/' + g5.status);

    // 访客 Key 走请求头时任务按其 Key 解析（不落服务端）
    const g2 = await req(3996, 'POST', '/api/generate', { prompt: '访客Key测试', model_key: 'forge-v1-fast' }, { 'X-DreamForge-Key': FAKE_KEY, 'X-DreamForge-Channel': 'agnes', 'X-DreamForge-Client': 'sec-test-client-2' });
    ok('访客带 Key 可建任务', g2.status === 200, 'HTTP ' + g2.status);

    const envAfter = readEnvMaybe();
    ok('.env 未被改写', envBefore === envAfter, '内容一致');
  } finally {
    child.kill();
  }
}

/* ============ C. 接口响应零 Key ============ */
async function testZeroKeyLeak() {
  console.log('\n=== C. 接口响应零 Key（volcengine + 假 Key） ===');
  const { child } = await startServer(3997, {
    DREAMFORGE_PROVIDER: 'volcengine',
    VOLC_API_KEY: FAKE_KEY,
  });
  try {
    const c = await req(3997, 'GET', '/api/config');
    ok('/api/config 不含 Key 值', !c.body.includes(FAKE_KEY), '零命中');
    ok('/api/config 不含 sk- 串', !/sk-/.test(c.body), '零命中');
    ok('/api/config 只报 key_configured 布尔', c.body.includes('"key_configured"'), '字段在');

    const q = await req(3997, 'POST', '/api/queue_info', { task_ids: [] });
    ok('/api/queue_info 不含 Key 值', !q.body.includes(FAKE_KEY), '零命中');

    // 假 Key 必然被上游 401，错误文案不得回显 Key
    const g = await req(3997, 'POST', '/api/generate', { prompt: '零泄漏测试', model_key: 'forge-v1-fast' });
    ok('假 Key 下任务能创建', g.status === 200, 'HTTP ' + g.status);
    let leaked = false, state = '';
    for (let i = 0; i < 20; i++) {
      await new Promise((s) => setTimeout(s, 1000));
      const qq = await req(3997, 'POST', '/api/queue_info', { task_ids: [] });
      if (qq.body.includes(FAKE_KEY)) { leaked = true; break; }
      try {
        const j = JSON.parse(qq.body);
        const t = (j.tasks || [])[0];
        if (t) state = t.state;
        if (t && (t.state === 'failed' || t.state === 'generating')) break;
      } catch { /* 继续等 */ }
    }
    ok('轮询全程不泄漏 Key', !leaked, '任务状态: ' + state);

    const q2 = await req(3997, 'POST', '/api/queue_info', { task_ids: [] });
    ok('最终响应不含 Key 值', !q2.body.includes(FAKE_KEY), '零命中');
    const m = q2.body.match(/"error":"([^"]*)"/);
    if (m) console.log('       （上游错误文案样例: ' + m[1].slice(0, 80) + '）');
  } finally {
    child.kill();
  }
}

/* ============ D. 静态目录里不能有敏感文件 ============ */
function testSensitiveFiles() {
  console.log('\n=== D. public 目录敏感文件检查 ===');
  const pub = path.join(ROOT, 'public');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
  const files = walk(pub);
  const bad = files.filter((f) => /\.(env|key|pem|log)$|(^|[\\/])\.env/i.test(f));
  ok('public 下无 .env/.key/.pem/.log 文件', bad.length === 0, bad.map((f) => path.basename(f)).join(',') || '干净');

  /* 该断言的是 .env.example——它是唯一会进仓库、会进便携包的那份，必须永远空模板。
   * 开发者本机的 .env 放自己的 Key 是正常用法（.gitignore 已排除，打包脚本另有安全闸），
   * 所以对 .env 只打印说明、不作断言：否则开发机上 npm test 永远红这一条。 */
  const keyVars = (txt) => (txt || '').split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+(_API_KEY|_KEY)=/.test(l))
    .filter((l) => l.split('=', 2)[1].trim())
    .map((l) => l.split('=', 2)[0]);

  const exPath = path.join(ROOT, '.env.example');
  const ex = fs.existsSync(exPath) ? fs.readFileSync(exPath, 'utf8') : null;
  const exVals = keyVars(ex);
  ok('.env.example（会进仓库/进包的那份）为空值模板', !ex || exVals.length === 0,
    ex ? (exVals.length ? '有非空值：' + exVals.join(',') : '空模板') : '文件不存在');

  const local = readEnvMaybe();
  if (local) {
    const ks = keyVars(local);
    console.log('  说明  本机 .env 已配置 ' + ks.length + ' 个 Key（' + (ks.join(', ') || '无') + '）：'
      + '开发者本地配置，.gitignore 已排除，打包脚本另有安全闸拦截');
  }
}

(async () => {
  console.log('安全测试启动  node ' + process.version);
  testSensitiveFiles();
  await testTraversal();
  await testPublicLock();
  await testZeroKeyLeak();
  console.log('\n========== 结果：' + pass + ' 通过 / ' + fail + ' 失败 ==========');
  if (failures.length) { console.log('失败项：\n - ' + failures.join('\n - ')); process.exit(1); }
})().catch((e) => { console.error('测试脚本异常:', e); process.exit(1); });
