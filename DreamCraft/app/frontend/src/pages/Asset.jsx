import { useEffect, useState } from 'react'
import { api, assetUrl } from '../api'
import { Film, FolderOpen, Image, LayoutGrid, Upload } from 'lucide-react'
import { Link } from 'react-router-dom'
import PageShell from '../components/PageShell'

/** 素材库：吃真实素材（生成结果自动入库 + 手动上传），对应即梦 ever_photo。 */
export default function Asset() {
  const [tab, setTab] = useState('all')
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = () => api.assetList(60, tab === 'all' ? '' : tab).then((r) => { setItems(r.assets ?? []); setError('') }).catch(e => setError(e.message))
  useEffect(() => {
    let cancelled = false
    api.assetList(60, tab === 'all' ? '' : tab).then(r => { if (!cancelled) { setItems(r.assets || []); setError('') } }).catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [tab])

  const onUpload = async (e) => {
    const f = e.target.files[0]
    if (!f) return
    setBusy(true)
    try {
      await api.uploadFile(f)
      load()
    } catch (err) {
      setError('上传失败：' + err.message)
    } finally {
      setBusy(false)
      e.target.value = ''
    }
  }

  const tabs = [['all', '全部素材', LayoutGrid], ['image', '图片', Image], ['video', '视频', Film], ['upload', '上传', Upload]]

  return (
    <PageShell title="素材库" subtitle="收好每一份灵感，留给下一次创作。" actions={<label className="btn-primary !text-xs"><Upload size={15} />{busy ? '上传中…' : '上传图片'}<input type="file" accept="image/*" className="sr-only" onChange={onUpload} aria-label="上传素材" disabled={busy} /></label>}>
    <div className="asset-layout">
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <aside className="asset-filters">
        {tabs.map(([k, name, Icon]) => <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k}><Icon size={16} />{name}</button>)}
      </aside>
      <section>
        {items.length === 0 ? (
          <div className="empty-state">
            <FolderOpen size={38} strokeWidth={1} /><strong>还没有素材</strong><p>新的作品，会在这里相遇。</p><Link to="/ai-tool/ai-image" className="btn-ghost">开始创作</Link>
          </div>
        ) : (
          <div className="asset-grid">
            {items.map((a) => (
              <figure key={a.id} className="rounded-lg overflow-hidden bg-space-950/60">
                {a.kind === 'video'
                  ? <video src={assetUrl(a.url)} className="w-full aspect-video object-cover" preload="metadata" controls />
                  : <a href={assetUrl(a.url)} target="_blank" rel="noreferrer"><img src={assetUrl(a.url)} className="w-full aspect-video object-cover" loading="lazy" alt={a.prompt || '素材图片'} /></a>}
                <figcaption className="p-1.5 text-xs text-ink-faint truncate">
                  {a.prompt || a.kind} {a.created_at ? `· ${new Date(a.created_at * 1000).toLocaleDateString()}` : ''}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>
    </div>
    </PageShell>
  )
}
