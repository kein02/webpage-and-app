/**
 * 星空背景 —— 子页面通用
 * 静态星点（分层闪烁）+ 随机流星划过
 * 纯 Canvas 2D，开销极低；prefers-reduced-motion 时只画静态星空
 */
import { useEffect, useRef } from 'react'

export default function StarField({ density = 1, meteors = true }) {
  const ref = useRef(null)
  const raf = useRef(0)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let W = 0, H = 0, dpr = 1
    let stars = []
    let meteorList = []
    let visible = true

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      W = canvas.clientWidth
      H = canvas.clientHeight
      canvas.width = W * dpr
      canvas.height = H * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      buildStars()
      if (reduced) draw(performance.now())
    }

    const buildStars = () => {
      const count = Math.round((W * H) / 9000 * density)
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        r: Math.random() * 1.3 + 0.25,
        base: Math.random() * 0.5 + 0.22,       // 基础亮度
        speed: Math.random() * 0.9 + 0.25,      // 闪烁速度
        phase: Math.random() * Math.PI * 2,
        accent: Math.random() < 0.06,           // 少量橙色星
      }))
    }

    const spawnMeteor = () => {
      // 从右上向左下划，起点在画布上缘外侧带随机
      const startX = W * (0.55 + Math.random() * 0.55)
      const startY = H * (Math.random() * 0.32 - 0.06)
      const angle = Math.PI * (0.76 + Math.random() * 0.10)  // 朝左下
      const speed = 14 + Math.random() * 9                  // 更快
      meteorList.push({
        x: startX, y: startY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        len: 180 + Math.random() * 160,   // 尾巴更长
        life: 1,
        decay: 0.0032 + Math.random() * 0.0025,  // 存活更久（约 3-5 秒）
        width: 1.6 + Math.random() * 1.1,        // 更粗
      })
    }

    let last = performance.now()
    let nextMeteor = 1200 + Math.random() * 2500

    const draw = (t) => {
      const dt = Math.min(48, t - last)
      last = t
      ctx.clearRect(0, 0, W, H)

      // 星点
      for (const s of stars) {
        let a = s.base
        if (!reduced) {
          a = s.base + Math.sin(t * 0.001 * s.speed + s.phase) * 0.28
          a = Math.max(0.05, Math.min(1, a))
        }
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx.fillStyle = s.accent
          ? `rgba(255,150,90,${a * 0.9})`
          : `rgba(210,218,240,${a})`
        ctx.fill()
      }

      // 流星
      if (meteors && !reduced) {
        nextMeteor -= dt
        if (nextMeteor <= 0) {
          spawnMeteor()
          nextMeteor = 1600 + Math.random() * 3200   // 1.6-4.8 秒一颗
        }
        for (let i = meteorList.length - 1; i >= 0; i--) {
          const m = meteorList[i]
          m.x += m.vx * (dt / 16)
          m.y += m.vy * (dt / 16)
          m.life -= m.decay * (dt / 16)

          if (m.life <= 0 || m.x < -200 || m.y > H + 200) {
            meteorList.splice(i, 1)
            continue
          }

          const tailX = m.x - m.vx * (m.len / 10)
          const tailY = m.y - m.vy * (m.len / 10)
          // 外层光晕（更醒目）
          ctx.beginPath()
          ctx.strokeStyle = `rgba(255,140,80,${0.28 * m.life})`
          ctx.lineWidth = m.width * 3.2
          ctx.lineCap = 'round'
          ctx.moveTo(m.x, m.y)
          ctx.lineTo(tailX, tailY)
          ctx.stroke()

          const grad = ctx.createLinearGradient(m.x, m.y, tailX, tailY)
          grad.addColorStop(0, `rgba(255,255,255,${1 * m.life})`)
          grad.addColorStop(0.18, `rgba(255,210,160,${0.85 * m.life})`)
          grad.addColorStop(0.5, `rgba(255,140,80,${0.4 * m.life})`)
          grad.addColorStop(1, 'rgba(255,107,44,0)')

          ctx.beginPath()
          ctx.strokeStyle = grad
          ctx.lineWidth = m.width
          ctx.lineCap = 'round'
          ctx.moveTo(m.x, m.y)
          ctx.lineTo(tailX, tailY)
          ctx.stroke()

          // 头部亮点 + 辉光
          const glow = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.width * 5)
          glow.addColorStop(0, `rgba(255,255,255,${0.85 * m.life})`)
          glow.addColorStop(1, 'rgba(255,107,44,0)')
          ctx.beginPath()
          ctx.arc(m.x, m.y, m.width * 5, 0, Math.PI * 2)
          ctx.fillStyle = glow
          ctx.fill()

          ctx.beginPath()
          ctx.arc(m.x, m.y, m.width * 1.4, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(255,255,255,${0.95 * m.life})`
          ctx.fill()
        }
      }

      if (visible && !reduced) raf.current = requestAnimationFrame(draw)
    }

    const onVis = () => {
      visible = !document.hidden
      if (visible && !reduced) {
        last = performance.now()
        raf.current = requestAnimationFrame(draw)
      } else {
        cancelAnimationFrame(raf.current)
      }
    }

    resize()
    if (!reduced) raf.current = requestAnimationFrame(draw)
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', onVis)

    return () => {
      cancelAnimationFrame(raf.current)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [density, meteors])

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ zIndex: 0 }}
    />
  )
}
