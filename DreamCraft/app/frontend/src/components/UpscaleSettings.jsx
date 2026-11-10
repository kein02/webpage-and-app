import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { api } from '../api'

export const defaultUpscale = { method: 'ai', resolution: 2048, upscale_model: '' }

export default function UpscaleSettings({ value, onChange, disabled }) {
  const [info, setInfo] = useState(null)
  const [checking, setChecking] = useState(false)
  const check = async () => {
    setChecking(true)
    try { setInfo(await api.imageEdit('upscale_models', {})) }
    catch (e) { setInfo({ ready: false, models: [], message: e.message }) }
    finally { setChecking(false) }
  }
  useEffect(() => { check() }, [])
  const change = patch => onChange({ ...value, ...patch })
  return <div className="upscale-settings">
    <label>放大方式<select aria-label="放大方式" disabled={disabled} value={value.method} onChange={e => change({ method: e.target.value })}>
      <option value="ai">AI 模型放大</option><option value="lanczos">普通插值（Lanczos）</option>
    </select></label>
    <label>目标长边<select aria-label="目标长边" disabled={disabled} value={value.resolution} onChange={e => change({ resolution: Number(e.target.value) })}>
      {[1024, 2048, 4096].map(size => <option key={size} value={size}>{size} px</option>)}
    </select></label>
    {value.method === 'ai' && <>
      <div className="flex items-end gap-2">
        <label className="min-w-0 flex-1">放大模型<select aria-label="放大模型" disabled={disabled || checking} value={value.upscale_model} onChange={e => change({ upscale_model: e.target.value })}>
          <option value="">自动选择</option>{(info?.models || []).map(name => <option key={name} value={name}>{name}</option>)}
        </select></label>
        <button className="icon-button" type="button" title="刷新放大模型" aria-label="刷新放大模型" disabled={checking || disabled} onClick={check}><RefreshCw size={15} className={checking ? 'animate-spin' : ''} /></button>
      </div>
      <p role="status" className="text-xs text-ink-dim">{checking ? '正在检测放大模型…' : info?.message}</p>
      {info && !info.ready && <Link to="/ai-tool/engine" className="text-link">前往引擎设置</Link>}
    </>}
  </div>
}
