import { useEffect, useState } from 'react'
import { api, assetUrl } from '../api'
import { Copy, Eye, ListTodo, Play, RefreshCw, RotateCcw, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import PageShell from '../components/PageShell'
import Dialog from '../components/Dialog'

/**
 * 任务中心：列出全部任务（视频任务为任务制，此处实时轮询未完成的）。
 * 视频任务可直接预览；drama-shot 任务显示 shot_id。
 */
export default function TaskCenter() {
  const [tasks, setTasks] = useState([])
  const [error, setError] = useState('')
  const [detail, setDetail] = useState(null)
  const [busy, setBusy] = useState(null)
  const navigate = useNavigate()

  const load = () => api.multiGetTasks([]).then((r) => { setTasks(r.tasks ?? []); setError('') }).catch(e => setError(e.message))

  useEffect(() => {
    load()
    const timer = setInterval(load, 10000)
    return () => clearInterval(timer)
  }, [])

  const icon = { video: '▶', image: '▣', agent: '✦', 'drama-shot': '❖' }
  const statusText = { queued: '排队中', running: '生成中', succeed: '完成', failed: '失败', paused: '等待恢复查询', not_found: '未知' }
  const retry = async task => {
    if (task.status !== 'paused' && !window.confirm('重试会新建生成任务并使用当前平台额度，是否继续？')) return
    setBusy(task.id); setError('')
    try {
      if (task.status === 'paused') await api.taskResume(task.id)
      else await api.taskRetry(task.id)
      await load()
    } catch (e) { setError(e.message) } finally { setBusy(null) }
  }
  const reuse = task => {
    const page = task.kind === 'image' ? 'ai-image' : 'ai-video'
    navigate(`/ai-tool/${page}?prompt=` + encodeURIComponent(task.payload?.prompt || ''))
  }

  return (
    <PageShell title="任务中心" subtitle="正在发生的创作，以及每一次完成。" actions={<button onClick={load} className="icon-button" title="刷新任务" aria-label="刷新任务"><RefreshCw size={17} /></button>}>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {tasks.length === 0 ? (
        <div className="empty-state"><ListTodo size={38} strokeWidth={1} /><strong>还没有创作任务</strong><p>提交的生成任务会显示在这里。</p></div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-faint">
              <th className="p-2">类型</th><th className="p-2">提示词 / 镜头</th>
              <th className="p-2">状态</th><th className="p-2">结果</th><th className="p-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => {
              const p = t.payload ?? {}
              const url = assetUrl(t.result?.results?.[0]?.url || t.result?.image?.results?.[0]?.url)
              return (
                <tr key={t.id ?? t.task_id} className="border-t border-white/[0.07]">
                  <td className="p-2">{icon[t.kind] ?? '·'} {t.kind}</td>
                  <td className="p-2 max-w-[280px] truncate text-ink-dim">
                    {t.kind === 'drama-shot' ? `镜头 ${p.shot_id ?? '?'}：${p.prompt}` : p.prompt}
                  </td>
                  <td className="p-2">
                    <span className={t.status === 'succeed' ? 'text-green-400' : t.status === 'failed' ? 'text-red-400' : 'text-yellow-400'}>
                      {statusText[t.status] ?? t.status}
                    </span>
                  </td>
                  <td className="p-2">
                    {url && (t.kind === 'video' || t.kind === 'drama-shot')
                      ? <video src={url} controls className="h-14 rounded" />
                      : url ? <img src={url} className="h-14 rounded object-cover" alt="r" />
                        : t.error ? <span className="text-xs text-red-400">{String(t.error).slice(0, 60)}</span>
                          : '—'}
                  </td>
                  <td className="p-2">
                    <div className="flex gap-1">
                      <button className="icon-button" title="任务详情" aria-label="任务详情" onClick={() => setDetail(t)}><Eye size={16} /></button>
                      {p.prompt && <button className="icon-button" title="复用提示词" aria-label="复用提示词" onClick={() => reuse(t)}><Copy size={16} /></button>}
                      {(t.status === 'paused' || (t.status === 'failed' && ['image', 'video', 'drama-shot'].includes(t.kind))) && <button className="icon-button" title={t.status === 'paused' ? '恢复查询' : '重试任务'} aria-label={t.status === 'paused' ? '恢复查询' : '重试任务'} disabled={!!busy} onClick={() => retry(t)}>{t.status === 'paused' ? <Play size={16} /> : <RotateCcw size={16} />}</button>}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {detail && <Dialog label="任务详情" onClose={() => setDetail(null)}>
        <div className="flex items-center justify-between"><h2>任务详情</h2><button autoFocus className="icon-button" title="关闭详情" aria-label="关闭详情" onClick={() => setDetail(null)}><X size={17} /></button></div>
        <div className="task-details">
          <p>编号：{detail.id}</p><p>状态：{statusText[detail.status] || detail.status}</p>
          <p>创建：{new Date(detail.created_at * 1000).toLocaleString()}</p>
          {detail.finished_at && <p>结束：{new Date(detail.finished_at * 1000).toLocaleString()}</p>}
          <p>参数：</p><pre className="whitespace-pre-wrap break-all">{JSON.stringify(detail.payload, null, 2)}</pre>
          {detail.upstream && <><p>平台任务：</p><pre className="whitespace-pre-wrap break-all">{JSON.stringify(detail.upstream, null, 2)}</pre></>}
          {detail.error && <p className="text-red-400">错误：{detail.error}</p>}
        </div>
      </Dialog>}
    </PageShell>
  )
}
