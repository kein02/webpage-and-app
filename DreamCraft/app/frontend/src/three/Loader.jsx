import { Aperture } from 'lucide-react'

export default function Loader() {
  return <div className="studio-loader" role="status"><Aperture size={32} strokeWidth={1.3} /><span>造梦工坊</span><div className="loader-track"><i /></div><small>正在准备创意工作室</small></div>
}
