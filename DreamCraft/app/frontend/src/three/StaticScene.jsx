import { Bot, Clapperboard, Film, Image, Layers, WandSparkles } from 'lucide-react'

const ITEMS = [
  { key: 'image', label: 'AI 图片', icon: Image },
  { key: 'tools', label: '图像工具', icon: WandSparkles },
  { key: 'novel', label: '短剧工坊', icon: Clapperboard },
  { key: 'canvas', label: '无限画布', icon: Layers },
  { key: 'agent', label: '智能体', icon: Bot },
  { key: 'video', label: 'AI 视频', icon: Film },
]

export default function StaticScene({ onSelect }) {
  return <div className="static-studio" aria-label="创意工作室静态视图">
    <div className="static-room">
      <div className="static-wall wall-back"><div className="static-window" /><div className="static-art" /></div>
      <div className="static-floor" />
      <div className="static-stations">{ITEMS.map(it => <button className={`static-station station-${it.key}`} key={it.key} onClick={() => onSelect(it.key)}><span className="static-object"><it.icon size={30} strokeWidth={1.4} /></span><span className="static-station-name">{it.label}</span></button>)}</div>
    </div>
  </div>
}
