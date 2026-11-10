import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUp, ArrowDown, Plus, Trash2, Upload, RefreshCw } from 'lucide-react'
import { api, assetUrl, getToken } from '../api'
import PageShell from '../components/PageShell'
import useProject from '../useProject'
import ProjectBar from '../components/ProjectBar'

/**
 * 短剧页：剧本 → 分镜 → 逐镜头后台视频任务 → 逐条轮询出片 → ffmpeg 合成完整成片。
 */
export default function Novel() {
  const project = useProject('drama', { theme: '', shots: [], taskIds: [], finalVideo: null, finalMeta: null, bgm: '', bgmName: '', bgmVolume: 0.2, subtitlesEnabled: true })
  const { theme = '', shots = [], taskIds = [], finalVideo, finalMeta, bgm = '', bgmName = '', bgmVolume = 0.2, subtitlesEnabled = true } = project.data
  const setField = (field, value) => project.setData(prev => ({ ...prev, [field]: value }))
  const setTheme = value => setField('theme', value)
  const setTaskIds = value => setField('taskIds', value)
  const setFinalVideo = value => setField('finalVideo', value)
  const setFinalMeta = value => setField('finalMeta', value)
  const [status, setStatus] = useState({}) // task_id -> {status, result, error}
  const [busy, setBusy] = useState(false)
  const [composing, setComposing] = useState(false)
  const [error, setError] = useState('')
  const [dependencies, setDependencies] = useState(null)
  const [dependencyError, setDependencyError] = useState('')
  const [checking, setChecking] = useState(false)
  const boundIds = taskIds.filter(Boolean)
  const activeTasks = boundIds.some(id => !['succeed', 'failed', 'paused', 'missing'].includes(status[id]?.status))
  const locked = busy || composing || activeTasks
  const change = patch => project.setData(prev => ({ ...prev, ...patch, finalVideo: null, finalMeta: null }))
  const editShot = (index, patch, regenerate = false) => {
    change({ shots: shots.map((s, i) => i === index ? { ...s, ...patch } : s),
      taskIds: shots.map((_, i) => regenerate && i === index ? '' : taskIds[i] || '') })
  }
  const addShot = () => change({
    shots: [...shots, { shot_id: Math.max(-1, ...shots.map(s => s.shot_id)) + 1, prompt: '', camera: 'wide', duration: 5, subtitle: '', trim_start: 0 }],
    taskIds: [...shots.map((_, i) => taskIds[i] || ''), ''],
  })
  const moveShot = (index, direction) => {
    const nextShots = [...shots], nextIds = shots.map((_, i) => taskIds[i] || '')
    const other = index + direction
    ;[nextShots[index], nextShots[other]] = [nextShots[other], nextShots[index]]
    ;[nextIds[index], nextIds[other]] = [nextIds[other], nextIds[index]]
    change({ shots: nextShots, taskIds: nextIds })
  }
  const removeShot = index => {
    if (!window.confirm('删除此镜头？已生成的视频会保留在素材库。')) return
    change({ shots: shots.filter((_, i) => i !== index), taskIds: shots.map((_, i) => taskIds[i] || '').filter((_, i) => i !== index) })
  }

  const checkDependencies = async () => {
    setChecking(true); setDependencyError('')
    try { setDependencies(await api.engineDiagnostics()) }
    catch (e) { setDependencies(null); setDependencyError(e.message) }
    finally { setChecking(false) }
  }

  useEffect(() => { checkDependencies() }, [])

  useEffect(() => {
    if (!project.ready || project.id || project.projects.length || theme || shots.length) return
    const key = 'dc_drama_' + (getToken() || 'anon')
    try {
      const value = JSON.parse(sessionStorage.getItem(key) || 'null')
      if (value && Array.isArray(value.shots) && Array.isArray(value.taskIds)) {
        project.setData(value)
        sessionStorage.removeItem(key)
      }
    } catch {}
  }, [project.ready])

  useEffect(() => {
    const ids = taskIds.filter(Boolean)
    if (!ids.length) return
    let cancelled = false, timer
    const poll = async () => {
      try {
        const r = await api.multiGetTasks(ids)
        if (cancelled) return
        const next = Object.fromEntries((r.tasks || []).map(t => [t.id, t]))
        ids.forEach(id => { if (!next[id]) next[id] = { status: 'missing', error: '原任务已不存在，请重新生成镜头' } })
        setStatus(next)
        if (ids.every(id => ['succeed', 'failed', 'paused', 'missing'].includes(next[id]?.status))) return
      } catch (e) { if (!cancelled) setError(e.message) }
      if (!cancelled) timer = setTimeout(poll, 10000)
    }
    poll()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [taskIds])

  const makeScript = async () => {
    if (shots.length && !window.confirm('生成新剧本会替换当前分镜，是否继续？')) return
    setBusy(true); setError('')
    try {
    const r = await api.dramaScript({ theme: theme || '赛博朋克都市', shots: 6 })
    change({ shots: r.shots.map(s => ({ ...s, subtitle: s.prompt.slice(0, 20), duration: 5, trim_start: 0 })), taskIds: [] })
    setStatus({})
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const renderShots = async (indices) => {
    if (indices.some(i => taskIds[i]) && !window.confirm('重新生成会再次使用平台额度，是否继续？')) return
    setBusy(true); setError('')
    try {
      const r = await api.dramaRenderAll({ shots: indices.map(i => shots[i]), duration: 5 })
      const nextIds = shots.map((_, i) => taskIds[i] || '')
      indices.forEach((index, i) => { nextIds[index] = r.task_ids[i] })
      setTaskIds(nextIds)
      setStatus({}); setFinalVideo(null); setFinalMeta(null)
    } catch (e) {
      setError('提交失败：' + e.message)
    } finally {
      setBusy(false)
    }
  }

  const done = boundIds.map((tid) => status[tid]).filter((s) => s?.status === 'succeed')
  const allDone = shots.length > 0 && shots.every((_, i) => status[taskIds[i]]?.status === 'succeed')
  const missing = shots.map((_, i) => i).filter(i => !taskIds[i])
  const retryShot = async (id, index) => {
    setBusy(true); setError('')
    try {
      const r = status[id]?.status === 'paused' ? await api.taskResume(id) : await api.taskRetry(id)
      setTaskIds(taskIds.map((tid, i) => i === index ? r.task_id : tid))
      setFinalVideo(null); setFinalMeta(null)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const compose = async () => {
    setComposing(true); setError('')
    try {
      const subs = subtitlesEnabled ? shots.map(s => ({ text: s.subtitle ?? s.prompt.slice(0, 20) })) : []
      const r = await api.dramaCompose({
        task_ids: taskIds, prompt: theme,
        subtitles: subs,
        clips: shots.map(s => ({ start: s.trim_start || 0, duration: s.duration || 5 })),
        bgm: bgm || null, bgm_volume: bgmVolume,
      })
      setFinalVideo(r.url)
      setFinalMeta(r)
    } catch (e) {
      setError('合成失败：' + e.message)
    } finally {
      setComposing(false)
    }
  }

  const uploadBgm = async e => {
    const file = e.target.files[0]
    if (!file) return
    setBusy(true); setError('')
    try {
      const result = await api.uploadFile(file, 'audio')
      change({ bgm: result.url, bgmName: file.name })
    } catch (err) { setError(err.message) }
    finally { setBusy(false); e.target.value = '' }
  }

  return (
    <PageShell title="短剧工坊" subtitle="一个念头，一份剧本，一段属于你的故事。">
    <ProjectBar project={project} disabled={busy || composing} onSwitch={() => setStatus({})} />
    <fieldset disabled={!project.ready || project.working} className="min-w-0">
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
        <input value={theme} disabled={busy || composing} onChange={(e) => setTheme(e.target.value)}
          placeholder="输入短剧主题，例如：深夜便利店里的重逢"
          className="flex-1 rounded-lg bg-space-950/60 border border-white/[0.07] px-3 py-2 text-sm outline-none focus:border-brand" />
        <button onClick={makeScript} disabled={locked} className="btn-primary !text-xs">生成剧本</button>
      </div>

      {shots.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm text-ink-dim">分镜脚本（{shots.length} 镜头）</h2>
          {shots.map((s, i) => <section key={s.shot_id} className="drama-shot" aria-label={`镜头 ${i + 1}`}>
            <div className="flex items-center gap-2">
              <h3 className="text-sm flex-1">镜头 {i + 1}</h3>
              <button className="icon-button" title="上移镜头" aria-label={`上移镜头 ${i + 1}`} disabled={locked || i === 0} onClick={() => moveShot(i, -1)}><ArrowUp size={15} /></button>
              <button className="icon-button" title="下移镜头" aria-label={`下移镜头 ${i + 1}`} disabled={locked || i === shots.length - 1} onClick={() => moveShot(i, 1)}><ArrowDown size={15} /></button>
              <button className="icon-button" title="删除镜头" aria-label={`删除镜头 ${i + 1}`} disabled={locked} onClick={() => removeShot(i)}><Trash2 size={15} /></button>
            </div>
            <label>画面描述<textarea aria-label={`镜头 ${i + 1} 画面描述`} maxLength={10000} value={s.prompt} disabled={locked} onChange={e => editShot(i, { prompt: e.target.value }, true)} /></label>
            <div className="drama-shot-fields">
              <label>运镜<input aria-label={`镜头 ${i + 1} 运镜`} maxLength={120} value={s.camera || ''} disabled={locked} onChange={e => editShot(i, { camera: e.target.value }, true)} /></label>
              <label>时长（秒）<input aria-label={`镜头 ${i + 1} 时长`} type="number" min="1" max="15" value={s.duration ?? 5} disabled={locked} onChange={e => editShot(i, { duration: Math.max(1, Math.min(15, Number(e.target.value) || 1)) }, true)} /></label>
              <label>剪辑起点（秒）<input aria-label={`镜头 ${i + 1} 剪辑起点`} type="number" min="0" max="60" step="0.1" value={s.trim_start ?? 0} disabled={busy || composing} onChange={e => editShot(i, { trim_start: Math.max(0, Math.min(60, Number(e.target.value) || 0)) })} /></label>
            </div>
            <label>字幕<input aria-label={`镜头 ${i + 1} 字幕`} maxLength={300} value={s.subtitle ?? s.prompt.slice(0, 20)} disabled={busy || composing} onChange={e => editShot(i, { subtitle: e.target.value })} /></label>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs text-ink-dim" role="status">{!taskIds[i] ? '未生成' : status[taskIds[i]]?.status === 'succeed' ? '已完成' : ['failed', 'paused', 'missing'].includes(status[taskIds[i]]?.status) ? status[taskIds[i]].error : '生成中…'}</span>
              {['failed', 'paused'].includes(status[taskIds[i]]?.status) ?
                <button className="btn-ghost !text-xs" disabled={busy || composing} onClick={() => { if (status[taskIds[i]].status === 'paused' || window.confirm('重试此镜头会再次使用平台额度，是否继续？')) retryShot(taskIds[i], i) }}>{status[taskIds[i]].status === 'paused' ? '恢复查询' : '重试镜头'}</button> :
                <button className="btn-ghost !text-xs" disabled={locked || !s.prompt.trim()} onClick={() => renderShots([i])}>{taskIds[i] ? '重新生成镜头' : '生成镜头'}</button>}
            </div>
            {status[taskIds[i]]?.status === 'succeed' && <video aria-label={`镜头 ${i + 1} 预览`} src={assetUrl(status[taskIds[i]].result?.results?.[0]?.url)} controls preload="metadata" className="w-full rounded-md bg-black" />}
          </section>)}
          <button onClick={() => renderShots(missing.length ? missing : shots.map((_, i) => i))} disabled={locked || shots.some(s => !s.prompt.trim())}
            className="w-full rounded-lg bg-brand-500 py-2 text-sm font-medium disabled:opacity-50">
            {busy ? '提交中…' : missing.length === shots.length ? '全部提交渲染' : missing.length ? '提交未生成镜头' : '重新提交全部'}
          </button>
        </section>
      )}
      <button className="btn-ghost !text-xs" disabled={locked || shots.length >= 20} onClick={addShot}><Plus size={15} />添加镜头</button>

      {shots.length > 0 && <section className="drama-compose space-y-3" aria-label="成片设置">
        <h2 className="text-sm">成片设置</h2>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" aria-label="烧录字幕" checked={subtitlesEnabled} disabled={busy || composing} onChange={e => change({ subtitlesEnabled: e.target.checked })} />烧录字幕</label>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="btn-ghost !text-xs"><Upload size={15} />{bgm ? '更换配乐' : '上传配乐'}<input type="file" accept=".mp3,.wav,.ogg,.m4a,.flac" aria-label="上传配乐" className="sr-only" disabled={busy || composing} onChange={uploadBgm} /></label>
          {bgm && <><span className="text-xs break-all">{bgmName || '配乐'}</span><button className="icon-button" title="移除配乐" aria-label="移除配乐" disabled={busy || composing} onClick={() => change({ bgm: '', bgmName: '' })}><Trash2 size={15} /></button></>}
        </div>
        {bgm && <><audio src={assetUrl(bgm)} controls preload="metadata" className="w-full" /><label className="flex items-center gap-3 text-xs">配乐音量<input type="range" aria-label="配乐音量" min="0" max="1" step="0.05" value={bgmVolume} disabled={busy || composing} onChange={e => change({ bgmVolume: Number(e.target.value) })} />{Math.round(bgmVolume * 100)}%</label></>}
      </section>}

      {boundIds.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm text-ink-dim">
            渲染进度：{done.length}/{shots.length} 完成
          </h2>
          {allDone && done.length > 0 && (
            <button onClick={compose} disabled={composing || busy || dependencies?.ffmpeg.ready === false}
              className="w-full rounded-lg bg-green-600 py-2 text-sm font-medium disabled:opacity-50">
              {composing ? 'ffmpeg 合成中…' : '合成完整成片'}
            </button>
          )}
          {done.length > 0 && !allDone && (
            <div className="text-xs text-ink-faint">全部镜头完成后可合成，尚有 {shots.length - done.length} 个镜头未完成。</div>
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
    </fieldset>
    </PageShell>
  )
}
