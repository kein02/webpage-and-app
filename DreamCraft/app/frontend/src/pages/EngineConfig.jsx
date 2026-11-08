import { useEffect, useState } from 'react'
import {
  getLocalEngine, setLocalEngine, comfyReachable, comfyEngines,
  agnesReachable,
} from '../engine'
import { api, getRuntime, getToken } from '../api'
import PageShell from '../components/PageShell'

/** 引擎设置：
    ① 出图——自己电脑的 ComfyUI（浏览器直连跑在自己 GPU）
    ② 出图——自己的 Agnes API key
    ③ 视频——自选平台 + 自填 key（Agnes / 硅基流动 / 阿里百炼 / 智谱 / 火山方舟）
    出图配置存浏览器 localStorage；视频配置存服务器（按用户隔离，key 不回显）。 */
export default function EngineConfig() {
  const [form, setForm] = useState(getLocalEngine())
  const [msg, setMsg] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [serverModels, setServerModels] = useState([])
  const [runtime, setRuntime] = useState(null)

  // 视频平台
  const [platforms, setPlatforms] = useState([])
  const [vcfg, setVcfg] = useState({
    video_platform: '', video_key: '', video_base: '', video_model: '',
  })
  const [hasVideoKey, setHasVideoKey] = useState(false)
  const [vMsg, setVMsg] = useState('')
  const [loggedIn, setLoggedIn] = useState(!!getToken())

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const setV = (k, v) => setVcfg((f) => ({ ...f, [k]: v }))
  const say = (m) => { setMsg(m); setTimeout(() => setMsg(''), 4000) }
  const sayV = (m) => { setVMsg(m); setTimeout(() => setVMsg(''), 4000) }

  useEffect(() => {
    getRuntime().then(setRuntime).catch(e => setMsg(e.message))
    api.modelConfig().then((c) => setServerModels(c.image_models ?? [])).catch(() => {})
    api.videoPlatforms().then((r) => setPlatforms(r.platforms ?? [])).catch(() => {})
    if (getToken()) {
      api.engineConfig().then((r) => {
        setVcfg({
          video_platform: r.video_platform || '',
          video_key: '',
          video_base: r.video_base || '',
          video_model: r.video_model || '',
        })
        setHasVideoKey(!!r.has_video_key)
      }).catch(() => {})
    }
  }, [])

  const test = async () => {
    setTesting(true); setTestResult(null)
    try {
      if (form.comfyui_url) {
        const ok = await comfyReachable(form.comfyui_url)
        if (ok) {
          const { engines } = await comfyEngines(form.comfyui_url)
          setTestResult({ ok: true, text: 'ComfyUI 可达 ✓ 可用档位：'
            + (engines.length ? engines.map((e) => e.name).join(' / ') : '（没装模型，先在 ComfyUI 里下 checkpoint）') })
        } else {
          setTestResult({ ok: false, text: '连不上。确认 ComfyUI 已启动 + 浏览器能访问该地址（127.0.0.1 只在你自己电脑上有效）。' })
        }
      } else if (form.agnes_key) {
        const ok = await agnesReachable(form.agnes_key, form.agnes_root)
        setTestResult(ok
          ? { ok: true, text: 'Agnes key 有效 ✓，可用 agnes-image-2.5-flash' }
          : { ok: false, text: 'Agnes key 无效或网络不通。' })
      } else {
        const config = await getRuntime()
        setTestResult(config.default_engines
          ? { ok: true, text: '本机调试模式：使用此电脑上的默认引擎。' }
          : { ok: false, text: '公开分享模式：请配置你自己的 ComfyUI 或 API Key。' })
      }
    } catch (e) {
      setTestResult({ ok: false, text: e.message })
    } finally { setTesting(false) }
  }

  const save = () => {
    setLocalEngine(form)
    say('已保存（仅存这台浏览器）。出图路由：'
      + (form.comfyui_url ? '本机 ComfyUI 优先' : form.agnes_key ? '你的 Agnes key' : runtime?.default_engines ? '本机调试默认引擎' : '等待配置你自己的引擎'))
  }

  const clear = () => {
    setForm({})
    setLocalEngine({})
    setTestResult(null)
    say(runtime?.default_engines ? '已清除浏览器配置，使用本机调试默认引擎。' : '已清除浏览器配置，请连接你自己的引擎。')
  }

  const saveVideo = async () => {
    if (!loggedIn) { sayV('请先登录再配置视频平台'); return }
    const body = { video_platform: vcfg.video_platform, video_base: vcfg.video_base, video_model: vcfg.video_model }
    if (vcfg.video_key) body.video_key = vcfg.video_key
    if (!vcfg.video_platform && !vcfg.video_key) {
      // 清除
      body.video_platform = ''
      body.video_key = ''
      body.video_base = ''
      body.video_model = ''
    }
    try {
      const r = await api.engineSet(body)
      setHasVideoKey(!!r.has_video_key)
      setV('video_key', '')
      sayV('已保存 · 当前视频平台：' + (r.video_effective || '未配置'))
    } catch (e) { sayV('✗ ' + e.message) }
  }

  const curPlatform = platforms.find((p) => p.id === vcfg.video_platform)

  return (
    <PageShell title="引擎设置" subtitle="连接你的算力，让创作顺畅发生。">
    <div className="engine-layout space-y-4">
      {runtime && <p className="text-sm text-brand-500" role="status">{runtime.mode === 'local' ? '本机调试：可使用此电脑上的默认 ComfyUI 和 API。' : '公开分享：使用你自己的引擎，站点不提供默认算力。'}</p>}
      <p className="text-sm text-ink-dim">
        <b className="text-gray-200">出图</b>配置保存在这台浏览器。图像工具请求会临时携带配置，生成作品保存在素材库。
        <b className="text-gray-200">视频</b>配置存服务器（按用户隔离，key 不回显）。
      </p>

      {/* ① ComfyUI */}
      <section className="panel p-4 space-y-2">
        <div className="text-sm font-medium text-ink-dim">① 出图：自己电脑的 ComfyUI（GPU）</div>
        <label className="text-xs text-ink-faint block">ComfyUI 地址</label>
        <input value={form.comfyui_url || ''}
          onChange={(e) => set('comfyui_url', e.target.value)}
          placeholder="http://127.0.0.1:8188（自己电脑）或 http://内网IP:8188"
          className="w-full rounded bg-space-950/60 border border-white/[0.07] px-3 py-2 text-sm" />
        <p className="text-[11px] text-ink-faint">
          需要 ComfyUI 已启动 + 装了模型。填 127.0.0.1 只在填地址的这台电脑有效。
          跨域由 <code>--enable-cors-header *</code> 放行（run.py 已带）。
        </p>
        <label className="text-xs text-ink-faint block">默认档位</label>
        <select value={form.default_engine || ''}
          onChange={(e) => set('default_engine', e.target.value)}
          className="w-full rounded bg-space-950/60 border border-white/[0.07] px-3 py-2 text-sm">
          <option value="">自动</option>
          <option value="sdxl-draft">SDXL 草稿（极速，试构图）</option>
          <option value="z-image-turbo">Z-Image 精修（画质最好）</option>
          <option value="sdxl">SDXL 标准</option>
        </select>
      </section>

      {/* ② Agnes key（出图） */}
      <section className="panel p-4 space-y-2">
        <div className="text-sm font-medium text-ink-dim">② 出图：自己的 Agnes API key（云端）</div>
        <label className="text-xs text-ink-faint block">API Key</label>
        <input value={form.agnes_key || ''} type="password"
          onChange={(e) => set('agnes_key', e.target.value)}
          placeholder="sk-..."
          className="w-full rounded bg-space-950/60 border border-white/[0.07] px-3 py-2 text-sm" />
        <label className="text-xs text-ink-faint block">API 地址（可选）</label>
        <input value={form.agnes_root || ''}
          onChange={(e) => set('agnes_root', e.target.value)}
          placeholder="https://api.agnes-ai.cn"
          className="w-full rounded bg-space-950/60 border border-white/[0.07] px-3 py-2 text-sm" />
      </section>

      {/* 测试 + 保存（出图） */}
      <div className="flex gap-2">
        <button onClick={test} disabled={testing}
          className="flex-1 rounded-lg bg-white/[0.07] py-2 text-sm disabled:opacity-50">
          {testing ? '测试中…' : '测试连接'}
        </button>
        <button onClick={save} className="flex-1 rounded-lg bg-brand-500 py-2 text-sm">保存</button>
        <button onClick={clear} className="rounded-lg bg-white/[0.07] px-3 text-sm text-ink-dim">清除</button>
      </div>

      {testResult && (
        <div className={`rounded-lg p-3 text-xs ${testResult.ok ? 'bg-green-500/10 text-green-300' : 'bg-red-500/10 text-red-300'}`}>
          {testResult.text}
        </div>
      )}
      {msg && <div className="rounded-lg bg-white/[0.07] p-3 text-xs text-ink-dim">{msg}</div>}

      {/* ③ 视频平台 */}
      <section className="panel p-4 space-y-2 border border-brand/20">
        <div className="text-sm font-medium text-ink-dim">③ 视频：自选平台 + 自填 API key</div>
        <p className="text-[11px] text-ink-faint">
          视频需要云端平台（本地 ComfyUI 无视频能力）。选一个平台填它的 key 即可。
        </p>

        <label className="text-xs text-ink-faint block">平台</label>
        <select value={vcfg.video_platform || ''}
          onChange={(e) => {
            const p = platforms.find((x) => x.id === e.target.value)
            setVcfg({ video_platform: e.target.value, video_key: '', video_base: '', video_model: p?.default_model || '' })
            setHasVideoKey(false)
          }}
          className="w-full rounded bg-space-950/60 border border-white/[0.07] px-3 py-2 text-sm">
          <option value="">{runtime?.default_engines ? '未配置（使用本机调试默认）' : '请选择你的视频平台'}</option>
          {platforms.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <label className="text-xs text-ink-faint block">
          API Key {hasVideoKey && <span className="text-brand-500">（已配置）</span>}
        </label>
        <input value={vcfg.video_key || ''} type="password"
          onChange={(e) => setV('video_key', e.target.value)}
          placeholder={hasVideoKey ? '留空 = 保持原 key' : 'sk-... / 平台密钥'}
          className="w-full rounded bg-space-950/60 border border-white/[0.07] px-3 py-2 text-sm" />

        <label className="text-xs text-ink-faint block">模型（可选，留空用平台默认）</label>
        <input value={vcfg.video_model || ''}
          onChange={(e) => setV('video_model', e.target.value)}
          placeholder={curPlatform ? '默认 ' + curPlatform.default_model : '如 wan2.6-t2v'}
          className="w-full rounded bg-space-950/60 border border-white/[0.07] px-3 py-2 text-sm" />

        <label className="text-xs text-ink-faint block">自定义地址（可选，留空用平台官方）</label>
        <input value={vcfg.video_base || ''}
          onChange={(e) => setV('video_base', e.target.value)}
          placeholder="https://..."
          className="w-full rounded bg-space-950/60 border border-white/[0.07] px-3 py-2 text-sm" />

        <button onClick={saveVideo}
          className="w-full rounded-lg bg-brand-500 py-2 text-sm">
          保存视频平台配置
        </button>
        {vMsg && <div className="rounded-lg bg-white/[0.07] p-2 text-xs text-ink-dim">{vMsg}</div>}
        {!loggedIn && (
          <div className="text-[11px] text-yellow-400">视频配置需要登录后保存。</div>
        )}
      </section>

      {/* 服务器参考 */}
      {runtime?.default_engines && serverModels.length > 0 && (
        <section className="panel p-4 space-y-2">
          <div className="text-xs text-ink-faint">本机调试默认引擎</div>
          <div className="space-y-1">
            {serverModels.map((m) => (
              <div key={m.id} className="text-sm text-ink-dim">
                {m.name}{m.desc ? <span className="text-ink-faint"> — {m.desc}</span> : ''}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
    </PageShell>
  )
}
