/**
 * 3D 场景性能与降级控制
 * Three rendering levels: detailed, lightweight, and CSS-only.
 */
export const QUALITY = {
  high: { shadows: true, particles: 160, dpr: 1.75, antialias: true },
  low: { shadows: false, particles: 60, dpr: 1.25, antialias: false },
  static: null,
}

/** 自动探测初始画质：移动端/低端设备降到 low。 */
export function detectQuality() {
  if (typeof window === 'undefined') return 'high'
  // 尊重系统偏好
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 'static'
  const mem = navigator.deviceMemory || 8
  const cores = navigator.hardwareConcurrency || 8
  const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
  // WebGL 能力探测
  try {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl2') || c.getContext('webgl')
    if (!gl) return 'static'
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : ''
    if (/SwiftShader|llvmpipe|Software/i.test(renderer)) return 'static'
  } catch {
    return 'static'
  }
  if (mobile || mem <= 4 || cores <= 4) return 'low'
  return 'high'
}

/** 页面可见性 —— 不可见时暂停渲染循环。 */
export function useVisibility(cb) {
  if (typeof document === 'undefined') return () => {}
  const handler = () => cb(!document.hidden)
  document.addEventListener('visibilitychange', handler)
  return () => document.removeEventListener('visibilitychange', handler)
}
