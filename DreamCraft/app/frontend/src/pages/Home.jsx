import { Component, Suspense, lazy, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUpRight, Bot, Clapperboard, Film, Image, Layers, Pause, Play, Settings2, WandSparkles } from 'lucide-react'
import { api } from '../api'
import { detectQuality } from '../three/quality'
import StaticScene from '../three/StaticScene'
import Loader from '../three/Loader'

const StudioScene = lazy(() => import('../three/StudioScene'))
const ENTRIES = [
  { key: 'image', title: 'AI 图片', desc: '让想象拥有形状', icon: Image, path: '/ai-tool/ai-image', tone: 'orange' },
  { key: 'video', title: 'AI 视频', desc: '把一瞬，延展成故事', icon: Film, path: '/ai-tool/ai-video', tone: 'blue' },
  { key: 'agent', title: 'AI 智能体', desc: '和灵感一起思考', icon: Bot, path: '/ai-tool/ai-agent', tone: 'green' },
  { key: 'tools', title: '图像工具', desc: '每个细节，都刚刚好', icon: WandSparkles, path: '/ai-tool/tools', tone: 'pink' },
  { key: 'canvas', title: '无限画布', desc: '给创意多一点空间', icon: Layers, path: '/ai-tool/canvas-home', tone: 'blue' },
  { key: 'novel', title: '短剧工坊', desc: '从一句话，到一部短片', icon: Clapperboard, path: '/ai-tool/novel', tone: 'orange' },
]

class SceneBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.onError?.() }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

export default function Home({ onOpen }) {
  const [quality, setQuality] = useState(detectQuality)
  const [paused, setPaused] = useState(false)
  const [visible, setVisible] = useState(!document.hidden)
  const [ready, setReady] = useState(false)
  const [cats, setCats] = useState([])
  const [wallet, setWallet] = useState(null)
  const [hovered, setHovered] = useState(null)
  const sectionRef = useRef(null)
  const progress = useRef(0)

  useEffect(() => {
    api.templateCategories().then(r => setCats(r.categories ?? [])).catch(() => {})
    api.commerceEntrances().then(r => setWallet(r.wallet ?? null)).catch(() => {})
    const h = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', h)
    const main = document.getElementById('workspace')
    const scroll = () => { progress.current = Math.min(1, (main?.scrollTop || 0) / 650) }
    main?.addEventListener('scroll', scroll, { passive: true })
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const reduced = () => { if (media.matches) { setQuality('static'); setPaused(true) } }
    media.addEventListener('change', reduced)
    return () => { document.removeEventListener('visibilitychange', h); main?.removeEventListener('scroll', scroll); media.removeEventListener('change', reduced) }
  }, [])

  const select = key => onOpen(ENTRIES.find(e => e.key === key)?.path || '/ai-tool/home')
  const fallback = <StaticScene onSelect={select} />

  return (
    <div className="studio-home">
      <section className="studio-hero" aria-label="造梦工坊创意工作室">
        <div className="scene-stage">
          <SceneBoundary key={quality} fallback={fallback} onError={() => { setQuality('static'); setReady(true) }}>
            <Suspense fallback={<Loader />}>
              {quality === 'static' ? fallback : <StudioScene key={quality} quality={quality} visible={visible} paused={paused} progress={progress} onSelect={select} onHover={setHovered} onReady={() => setReady(true)} />}
            </Suspense>
          </SceneBoundary>
        </div>
        <div className="hero-scrim" />
        <div className="hero-copy">
          <div className="studio-status"><span /> 你的灵感，已就位</div>
          <h1>造梦工坊</h1>
          <p className="hero-tagline">把脑海里的世界，<br />变成眼前的作品。</p>
          <p className="hero-description">从第一张画面，到下一段故事。<br />和 AI 一起，让每个想法发生。</p>
          <div className="hero-actions">
            <button className="btn-primary" onClick={() => onOpen('/ai-tool/ai-image')}><Image size={17} />开始创作<ArrowUpRight size={16} /></button>
            <button className="hero-secondary" onClick={() => onOpen('/ai-tool/explore')}>寻找灵感<ArrowUpRight size={15} /></button>
          </div>
          <div className="hero-meta"><span className="meta-line" />图片 · 视频 · 无限可能{wallet && <span className="hero-balance">{wallet.balance} 积分可用</span>}</div>
        </div>
        <div className="scene-caption"><span className="scene-caption-mark" />{hovered ? ENTRIES.find(e => e.key === hovered)?.title : '我的创意工作室'}<span className="scene-caption-sub">DreamCraft Studio</span></div>
        <div className="scene-toolbar">
          <label className="quality-control"><Settings2 size={14} /><select aria-label="场景画质" value={quality} onChange={e => { setReady(false); setQuality(matchMedia('(prefers-reduced-motion: reduce)').matches ? 'static' : e.target.value) }}><option value="high">精细</option><option value="low">流畅</option><option value="static">静态</option></select></label>
          <span />
          <button className="icon-button" aria-label={paused ? '播放场景动效' : '暂停场景动效'} title={paused ? '播放场景动效' : '暂停场景动效'} onClick={() => setPaused(v => !v)} disabled={quality === 'static'}>{paused || quality === 'static' ? <Play size={15} /> : <Pause size={15} />}</button>
        </div>
        {quality !== 'static' && !ready && <div className="scene-loading"><span className="loading-spinner" />工作室正在就位</div>}
        <button className="hero-scroll" onClick={() => sectionRef.current?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })}><ArrowDown size={15} /><span>创作工作台</span></button>
      </section>
      <section ref={sectionRef} className="home-workbenches">
        <div className="section-heading"><div><h2>今天，想创造什么？</h2><p>选择一个起点，让灵感继续。</p></div><button className="text-link" onClick={() => onOpen('/ai-tool/asset')}>我的素材<ArrowUpRight size={15} /></button></div>
        <div className="workbench-grid">
          {ENTRIES.map(e => <button key={e.key} onClick={() => onOpen(e.path)} className={`workbench-entry tone-${e.tone}`} onMouseEnter={() => setHovered(e.key)} onMouseLeave={() => setHovered(null)}><span className="workbench-icon"><e.icon size={22} strokeWidth={1.5} /></span><span className="workbench-text"><strong>{e.title}</strong><small>{e.desc}</small></span><ArrowUpRight className="entry-arrow" size={17} /></button>)}
        </div>
        {cats.length > 0 && <div className="template-strip"><span>灵感分类</span><div>{cats.map(c => <button key={c.id} onClick={() => onOpen('/ai-tool/explore')}>{c.name}<ArrowUpRight size={12} /></button>)}</div></div>}
        <footer className="home-footer"><span>DreamCraft</span><span>每一个想法，都值得被看见。</span></footer>
      </section>
    </div>
  )
}
