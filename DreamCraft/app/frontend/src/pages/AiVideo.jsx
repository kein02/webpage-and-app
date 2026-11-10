import { useEffect, useRef, useState } from 'react'
import { api, assetUrl } from '../api'
import { Film, LoaderCircle, Plus, Sparkles, X } from 'lucide-react'
import PageShell from '../components/PageShell'
import { Link, useSearchParams } from 'react-router-dom'

/**
 * AI 视频生成页：任务制。
 * 提交立即返回 task_id，前端轮询 /lv/v1/task/status/{id} 直到 succeed/failed。
 * 已提交任务挂在右上角状态条上，切页不丢（存 localStorage 亦可，此处简单版）。
 */
export default function AiVideo() {
  const [search] = useSearchParams()
  const [tasks, setTasks] = useState([]) // {task_id, status, prompt}
  const [form, setForm] = useState({ prompt: search.get('prompt') || '', model: 'default', refImage: null })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const hidden = useRef(new Set())

  useEffect(() => {
    let cancelled = false
    let timer
    const refresh = async () => {
      try {
        const r = await api.multiGetTasks([])
        if (!cancelled) {
          setTasks(() => {
            const incoming = (r.tasks || []).filter(t => t.kind === 'video').map(t => ({ ...t, task_id: t.id, prompt: t.payload?.prompt }))
            return incoming.filter(t => !hidden.current.has(t.task_id))
          })
          setError('')
        }
      } catch (e) { if (!cancelled) setError(e.message) }
      if (!cancelled) timer = setTimeout(refresh, 10000)
    }
    refresh()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const onFile = (e) => {
    const f = e.target.files[0]
    if (!f) return
    const r = new FileReader()
    r.onload = () => set('refImage', r.result)
    r.readAsDataURL(f)
  }

  const submit = async () => {
    if (!form.prompt.trim()) return
    setBusy(true)
    try {
      const r = await api.submitVideoTask({
        prompt: form.prompt,
        model: form.model,
        ref_image: form.refImage,
        duration: 5,
      })
      const tid = r.task_id
      setTasks((t) => [{ task_id: tid, status: 'queued', prompt: form.prompt }, ...t])
    } catch (e) {
      setError('提交失败：' + e.message)
    } finally {
      setBusy(false)
    }
  }

  const close = (tid) => { hidden.current.add(tid); setTasks(t => t.filter(x => x.task_id !== tid)) }

  return (
    <PageShell title="AI 视频" subtitle="让静止的灵感，开始流动。">
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}

      {/* 任务状态条 */}
      {tasks.length > 0 && (
        <section className="space-y-2">
          {tasks.map((t) => (
            <div key={t.task_id}
              className={`flex items-center gap-3 rounded-lg p-3 text-sm ${t.status === 'succeed' ? 'bg-green-500/10' : t.status === 'failed' ? 'bg-red-500/10' : 'bg-space-800/60'}`}>
              <span className={`w-2 h-2 rounded-full shrink-0 ${t.status === 'succeed' ? 'bg-green-400' : t.status === 'failed' ? 'bg-red-400' : 'bg-yellow-400 animate-pulse'}`} />
              <span className="flex-1 truncate text-ink-dim">{t.prompt}</span>
              {t.status === 'succeed' && t.result?.results?.[0]?.url && (
                <video src={assetUrl(t.result.results[0].url)} controls className="h-16 rounded" />
              )}
              {['failed', 'paused'].includes(t.status) && <span className="text-red-400 text-xs">{t.error}{t.status === 'paused' && <Link to="/ai-tool/task-center" className="text-link">恢复查询</Link>}</span>}
              {['queued', 'running'].includes(t.status) && <span className="text-xs text-ink-faint">生成中…</span>}
              <button onClick={() => close(t.task_id)} className="icon-button" title="隐藏任务" aria-label="隐藏任务"><X size={16} /></button>
            </div>
          ))}
        </section>
      )}

      {/* 参数面板 */}
      <div className="video-layout">
      <section className="generator-controls">
        <div><label htmlFor="video-prompt">视频描述</label>
        <textarea id="video-prompt" rows={6} value={form.prompt} onChange={(e) => set('prompt', e.target.value)}
          placeholder="清晨，镜头缓缓掠过山间的云海，阳光从远处的山脊洒落…"
          className="prompt-textarea" /></div>
        <div><span className="field-label">参考图片</span><label className="reference-upload">
          <input type="file" accept="image/*" onChange={onFile} className="sr-only" aria-label="上传视频参考图" />
          {form.refImage ? <img src={form.refImage} alt="视频参考图" /> : <Plus size={17} />}
          {form.refImage ? '更换参考图片' : '添加首帧参考图片'}
        </label></div>
        <div className="flex justify-between text-xs text-ink-dim"><span>视频时长</span><span>5 秒</span></div>
        <button onClick={submit} disabled={busy || !form.prompt.trim()}
          className="btn-primary generate-button">
          {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Sparkles size={16} />}{busy ? '提交中' : '生成视频'}
        </button>
      </section>
      <section className="generator-preview"><div className="preview-toolbar"><span>视频预览</span><Link to="/ai-tool/task-center">全部任务</Link></div><div className="preview-empty"><div className="video-empty-frame"><Film size={35} strokeWidth={1.2} /></div><strong>让下一段故事开始</strong><p>{tasks.length ? `${tasks.length} 个视频任务` : '还没有生成的视频'}</p></div></section>
      </div>
    </PageShell>
  )
}
