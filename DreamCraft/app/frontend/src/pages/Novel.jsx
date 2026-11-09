import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { api, assetUrl, getToken } from '../api'
import PageShell from '../components/PageShell'

/**
 * 短剧页：剧本 → 分镜 → 逐镜头后台视频任务 → 逐条轮询出片 → ffmpeg 合成完整成片。
 */
export default function Novel() {
  const storageKey = 'dc_drama_' + (getToken() || 'anon')
  const [saved] = useState(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(storageKey) || '{}')
      return value && Array.isArray(value.shots) && Array.isArray(value.taskIds) ? value : {}
    } catch { return {} }
  })
  const [theme, setTheme] = useState(saved.theme || '')
  const [shots, setShots] = useState(saved.shots || [])
  const [taskIds, setTaskIds] = useState(saved.taskIds || [])
  const [status, setStatus] = useState({}) // task_id -> {status, result, error}
  const [busy, setBusy] = useState(false)
  const [composing, setComposing] = useState(false)
  const [finalVideo, setFinalVideo] = useState(saved.finalVideo || null)
  const [finalMeta, setFinalMeta] = useState(saved.finalMeta || null)
  const [error, setError] = useState('')
  const [dependencies, setDependencies] = useState(null)
  const [dependencyError, setDependencyError] = useState('')
  const [checking, setChecking] = useState(false)

  const checkDependencies = async () => {
    setChecking(true); setDependencyError('')
    try { setDependencies(await api.engineDiagnostics()) }
    catch (e) { setDependencies(null); setDependencyError(e.message) }
    finally { setChecking(false) }
  }

  useEffect(() => { checkDependencies() }, [])

  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify({ theme, shots, taskIds, finalVideo, finalMeta })) } catch {}
  }, [storageKey, theme, shots, taskIds, finalVideo, finalMeta])

  useEffect(() => {
    if (!taskIds.length) return
    let cancelled = false, timer
    const poll = async () => {
      try {
        const r = await api.multiGetTasks(taskIds)
        if (cancelled) return
        const next = Object.fromEntries((r.tasks || []).map(t => [t.id, t]))
        setStatus(next)
        if (taskIds.every(id => ['succeed', 'failed'].includes(next[id]?.status))) return
      } catch (e) { if (!cancelled) setError(e.message) }
      if (!cancelled) timer = setTimeout(poll, 10000)
    }
    poll()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [taskIds])

  const makeScript = async () => {
    setBusy(true); setError('')
    try {
    const r = await api.dramaScript({ theme: theme || '赛博朋克都市', shots: 6 })
    setShots(r.shots)
    setTaskIds([]); setStatus({}); setFinalVideo(null); setFinalMeta(null)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const renderAll = async () => {
    setBusy(true); setError('')
    try {
      const r = await api.dramaRenderAll({ shots, duration: 5 })
      setTaskIds(r.task_ids ?? [])
      setStatus({}); setFinalVideo(null); setFinalMeta(null)
    } catch (e) {
      setError('提交失败：' + e.message)
    } finally {
      setBusy(false)
    }
  }

  const done = taskIds.map((tid) => status[tid]).filter((s) => s?.status === 'succeed')
  const allDone = taskIds.length > 0 && taskIds.every((tid) => ['succeed', 'failed'].includes(status[tid]?.status))

  const compose = async () => {
    setComposing(true); setError('')
    try {
      // 逐镜头字幕（用分镜 prompt 截断）+ 可选 BGM
      const subs = shots.map((s) => ({ text: (s.prompt || '').slice(0, 20) }))
      const r = await api.dramaCompose({
        task_ids: taskIds, prompt: theme,
        subtitles: subs,
      })
      setFinalVideo(r.url)
      setFinalMeta(r)
    } catch (e) {
      setError('合成失败：' + e.message)
    } finally {
      setComposing(false)
    }
  }

  return (
    <PageShell title="短剧工坊" subtitle="一个念头，一份剧本，一段属于你的故事。">
    <div className="space-y-5 max-w-4xl">
      <aside className="engine-dependencies space-y-2" aria-label="短剧环境">
        <div className="flex items-center justify-between gap-3"><span className="text-sm">短剧环境</span><button className="icon-button" aria-label="重新检测短剧环境" title="重新检测短剧环境" onClick={checkDependencies} disabled={checking}><RefreshCw size={15} className={checking ? 'animate-spin' : ''} /></button></div>
        {dependencies ? <>
          <p className="text-xs text-ink-dim">{dependencies.video.configured ? '视频平台已配置；生成镜头将使用该平台的额度。' : '尚未配置视频平台，生成镜头前请先连接自己的 API。'}</p>
          <p className={`text-xs ${dependencies.ffmpeg.ready ? 'text-ink-dim' : 'dependency-warning'}`}>{dependencies.ffmpeg.message}</p>
          {(!dependencies.video.configured || !dependencies.ffmpeg.ready) && <Link className="text-link" to="/ai-tool/engine">前往引擎设置</Link>}
        </> : <p className="text-xs text-ink-dim" role="status">{dependencyError || '正在检测…'}</p>}
      </aside>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <input value={theme} onChange={(e) => setTheme(e.target.value)}
          placeholder="输入短剧主题，例如：深夜便利店里的重逢"
          className="flex-1 rounded-lg bg-space-950/60 border border-white/[0.07] px-3 py-2 text-sm outline-none focus:border-brand" />
        <button onClick={makeScript} disabled={busy || composing} className="btn-primary !text-xs">生成剧本</button>
      </div>

      {shots.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm text-ink-dim">分镜脚本（{shots.length} 镜头）</h2>
          {shots.map((s) => (
            <div key={s.shot_id} className="rounded-lg border border-white/[0.07] bg-space-800/60 p-3 text-xs">
              <span className="text-brand-500 mr-2">镜头 {s.shot_id + 1}（{s.camera}）</span>
              {s.prompt}
            </div>
          ))}
          <button onClick={renderAll} disabled={busy || composing || (taskIds.length > 0 && !allDone)}
            className="w-full rounded-lg bg-brand-500 py-2 text-sm font-medium disabled:opacity-50">
            {busy ? '提交中…' : taskIds.length ? '重新提交全部' : '全部提交渲染'}
          </button>
        </section>
      )}

      {taskIds.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm text-ink-dim">
            渲染进度：{done.length}/{taskIds.length} 完成
          </h2>
          {taskIds.map((id, i) => <div key={id} className="text-xs text-ink-dim">镜头 {i + 1}：{status[id]?.status === 'failed' ? status[id].error : status[id]?.status === 'succeed' ? '已完成' : '生成中'}</div>)}
          {allDone && done.length > 0 && (
            <button onClick={compose} disabled={composing || busy || dependencies?.ffmpeg.ready === false}
              className="w-full rounded-lg bg-green-600 py-2 text-sm font-medium disabled:opacity-50">
              {composing ? 'ffmpeg 合成中…' : '合成完整成片'}
            </button>
          )}
          {done.length > 0 && !allDone && (
            <div className="text-xs text-ink-faint">等待所有镜头结束后，可合成已完成的镜头（等待中：{taskIds.length - done.length - taskIds.filter((t) => status[t]?.status === 'failed').length} 条）</div>
          )}
          {done.length > 0 && !finalVideo && allDone && <div className="text-xs text-ink-faint">点击上方按钮合成</div>}
        </section>
      )}

      {finalVideo && (
        <section>
          <h2 className="text-sm text-ink-dim mb-2">
            完整成片{finalMeta?.subtitles ? '（含字幕）' : ''}{finalMeta?.has_bgm ? '（含 BGM）' : ''}
          </h2>
          <video src={assetUrl(finalVideo)} controls className="w-full rounded-lg bg-black" />
          <a href={assetUrl(finalVideo)} download className="text-xs text-brand-500">下载 mp4</a>
        </section>
      )}
    </div>
    </PageShell>
  )
}
