import { useState } from 'react'
import { api, assetUrl } from '../api'
import { Crop, Eraser, Focus, ImagePlus, Scan, Scissors, Sparkles, Upload } from 'lucide-react'
import PageShell from '../components/PageShell'
import UpscaleSettings, { defaultUpscale } from '../components/UpscaleSettings'

const TOOLS = [
  { id: 'inpaint', name: '局部重绘', desc: '重新想象画面细节', icon: Eraser },
  { id: 'outpaint', name: '智能扩图', desc: '延展画面之外的世界', icon: Crop },
  { id: 'super_resolution', name: '图像放大', desc: 'AI 模型 / 普通插值', icon: Focus },
  { id: 'gen_background', name: '换背景', desc: '为主体换一个场景', icon: ImagePlus },
  { id: 'interactive_matting', name: '智能抠图', desc: '保留主体，移除背景', icon: Scissors },
  { id: 'saliency_seg', name: '主体识别', desc: '提取画面中的主体', icon: Scan },
]

export default function Tools() {
  const [active, setActive] = useState(TOOLS[0].id)
  const [imageUrl, setImageUrl] = useState('')
  const [maskUrl, setMaskUrl] = useState('')
  const [prompt, setPrompt] = useState('')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [upscale, setUpscale] = useState(defaultUpscale)
  const tool = TOOLS.find((t) => t.id === active)

  const run = async () => {
    setBusy(true)
    setResult(null)
    try {
      const r = await api.imageEdit(active, {
        image_url: imageUrl, mask_url: maskUrl || undefined,
        prompt,
        params: active === 'super_resolution' ? upscale : { model: 'default', resolution: 2048 },
      })
      setResult(r)
    } catch (e) {
      setResult({ status: 'error', note: e.message })
    } finally {
      setBusy(false)
    }
  }

  const onFile = (e) => {
    const f = e.target.files[0]
    if (!f) return
    const r = new FileReader()
    r.onload = () => setImageUrl(r.result)
    r.readAsDataURL(f)
  }

  return (
    <PageShell title="图像工具" subtitle="打磨每一个细节，让画面更接近你的想象。">
    <div className="tools-layout">
      <div className="tool-options">
        {TOOLS.map((t) => (
          <button key={t.id} disabled={busy} onClick={() => { setActive(t.id); setResult(null) }}
            aria-pressed={active === t.id}>
            <t.icon size={17} /><span>{t.name}<small>{t.desc}</small></span>
          </button>
        ))}
      </div>

      <section className="tool-editor space-y-4">
        <h2>{tool.name}</h2>
        <label className="reference-upload">
          <input type="file" accept="image/*" onChange={onFile} disabled={busy} className="sr-only" aria-label="上传待处理图片" />
          {imageUrl ? <img src={imageUrl} alt="待处理图片" /> : <Upload size={22} strokeWidth={1.4} />}
          {imageUrl ? '更换图片' : '上传图片'}
        </label>
        {active === 'inpaint' && <label className="reference-upload"><input type="file" accept="image/*" aria-label="上传重绘蒙版" className="sr-only" onChange={e => { const file = e.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => setMaskUrl(reader.result); reader.readAsDataURL(file) }} />{maskUrl ? <img src={maskUrl} alt="重绘蒙版" /> : <Upload size={18} />}重绘蒙版（白色重绘，黑色保留）</label>}
        {active === 'super_resolution' ? <UpscaleSettings value={upscale} onChange={setUpscale} disabled={busy} /> : <input value={prompt} onChange={(e) => setPrompt(e.target.value)}
          placeholder="描述想要的效果（换背景/重绘区域说明）"
          className="w-full rounded-lg bg-space-950/60 border border-white/[0.07] px-3 py-2 text-sm outline-none focus:border-brand" />}
        <button onClick={run} disabled={busy || !imageUrl || (active === 'inpaint' && !maskUrl)}
          className="btn-primary">
          <Sparkles size={15} />{busy ? '处理中…' : '开始处理'}
        </button>

        {result && result.result_url && (
          <figure className="rounded-lg overflow-hidden bg-space-950/60">
            <img src={assetUrl(result.result_url)} className="w-full" alt="result" />
            <figcaption className="p-2 text-xs text-ink-faint">{result.note || tool.name}</figcaption>
          </figure>
        )}
        {result && result.status === 'error' && (
          <div className="rounded-lg bg-red-500/20 p-3 text-xs text-red-300">{result.note}</div>
        )}
      </section>
    </div>
    </PageShell>
  )
}
