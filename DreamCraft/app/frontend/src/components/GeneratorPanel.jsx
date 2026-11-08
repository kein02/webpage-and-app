import { useEffect, useState } from 'react'
import { ArrowUpRight, Download, Image, LoaderCircle, Plus, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useSearchParams } from 'react-router-dom'
import { api, assetUrl } from '../api'
import { routeGenerate, getLocalEngine, comfyEngines } from '../engine'

/**
 * 造梦工坊核心生成面板：模式切换 + 模型档位（动态拉 model_config）+ 比例/数量 + 参考图 + 结果网格
 * 出图走 routeGenerate：本机 ComfyUI > 用户 Agnes key > 服务器后端
 */
export default function GeneratorPanel({ kind = 'image' }) {
  const [search] = useSearchParams()
  const [form, setForm] = useState({
    mode: 'text2img', prompt: search.get('prompt') || '', model: 'default',
    aspect_ratio: '1:1', resolution: 1024, n: 2, refImage: null,
  })
  const [results, setResults] = useState([])
  const [busy, setBusy] = useState(false)
  const [models, setModels] = useState([])
  const [source, setSource] = useState(null)
  const [error, setError] = useState('')

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const local = getLocalEngine()

  // 拉档位：有本机 ComfyUI 就列本机的档位，否则列服务器的
  useEffect(() => {
    if (kind === 'video') {
      api.modelConfig().then((c) => {
        const list = c.video_models
        if (list && list.length) { setModels(list); setForm((f) => ({ ...f, model: list[0].id })) }
      }).catch(() => {})
      return
    }
    if (local.comfyui_url) {
      comfyEngines(local.comfyui_url).then(({ engines }) => {
        if (engines.length) {
          setModels(engines)
          setForm((f) => ({ ...f, model: engines.some(e => e.id === local.default_engine) ? local.default_engine : engines[0].id }))
        }
      }).catch(() => api.modelConfig().then((c) => setModels(c.image_models ?? [])).catch(() => {}))
    } else if (local.agnes_key) {
      setModels([{ id: 'agnes-image-2.5-flash', name: 'Agnes 图像 2.5' }])
      setForm(f => ({ ...f, model: 'agnes-image-2.5-flash' }))
    } else {
      api.modelConfig().then((c) => {
        const list = c.image_models
        if (list && list.length) { setModels(list); setForm((f) => ({ ...f, model: list[0].id })) }
      }).catch(() => {})
    }
  }, [kind])

  const onFile = (e) => {
    const f = e.target.files[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => set('refImage', reader.result)
    reader.readAsDataURL(f)
  }

  const generate = async () => {
    if (!form.prompt.trim()) return
    if (form.mode === 'img2img' && !form.refImage) { setError('请先添加参考图片'); return }
    setBusy(true)
    setError('')
    setSource(null)
    try {
      if (kind === 'image') {
        // 出图：浏览器直连本机 ComfyUI / 用户 Agnes key，兜底服务器
        const r = await routeGenerate({
          prompt: form.prompt, refImage: form.mode === 'img2img' ? form.refImage : null,
          aspectRatio: form.aspect_ratio, resolution: form.resolution,
          seed: undefined, n: form.n, model: form.model,
        })
        setSource(r.source)
        setResults(r.results ?? [])
        if (r.warning) setError(r.warning)
        if (!r.results || r.results.length === 0) {
          throw new Error('引擎没有返回图片，请检查任务中心与引擎配置')
        }
      } else {
        // 视频：走服务器任务制（本地视频引擎需 Wan 插件，暂未做）
        const body = { prompt: form.prompt, model: form.model,
          ref_image: form.refImage, duration: 5 }
        const r = await api.submitVideoTask(body)
        setSource('server(video task)')
        setResults([{ url: '', task_id: r.task_id, note: '视频任务已提交，到任务中心看进度' }])
      }
    } catch (err) {
      setError('生成失败：' + err.message)
    } finally {
      setBusy(false)
    }
  }

  const AR = kind === 'video' ? ['16:9', '9:16', '1:1'] : ['1:1', '16:9', '9:16', '4:3', '3:4']

  // 当前选中档位的说明（desc）
  const curDesc = (models.find((m) => m.id === form.model) || {}).desc

  return (
    <div className="generator-layout">
      <section className="generator-controls" aria-label="生成参数">
        <div className="segmented-control">
          <button aria-pressed={form.mode === 'text2img'} onClick={() => set('mode', 'text2img')}>
            {kind === 'video' ? '文生视频' : '文生图'}
          </button>
          <button aria-pressed={form.mode === 'img2img'} onClick={() => set('mode', 'img2img')}>
            {kind === 'video' ? '视频延展' : '图生图'}
          </button>
        </div>
        <div>
        <label htmlFor="image-prompt">画面描述</label>
        <textarea
          id="image-prompt" rows={5} value={form.prompt} onChange={(e) => set('prompt', e.target.value)}
          placeholder="雨后的城市街角，一家亮着暖光的花店，电影感构图，细腻的胶片质感…"
          className="prompt-textarea" />
        </div>

        <Row label="模型档位">
          <select aria-label="模型档位" value={form.model} onChange={(e) => set('model', e.target.value)} className="inp">
            {(models.length ? models : [{ id: form.model, name: form.model }]).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          {curDesc && <div className="text-[11px] text-ink-faint mt-1">{curDesc}</div>}
        </Row>

        <Row label="比例">
          <div className="aspect-options">
            {AR.map((a) => (
              <button key={a} onClick={() => set('aspect_ratio', a)} aria-pressed={form.aspect_ratio === a}>
                <span className="aspect-icon" style={{ width: ['9:16', '3:4'].includes(a) ? 12 : 19, height: ['16:9', '4:3'].includes(a) ? 12 : 19 }} />{a}
              </button>
            ))}
          </div>
        </Row>

        <Row label="数量">
          <div className="segmented-control">
            {[1, 2, 4].map((n) => (
              <button key={n} onClick={() => set('n', n)} aria-pressed={form.n === n}>{n} 张</button>
            ))}
          </div>
        </Row>

        <Row label="参考图">
          <label className="reference-upload">
            <input type="file" accept="image/*" onChange={onFile} className="sr-only" aria-label="上传参考图片" />
            {form.refImage ? <img src={form.refImage} alt="参考图片" /> : <Plus size={17} />}
            {form.refImage ? '更换参考图片' : '添加参考图片'}
          </label>
        </Row>

        {error && <div role="alert" className="generator-notice">{error}</div>}
        <button onClick={generate} disabled={busy || !form.prompt.trim()}
          className="btn-primary generate-button">
          {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Sparkles size={16} />}{busy ? '正在生成' : '立即生成'}
        </button>
      </section>

      <section className="generator-preview" aria-label="生成结果" aria-busy={busy}>
        <div className="preview-toolbar">
          <span>创作预览</span>
          {source ? (
            <span className="text-brand-500">{source}</span>
          ) : (
            <span>
              {local.comfyui_url ? `本机 ComfyUI ${local.comfyui_url}`
                : local.agnes_key ? '你的 Agnes key'
                : '默认引擎'}
            </span>
          )}
          <Link to="/ai-tool/engine" className="inline-flex items-center gap-1">引擎设置<ArrowUpRight size={12} /></Link>
        </div>
        {results.length ? (
          <div className={`grid gap-3 ${results.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {results.map((r, i) => (
              <figure key={i} className="overflow-hidden rounded-lg bg-space-950/60">
                {r.url
                  ? <img src={assetUrl(r.url)} className="w-full" loading="lazy" alt="result" />
                  : <div className="p-4 text-xs text-ink-dim">{r.note}</div>}
                <figcaption className="p-2 text-xs text-ink-dim">
                  {r.engine || r.model} · seed {r.seed}
                  {r.url && <a href={assetUrl(r.url)} download className="float-right" title="下载图片" aria-label="下载图片"><Download size={14} /></a>}
                </figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <div className="preview-empty" role="status">
            <div className="preview-empty-icon">{busy ? <LoaderCircle size={28} className="animate-spin" /> : <Image size={30} strokeWidth={1.2} />}</div>
            <strong>{busy ? '你的画面正在成形' : '下一幅作品，从这里开始'}</strong>
            <p>{busy ? '正在生成，请稍候' : '还没有生成作品'}</p>
          </div>
        )}
      </section>
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs text-ink-faint">{label}</div>
      <div>{children}</div>
    </div>
  )
}
const inp = 'rounded bg-space-950/60 border border-white/[0.07] px-2 py-1 text-sm w-full'
