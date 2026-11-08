import { useEffect, useState } from 'react'
import { api, assetUrl } from '../api'
import { Compass } from 'lucide-react'
import PageShell from '../components/PageShell'
import { Link } from 'react-router-dom'

/** 发现页：吃真实素材库（生成/上传都在这），空了才回退模板。 */
export default function Explore() {
  const [items, setItems] = useState([])
  useEffect(() => {
    api.assetList(60).then((r) => {
      const real = r.assets ?? []
      setItems(real)
      if (real.length === 0) {
        api.collectionTemplates().then((t) => setItems(t.templates ?? [])).catch(() => {})
      }
    }).catch(() => {
      api.collectionTemplates().then((t) => setItems(t.templates ?? [])).catch(() => {})
    })
  }, [])

  const show = items.length > 0
  return (
    <PageShell title="灵感发现" subtitle="换个角度，遇见意料之外的灵感。" actions={show && <span className="text-xs text-ink-faint">{items.length} 份灵感</span>}>
      {show ? (
        <div className="explore-grid">
          {items.map((t) => (
            <figure key={t.id}>
              {t.kind === 'video' ? (
                <video src={assetUrl(t.url)} className="w-full" preload="metadata" controls />
              ) : t.url ? (
                <img src={assetUrl(t.url)} className="w-full" loading="lazy" alt={t.prompt || t.title || '灵感作品'} />
              ) : <Link to={'/ai-tool/ai-image?prompt=' + encodeURIComponent(t.prompt)} className="block p-5 text-sm text-brand-500">{t.name || '使用此灵感'} →</Link>}
              <figcaption>{t.prompt || t.title}</figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <div className="empty-state"><Compass size={38} strokeWidth={1} /><strong>灵感正在路上</strong><p>还没有可展示的作品</p></div>
      )}
    </PageShell>
  )
}
