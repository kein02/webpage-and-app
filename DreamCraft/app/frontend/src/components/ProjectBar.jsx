import { FilePlus2, RefreshCw, Save, Trash2 } from 'lucide-react'

export default function ProjectBar({ project, disabled = false, onSwitch }) {
  const p = project
  const locked = disabled || p.working
  const switchProject = async id => {
    const success = id ? await p.open(id) : await p.create()
    if (success) onSwitch?.()
  }
  return <div className="project-bar">
    <select aria-label="打开项目" value={p.id || ''} disabled={!p.ready || locked} onChange={e => switchProject(e.target.value)}>
      <option value="">新项目</option>
      {p.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
    <input aria-label="项目名称" value={p.name} maxLength={120} disabled={!p.ready || locked} onChange={e => p.rename(e.target.value)} />
    <button className="icon-button" title="新建项目" aria-label="新建项目" disabled={!p.ready || locked} onClick={() => switchProject('')}><FilePlus2 size={17} /></button>
    <button className="icon-button" title="保存项目" aria-label="保存项目" disabled={!p.ready || locked} onClick={() => p.save().catch(() => {})}><Save size={17} /></button>
    <button className="icon-button" title="删除项目" aria-label="删除项目" disabled={!p.id || locked} onClick={async () => { if (await p.remove()) onSwitch?.() }}><Trash2 size={17} /></button>
    <span role="status" className="text-xs text-ink-faint">{p.state}</span>
    {!p.ready && p.error && <button className="icon-button" title="重新加载项目" aria-label="重新加载项目" onClick={p.reload}><RefreshCw size={17} /></button>}
    {p.error && <p role="alert" className="w-full text-xs text-red-400">{p.error}</p>}
  </div>
}
