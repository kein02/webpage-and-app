import { useRef, useState } from 'react'
import { api, assetUrl } from '../api'
import { Download, Eraser, ImagePlus, Layers, MousePointer2, Scan, Sparkles, Square, Type, ZoomIn } from 'lucide-react'

/**
 * 画布工作台：可交互画布（拖拽/缩放图层）+ 图层面板 + 工具条。
 * 对应即梦 ai-canvas：图片/文本/形状图层，智能填充、换背景、抠图、改色工具挂真实后端。
 */
export default function Canvas() {
  const canvasRef = useRef(null)
  const dragRef = useRef(null)
  const fileRef = useRef(null)
  const [layers, setLayers] = useState([])
  const [sel, setSel] = useState(null)
  const [tool, setTool] = useState('select')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const addLayer = (l) => {
    const id = crypto.randomUUID()
    setLayers((ls) => [...ls, { ...l, id, name: l.type + '-' + (ls.length + 1) }])
    setSel(id)
  }

  const position = e => {
    const cv = canvasRef.current
    const r = cv.getBoundingClientRect()
    return { x: (e.clientX - r.left) * 800 / r.width, y: (e.clientY - r.top) * 600 / r.height }
  }
  const onDown = (e, layer) => {
    if (e.button !== 0) return
    e.preventDefault()
    const p = position(e)
    dragRef.current = { id: layer.id, dx: p.x - layer.x, dy: p.y - layer.y }
    setSel(layer.id)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = e => {
    const drag = dragRef.current
    if (!drag) return
    const p = position(e)
    setLayers(ls => ls.map(l => l.id === drag.id ? { ...l, x: Math.max(0, Math.min(800 - l.w, p.x - drag.dx)), y: Math.max(0, Math.min(600 - l.h, p.y - drag.dy)) } : l))
  }
  const update = patch => setLayers(ls => ls.map(l => l.id === sel ? { ...l, ...patch } : l))
  const upload = async e => {
    const file = e.target.files[0]
    if (!file) return
    setBusy(true)
    try {
      const r = await api.uploadFile(file)
      const img = new Image()
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('无法读取上传图片')); img.src = assetUrl(r.url) })
      const scale = Math.min(1, 600 / img.width, 450 / img.height)
      addLayer({ type: 'image', src: r.url, x: 40, y: 40, w: Math.round(img.width * scale), h: Math.round(img.height * scale) })
      setMsg('图片已添加')
    } catch (error) { setMsg(error.message) } finally { setBusy(false); e.target.value = '' }
  }

  // 工具动作（接真实后端）
  const runTool = async () => {
    const L = layers.find((x) => x.id === sel)
    if (!L || L.type !== 'image') { setMsg('先选中一张图片图层'); return }
    setBusy(true); setMsg('处理中…')
    try {
      let r
      if (tool === 'fill') {
        r = await api.imageEdit('gen_background', { image_url: L.src, prompt: 'clean studio background', params: {} })
      } else if (tool === 'matting') {
        r = await api.imageEdit('interactive_matting', { image_url: L.src, params: {} })
      } else if (tool === 'upscale') {
        r = await api.imageEdit('super_resolution', { image_url: L.src, params: { resolution: 2048 } })
      }
      if (r?.result_url) {
        setLayers((ls) => ls.map((x) => (x.id === L.id ? { ...x, src: r.result_url, name: x.name + ' (edited)' } : x)))
        setMsg('✓ ' + (r.note || '处理完成'))
      } else {
        setMsg('✓ 完成')
      }
    } catch (e) {
      setMsg('✗ ' + e.message)
    } finally {
      setBusy(false)
    }
  }

  // 导出 PNG：把当前所有图层画到离屏 canvas，下载
  const exportPng = async () => {
    setBusy(true)
    try {
    const cv = document.createElement('canvas')
    cv.width = 800; cv.height = 600
    const ctx = cv.getContext('2d')
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 800, 600)
    for (const L of layers) {
      if (L.type === 'image') {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        await new Promise((res, reject) => { img.onload = res; img.onerror = () => reject(new Error('图片加载失败，无法导出')); img.src = assetUrl(L.src) })
        ctx.drawImage(img, L.x, L.y, L.w, L.h)
      } else if (L.type === 'text') {
        ctx.fillStyle = L.color || '#fff'
        ctx.font = `${L.font || 20}px sans-serif`
        ctx.textBaseline = 'top'
        ctx.fillText(L.text || '', L.x, L.y, L.w)
      } else if (L.type === 'rect') {
        ctx.fillStyle = L.fill || '#4f46e5'
        ctx.fillRect(L.x, L.y, L.w, L.h)
      }
    }
    const a = document.createElement('a')
    a.download = 'canvas.png'
    a.href = cv.toDataURL('image/png')
    a.click()
    setMsg('✓ 已导出 PNG')
    } catch (error) { setMsg('导出失败：' + error.message) } finally { setBusy(false) }
  }

  const TOOLS = [
    ['select', '选择', MousePointer2],
    ['fill', '智能填充', Sparkles],
    ['matting', '抠图', Scan],
    ['upscale', '高清化', ZoomIn],
  ]

  const selected = layers.find((x) => x.id === sel)

  return (
    <div className="canvas-workbench">
      {/* 左：工具 + 添加 */}
      <div className="w-44 shrink-0 border-r border-white/[0.07] p-3 space-y-3">
        <h2 className="text-sm font-medium text-ink-dim">画布工具</h2>
        <div className="grid grid-cols-2 gap-1.5">
          {TOOLS.map(([k, name, Icon]) => (
            <button key={k} onClick={() => setTool(k)}
              className={`rounded-lg p-2 text-xs flex flex-col items-center ${tool === k ? 'bg-brand-500/30 text-ink' : 'bg-space-800/60 text-ink-dim'}`}>
              <Icon size={17} className="mb-1" />{name}
            </button>
          ))}
        </div>
        <h2 className="text-sm font-medium text-ink-dim pt-2">添加图层</h2>
        <input ref={fileRef} type="file" accept="image/*" onChange={upload} className="sr-only" aria-label="上传画布图片" />
        <button disabled={busy} onClick={() => fileRef.current?.click()}
          className="w-full rounded bg-white/[0.07] py-1.5 text-xs inline-flex justify-center items-center gap-2"><ImagePlus size={13} />图片</button>
        <button onClick={() => addLayer({ type: 'text', text: '新的文字', x: 80, y: 400, w: 160, h: 32, color: '#ffffff', font: 20 })}
          className="w-full rounded bg-white/[0.07] py-1.5 text-xs inline-flex justify-center items-center gap-2"><Type size={13} />文本</button>
        <button onClick={() => addLayer({ type: 'rect', fill: '#4f46e5', x: 400, y: 60, w: 120, h: 90 })}
          className="w-full rounded bg-white/[0.07] py-1.5 text-xs inline-flex justify-center items-center gap-2"><Square size={13} />形状</button>
      </div>

      {/* 中：画布 */}
      <div className="canvas-surface flex-1 overflow-auto p-4">
        <div className="mb-3 flex gap-2">
          {tool !== 'select' && (
            <button onClick={runTool} disabled={busy}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm disabled:opacity-50">
              {busy ? '处理中…' : '对选中图层：' + TOOLS.find(([k]) => k === tool)?.[1]}
            </button>
          )}
          <button onClick={exportPng} disabled={busy}
            className="rounded-lg bg-white/[0.07] px-4 py-2 text-sm hover:bg-white/20 inline-flex items-center gap-2"><Download size={15} />导出 PNG</button>
        </div>
        {msg && <div className="mb-2 text-xs text-ink-dim">{msg}</div>}
        <div ref={canvasRef} className="relative w-[800px] h-[600px] mx-auto rounded-xl bg-space-950/70 border border-white/[0.07] cursor-crosshair"
          onPointerMove={onMove} onPointerUp={() => { dragRef.current = null }} onPointerCancel={() => { dragRef.current = null }}
          style={{ backgroundImage: 'radial-gradient(circle, #333 1px, transparent 1px)', backgroundSize: '20px 20px' }}>
          {layers.map((L) => (
            <div key={L.id}
              onPointerDown={e => onDown(e, L)}
              className={`absolute ${sel === L.id ? 'ring-2 ring-brand' : ''}`}
              style={{ left: L.x, top: L.y, width: L.w, height: L.h, touchAction: 'none' }}>
              {L.type === 'image' && <img src={assetUrl(L.src)} alt={L.name} style={{ width: '100%', height: '100%', objectFit: 'fill', borderRadius: 4 }} draggable={false} />}
              {L.type === 'text' && <div className="w-full h-full overflow-hidden" style={{ color: L.color, fontSize: L.font, lineHeight: 1 }}>{L.text}</div>}
              {L.type === 'rect' && <div className="w-full h-full" style={{ background: L.fill }} />}
              {sel === L.id && <div className="absolute -inset-1 border border-brand/40 rounded pointer-events-none" />}
            </div>
          ))}
        </div>
      </div>

      {/* 右：图层 + 属性 */}
      <div className="w-52 shrink-0 border-l border-white/[0.07] p-3 space-y-3">
        <h2 className="text-sm font-medium text-ink-dim inline-flex items-center gap-2"><Layers size={14} />图层</h2>
        <div className="space-y-1">
          {[...layers].reverse().map((L) => (
            <div key={L.id} onClick={() => setSel(L.id)}
              className={`rounded px-2 py-1.5 text-xs flex items-center gap-2 cursor-pointer ${sel === L.id ? 'bg-brand-500/20' : 'hover:bg-space-800/60'}`}>
              <span className="text-base">{L.type === 'image' ? '▣' : L.type === 'text' ? 'T' : '▭'}</span>
              <span className="truncate flex-1">{L.name}</span>
            </div>
          ))}
        </div>
        {selected && (
          <div className="space-y-1 text-xs text-ink-faint">
            <div className="text-ink-dim font-medium">属性</div>
            <div>x: {Math.round(selected.x)}  y: {Math.round(selected.y)}</div>
            <div>w: {selected.w}  h: {selected.h}</div>
            {['x', 'y', 'w', 'h'].map(k => <label key={k} className="block">{k}<input aria-label={'图层 ' + k} type="number" min={k === 'w' || k === 'h' ? 1 : 0} max={k === 'x' || k === 'w' ? 800 : 600} value={Math.round(selected[k])} onChange={e => { const max = k === 'x' || k === 'w' ? 800 : 600; update({ [k]: Math.max(k === 'w' || k === 'h' ? 1 : 0, Math.min(max, Number(e.target.value))) }) }} className="inp" /></label>)}
            {selected.type === 'text' && <><input aria-label="文本内容" className="inp" value={selected.text} onChange={e => update({ text: e.target.value })} /><label>字号<input type="number" min="8" max="160" value={selected.font} onChange={e => update({ font: Math.max(8, Math.min(160, Number(e.target.value))) })} className="inp" /></label></>}
            {selected.type !== 'image' && <input aria-label="图层颜色" type="color" value={selected.type === 'text' ? selected.color : selected.fill} onChange={e => update({ [selected.type === 'text' ? 'color' : 'fill']: e.target.value })} />}
            <button onClick={() => setLayers(ls => [...ls.filter(l => l.id !== sel), selected])} className="w-full py-1">移到顶层</button>
            <button onClick={() => setLayers((ls) => ls.filter((x) => x.id !== sel))}
              className="w-full rounded bg-red-500/20 text-red-300 py-1">删除图层</button>
          </div>
        )}
      </div>
    </div>
  )
}
