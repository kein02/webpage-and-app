import { useEffect, useState } from 'react'
import { api, assetUrl } from '../api'
import { ListTodo, RefreshCw } from 'lucide-react'
import PageShell from '../components/PageShell'

/**
 * 任务中心：列出全部任务（视频任务为任务制，此处实时轮询未完成的）。
 * 视频任务可直接预览；drama-shot 任务显示 shot_id。
 */
export default function TaskCenter() {
  const [tasks, setTasks] = useState([])
  const [error, setError] = useState('')

  const load = () => api.multiGetTasks([]).then((r) => { setTasks(r.tasks ?? []); setError('') }).catch(e => setError(e.message))

  useEffect(() => {
    load()
    const timer = setInterval(load, 10000)
    return () => clearInterval(timer)
  }, [])

  const icon = { video: '▶', image: '▣', agent: '✦', 'drama-shot': '❖' }
  const statusText = { queued: '排队中', running: '生成中', succeed: '完成', failed: '失败', not_found: '未知' }

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
              <th className="p-2">状态</th><th className="p-2">结果</th>
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
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </PageShell>
  )
}
