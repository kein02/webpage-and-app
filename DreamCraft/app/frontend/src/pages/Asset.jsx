import { useEffect, useRef, useState } from 'react'
import { api, assetUrl } from '../api'
import { ChevronLeft, ChevronRight, Download, Film, FolderOpen, Image, LayoutGrid, Music, Pencil, RotateCcw, Search, Trash2, Upload, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import PageShell from '../components/PageShell'
import Dialog from '../components/Dialog'

const PAGE_SIZE = 24
export default function Asset() {
  const [tab, setTab] = useState('all'), [query, setQuery] = useState(''), [tag, setTag] = useState('')
  const [items, setItems] = useState([]), [total, setTotal] = useState(0), [page, setPage] = useState(0)
  const [selected, setSelected] = useState([]), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true)
  const [error, setError] = useState(''), [refresh, setRefresh] = useState(0), [editing, setEditing] = useState(null)
  const request = useRef(0)
  useEffect(() => {
    const sequence = ++request.current
    setLoading(true); setSelected([])
    const timer = setTimeout(async () => {
      try {
        const result = await api.assetList(PAGE_SIZE, ['all', 'trash'].includes(tab) ? '' : tab, {
          offset: page * PAGE_SIZE, q: query, tag, trash: tab === 'trash',
        })
        if (sequence !== request.current) return
        if (page && page * PAGE_SIZE >= result.total) { setPage(Math.max(0, Math.ceil(result.total / PAGE_SIZE) - 1)); return }
        setItems(result.assets || []); setTotal(result.total || 0); setError('')
      } catch (e) { if (sequence === request.current) setError(e.message) }
      finally { if (sequence === request.current) setLoading(false) }
    }, 200)
    return () => { clearTimeout(timer); request.current++ }
  }, [tab, query, tag, page, refresh])
  const action = async fn => {
    setBusy(true); setError('')
    try { await fn(); setRefresh(n => n + 1); setSelected([]) }
    catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }
  const onUpload = async e => {
    const file = e.target.files[0]
    if (!file) return
    await action(() => api.uploadFile(file)); e.target.value = ''
  }
  const trash = ids => {
    if (tab !== 'trash' && !window.confirm(`将 ${ids.length} 项素材移入回收站？`)) return
    action(() => api.assetTrash(ids, tab === 'trash'))
  }
  const tabs = [['all', '全部素材', LayoutGrid], ['image', '图片', Image], ['video', '视频', Film], ['audio', '音频', Music], ['upload', '上传', Upload], ['trash', '回收站', Trash2]]
  return <PageShell title="素材库" subtitle="收好每一份灵感，留给下一次创作。" actions={<label className="btn-primary !text-xs"><Upload size={15} />{busy ? '处理中…' : '上传图片'}<input type="file" accept="image/*" className="sr-only" onChange={onUpload} aria-label="上传素材" disabled={busy} /></label>}>
    {error && <p role="alert" className="mb-3 text-sm text-red-400">{error}</p>}
    <div className="asset-layout">
      <aside className="asset-filters">{tabs.map(([key, name, Icon]) => <button key={key} disabled={busy} onClick={() => { setTab(key); setPage(0) }} aria-pressed={tab === key}><Icon size={16} />{name}</button>)}</aside>
      <section className="min-w-0">
        <div className="asset-toolbar">
          <label className="asset-search"><Search size={16} /><input aria-label="搜索素材" value={query} maxLength={200} placeholder="搜索名称、提示词、标签" onChange={e => { setQuery(e.target.value); setPage(0) }} /></label>
          {tag && <button className="btn-ghost !text-xs" onClick={() => { setTag(''); setPage(0) }}>{tag}<X size={13} /></button>}
          <span className="text-xs text-ink-faint">{total} 项</span>
          <label className="text-xs flex items-center gap-2"><input type="checkbox" aria-label="全选当前页" disabled={loading || busy || !items.length} checked={!!items.length && selected.length === items.length} onChange={e => setSelected(e.target.checked ? items.map(a => a.id) : [])} />本页</label>
          {selected.length > 0 && <>
            {tab !== 'trash' && <button className="icon-button" title="打包下载选中素材" aria-label="打包下载选中素材" disabled={busy || loading} onClick={() => action(() => api.assetDownload(selected))}><Download size={17} /></button>}
            <button className="icon-button" title={tab === 'trash' ? '恢复选中素材' : '删除选中素材'} aria-label={tab === 'trash' ? '恢复选中素材' : '删除选中素材'} disabled={busy || loading} onClick={() => trash(selected)}>{tab === 'trash' ? <RotateCcw size={17} /> : <Trash2 size={17} />}</button>
          </>}
        </div>
        {loading ? <p role="status" className="py-8 text-sm text-ink-dim">正在加载素材…</p> : !items.length ? <div className="empty-state"><FolderOpen size={38} strokeWidth={1} /><strong>{query || tag ? '没有匹配的素材' : tab === 'trash' ? '回收站为空' : '还没有素材'}</strong><Link to="/ai-tool/ai-image" className="btn-ghost">开始创作</Link></div> :
          <div className="asset-grid">{items.map(a => <figure key={a.id} className="asset-item">
            {a.kind === 'audio' ? <div className="p-3 min-w-0"><Music size={22} className="mb-3" /><audio aria-label="素材音频" src={assetUrl(a.url)} className="w-full" preload="metadata" controls /></div> : a.kind === 'video' ? <video src={assetUrl(a.url)} className="w-full aspect-video object-cover" preload="metadata" controls /> : <a href={assetUrl(a.url)} target="_blank" rel="noreferrer"><img src={assetUrl(a.url)} className="w-full aspect-video object-cover" loading="lazy" alt={a.name || a.prompt || '素材图片'} /></a>}
            <figcaption>
              <div className="asset-item-heading"><input type="checkbox" aria-label={'选择素材 ' + (a.name || a.prompt || a.kind)} checked={selected.includes(a.id)} onChange={e => setSelected(prev => e.target.checked ? [...prev, a.id] : prev.filter(id => id !== a.id))} /><strong title={a.prompt}>{a.name || a.prompt || a.kind}</strong>
                {tab !== 'trash' && <button className="icon-button" title="编辑素材" aria-label="编辑素材" disabled={busy} onClick={() => setEditing({ ...a, tagText: a.tags.join(', ') })}><Pencil size={14} /></button>}
                <button className="icon-button" title={tab === 'trash' ? '恢复素材' : '删除素材'} aria-label={tab === 'trash' ? '恢复素材' : '删除素材'} disabled={busy} onClick={() => trash([a.id])}>{tab === 'trash' ? <RotateCcw size={14} /> : <Trash2 size={14} />}</button>
              </div>
              <div className="asset-tags">{a.tags.map(t => <button key={t} onClick={() => { setTag(t); setPage(0) }}>{t}</button>)}</div>
              <small>{new Date(a.created_at * 1000).toLocaleDateString()}</small>
            </figcaption>
          </figure>)}</div>}
        <div className="asset-pagination"><button className="icon-button" aria-label="上一页" title="上一页" disabled={page === 0 || loading || busy} onClick={() => setPage(n => n - 1)}><ChevronLeft size={18} /></button><span>{page + 1} / {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span><button className="icon-button" aria-label="下一页" title="下一页" disabled={(page + 1) * PAGE_SIZE >= total || loading || busy} onClick={() => setPage(n => n + 1)}><ChevronRight size={18} /></button></div>
      </section>
    </div>
    {editing && <Dialog label="编辑素材" busy={busy} onClose={() => setEditing(null)}>
      <h2>编辑素材</h2>
      <label>名称<input autoFocus className="inp" aria-label="素材名称" value={editing.name} maxLength={120} onChange={e => setEditing({ ...editing, name: e.target.value })} /></label>
      <label>标签<input className="inp" aria-label="素材标签" value={editing.tagText} placeholder="用逗号分隔" onChange={e => setEditing({ ...editing, tagText: e.target.value })} /></label>
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      <div className="flex justify-end gap-2"><button className="btn-ghost" disabled={busy} onClick={() => setEditing(null)}>取消</button><button className="btn-primary" disabled={busy} onClick={() => action(async () => {
        await api.assetEdit(editing.id, { name: editing.name, tags: editing.tagText.split(/[,，]/).map(t => t.trim()).filter(Boolean) })
        setEditing(null)
      })}>保存</button></div>
    </Dialog>}
  </PageShell>
}
