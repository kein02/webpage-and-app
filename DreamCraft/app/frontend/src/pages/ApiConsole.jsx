import { useState } from 'react'
import { BookOpen, Copy, ListTodo, Settings2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import PageShell from '../components/PageShell'

export default function ApiConsole() {
  const [message, setMessage] = useState('')
  const base = (import.meta.env.VITE_API_BASE || window.location.origin).replace(/\/$/, '')
  const sample = [
    `curl -X POST "${base}/lv/v1/editor/image/ai_model/submit_task"`,
    '  -H "Content-Type: application/json"',
    '  -H "Authorization: Bearer YOUR_LOGIN_TOKEN"',
    `  -d '{"prompt":"a quiet mountain lake at sunrise","model":"default","aspect_ratio":"16:9","n":1}'`,
  ].join(' \\\n')
  return (
    <PageShell title="开放 API" subtitle="将创作能力，接入你的工作流程。">
    <div className="space-y-6">
      <div className="api-overview text-sm">
        <Link to="/ai-tool/engine" className="panel p-4"><Settings2 size={21} /><span>引擎配置</span></Link>
        <Link to="/ai-tool/task-center" className="panel p-4"><ListTodo size={21} /><span>任务记录</span></Link>
        <a href={base + '/docs'} target="_blank" rel="noreferrer" className="panel p-4"><BookOpen size={21} /><span>接口文档</span></a>
      </div>
      <div className="flex items-center justify-between"><h2 className="text-sm">图片生成请求</h2><button className="icon-button" title="复制请求示例" aria-label="复制请求示例" onClick={async () => { try { await navigator.clipboard.writeText(sample); setMessage('已复制') } catch { setMessage('浏览器未允许剪贴板访问') } }}><Copy size={17} /></button></div>
      <pre className="overflow-auto rounded-lg bg-space-950/70 p-4 text-xs leading-relaxed">{sample}</pre>
      <p className="text-xs text-ink-dim">API 使用登录令牌鉴权，服务端引擎需单独配置。视频任务通过提交接口取得 task_id，再查询任务状态。</p>
      {message && <p role="status" className="text-xs text-brand-500">{message}</p>}
    </div>
    </PageShell>
  )
}

