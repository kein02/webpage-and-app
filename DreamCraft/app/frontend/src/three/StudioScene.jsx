import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html, RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import { QUALITY } from './quality'

const ORANGE = '#ff6b2c'
const METAL = '#50515a'

function Block({ at = [0, 0, 0], size, color = METAL, rotation, glow = false, radius = 0.035 }) {
  return <RoundedBox position={at} args={size} rotation={rotation} radius={radius} smoothness={2} castShadow receiveShadow>
    <meshStandardMaterial color={color} roughness={0.48} metalness={0.3} emissive={glow ? color : '#000000'} emissiveIntensity={glow ? 0.65 : 0} />
  </RoundedBox>
}

function Rod({ at, height = 1, radius = 0.035, color = METAL, rotation }) {
  return <mesh position={at} rotation={rotation} castShadow><cylinderGeometry args={[radius, radius, height, 12]} /><meshStandardMaterial color={color} roughness={0.35} metalness={0.65} /></mesh>
}

function Station({ id, label, at, children, onSelect, onHover, paused }) {
  const group = useRef()
  const [hovered, setHovered] = useState(false)
  const { invalidate } = useThree()
  useEffect(() => () => { document.body.style.cursor = '' }, [])
  useFrame((_, dt) => {
    const scale = THREE.MathUtils.damp(group.current.scale.x, hovered ? 1.035 : 1, 12, dt)
    group.current.scale.setScalar(scale)
    if (Math.abs(scale - (hovered ? 1.035 : 1)) > 0.0001 && paused) invalidate()
  })
  return <group ref={group} position={at}
    onPointerOver={e => { e.stopPropagation(); setHovered(true); onHover(id); document.body.style.cursor = 'pointer'; invalidate() }}
    onPointerOut={() => { setHovered(false); onHover(null); document.body.style.cursor = ''; invalidate() }}
    onClick={e => { e.stopPropagation(); onSelect(id) }}>
    {children}
    <mesh position={[0, 0.035, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.6, 0.62, 48]} /><meshBasicMaterial color={ORANGE} transparent opacity={hovered ? 0.85 : 0.13} /></mesh>
    <Html position={[0, -0.12, 0.7]} center zIndexRange={[5, 1]}>
      <button className={`scene-hotspot ${hovered ? 'is-hovered' : ''}`} onClick={e => { e.stopPropagation(); onSelect(id) }} onFocus={() => { setHovered(true); invalidate() }} onBlur={() => { setHovered(false); invalidate() }}><span />{label}</button>
    </Html>
  </group>
}

function Monitor() {
  return <>
    <Block at={[0, 0.85, 0]} size={[2.65, 0.13, 1.15]} color="#77757b" />
    {[-1.05, 1.05].map(x => <Block key={x} at={[x, 0.42, 0]} size={[0.08, 0.84, 0.75]} color="#393a42" />)}
    <Block at={[0, 1.15, -0.2]} size={[0.12, 0.5, 0.12]} />
    <Block at={[0, 0.95, -0.2]} size={[0.6, 0.04, 0.35]} />
    <Block at={[0, 1.72, -0.3]} size={[1.85, 1.12, 0.11]} color="#262830" />
    <Block at={[0, 1.73, -0.235]} size={[1.7, 0.94, 0.015]} color="#d66336" glow />
    <mesh position={[-0.4, 1.89, -0.215]}><circleGeometry args={[0.18, 32]} /><meshBasicMaterial color="#ffe2b2" /></mesh>
    <mesh position={[0.05, 1.46, -0.21]}><coneGeometry args={[0.65, 0.65, 3]} /><meshStandardMaterial color="#773e42" /></mesh>
    <mesh position={[-0.5, 1.43, -0.19]}><coneGeometry args={[0.45, 0.48, 3]} /><meshStandardMaterial color="#343e50" /></mesh>
    <Block at={[0.02, 0.95, 0.29]} size={[0.85, 0.04, 0.28]} color="#c2bdba" />
    <Block at={[0.75, 0.95, 0.32]} size={[0.16, 0.07, 0.23]} color="#beb9b7" />
    <Block at={[1.01, 1.05, -0.3]} size={[0.24, 0.32, 0.24]} color="#252731" />
  </>
}

function VideoCamera() {
  return <>
    <Rod at={[0, 0.7, 0]} height={1.4} />
    {[-0.6, 0.6].map(x => <Rod key={x} at={[x * 0.4, 0.4, 0.15]} height={0.95} rotation={[0, 0, -x]} />)}
    <Rod at={[0, 0.4, -0.26]} height={0.95} rotation={[-0.55, 0, 0]} />
    <Block at={[0, 1.5, 0]} size={[0.75, 0.55, 0.5]} color="#43454e" />
    <Rod at={[0, 1.52, 0.37]} height={0.38} radius={0.23} rotation={[Math.PI / 2, 0, 0]} color="#242630" />
    <mesh position={[0, 1.52, 0.57]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.18, 0.18, 0.02, 24]} /><meshStandardMaterial color="#71b8cb" metalness={0.85} roughness={0.12} /></mesh>
    {[-0.22, 0.22].map(x => <Rod key={x} at={[x, 1.92, 0]} height={0.16} radius={0.24} rotation={[Math.PI / 2, 0, 0]} color="#87868b" />)}
    <Block at={[-0.42, 1.6, 0.03]} size={[0.12, 0.12, 0.2]} color={ORANGE} glow />
  </>
}

function Assistant() {
  return <>
    <Block at={[0, 0.18, 0]} size={[0.95, 0.3, 0.95]} color="#484b52" />
    <Block at={[0, 0.8, 0]} size={[0.66, 0.9, 0.54]} color="#a4b8b2" radius={0.1} />
    <Block at={[0, 1.27, 0]} size={[0.93, 0.62, 0.62]} color="#bfd2c9" radius={0.1} />
    <Block at={[0, 1.29, 0.32]} size={[0.73, 0.27, 0.02]} color="#243f40" />
    {[-0.2, 0.2].map(x => <Block key={x} at={[x, 1.3, 0.34]} size={[0.08, 0.09, 0.025]} color="#a0ffde" glow />)}
    <Rod at={[0, 1.7, 0]} height={0.3} radius={0.025} />
    <Block at={[0, 1.88, 0]} size={[0.09, 0.09, 0.09]} color={ORANGE} glow />
    {[-0.45, 0.45].map(x => <Block key={x} at={[x, 0.8, 0]} size={[0.16, 0.5, 0.2]} color="#7c9993" />)}
  </>
}

function Easel() {
  return <group rotation={[0, -0.2, 0]}>
    {[-0.47, 0.47].map(x => <Rod key={x} at={[x, 0.9, 0]} height={1.85} radius={0.04} color="#a5a0a0" rotation={[0, 0, x * -0.13]} />)}
    <Rod at={[0, 0.75, -0.32]} height={1.55} rotation={[-0.35, 0, 0]} />
    <Block at={[0, 1.28, 0.08]} size={[1.3, 1.43, 0.08]} color="#dcd9d2" />
    <Block at={[0, 1.3, 0.13]} size={[1.13, 1.24, 0.025]} color="#7e9ca4" />
    <mesh position={[0.2, 1.57, 0.15]}><circleGeometry args={[0.26, 32]} /><meshBasicMaterial color="#eed4ba" /></mesh>
    <mesh position={[-0.1, 1.09, 0.17]}><coneGeometry args={[0.6, 0.8, 3]} /><meshStandardMaterial color="#314d60" /></mesh>
    <Block at={[0, 0.57, 0.12]} size={[1.5, 0.09, 0.25]} color="#a5a0a0" />
  </group>
}

function ToolBench() {
  return <>
    <Block at={[0, 0.35, 0]} size={[1.1, 0.65, 0.75]} color="#5c6373" />
    <Block at={[0, 0.7, 0]} size={[1.18, 0.08, 0.85]} color="#babec4" />
    <Block at={[0, 0.42, 0.39]} size={[0.8, 0.05, 0.04]} color={ORANGE} />
    <Block at={[-0.25, 0.88, 0]} size={[0.2, 0.3, 0.2]} color="#c9afad" />
    {[-0.3, -0.2].map((x, i) => <Rod key={x} at={[x, 1.15, 0]} height={0.4} radius={0.025} color={i ? '#b2cacc' : ORANGE} rotation={[0, 0, i ? -0.15 : 0.15]} />)}
    <Block at={[0.28, 0.8, 0.1]} size={[0.4, 0.12, 0.3]} color="#ded8c7" rotation={[0, 0.2, 0]} />
  </>
}

function Bookshelf() {
  return <>
    {[-0.65, 0.65].map(x => <Block key={x} at={[x, 1, 0]} size={[0.09, 2, 0.65]} color="#717378" />)}
    {[0.1, 0.8, 1.5, 2].map(y => <Block key={y} at={[0, y, 0]} size={[1.4, 0.08, 0.65]} color="#717378" />)}
    {['#b9a393', '#7299a2', '#d77950', '#8e9b81', '#bbc1c8'].map((c, i) => <Block key={c} at={[-0.42 + i * 0.2, 1.1, 0.04]} size={[0.13, 0.52 + (i % 2) * 0.08, 0.43]} color={c} rotation={[0, 0, i === 4 ? -0.12 : 0]} />)}
    <Block at={[-0.15, 0.24, 0]} size={[0.7, 0.2, 0.42]} color="#a899aa" />
    <Block at={[-0.1, 0.43, 0.02]} size={[0.65, 0.14, 0.4]} color="#d0c5b3" rotation={[0, 0.15, 0]} />
    <Block at={[0, 1.72, 0.05]} size={[0.5, 0.3, 0.35]} color="#d38558" />
  </>
}

function Room({ onSelect, onHover, paused }) {
  return <group rotation={[0, -0.08, 0]}>
    <Block at={[0, -0.18, 0]} size={[7.9, 0.3, 6.9]} color="#343740" radius={0.12} />
    <Block at={[0, -0.01, 0]} size={[7.68, 0.05, 6.68]} color="#494c55" />
    <Block at={[0, 1.65, -3.3]} size={[7.8, 3.35, 0.14]} color="#555661" />
    <Block at={[-3.84, 1.65, 0]} size={[0.14, 3.35, 6.6]} color="#464954" />
    <Block at={[0, 0.08, -3.18]} size={[7.6, 0.025, 0.025]} color={ORANGE} glow />
    <Block at={[-3.72, 0.08, 0]} size={[0.025, 0.025, 6.3]} color={ORANGE} glow />
    <Block at={[-3.72, 2, -1.25]} size={[0.08, 1.6, 2.5]} color="#202632" />
    <Block at={[-3.65, 2, -1.25]} size={[0.03, 1.4, 2.28]} color="#75a1b2" glow />
    <Block at={[-3.61, 2, -1.25]} size={[0.035, 1.48, 0.05]} color="#424650" />
    <Block at={[-3.61, 2, -1.25]} size={[0.035, 0.05, 2.4]} color="#424650" />
    <Block at={[0.25, 0.035, 0.8]} size={[3.5, 0.025, 2.8]} color="#796f78" />
    <Station id="image" label="AI 图片" at={[-1.6, 0, -1.8]} {...{ onSelect, onHover, paused }}><Monitor /></Station>
    <Station id="video" label="AI 视频" at={[2.4, 0, 1.8]} {...{ onSelect, onHover, paused }}><VideoCamera /></Station>
    <Station id="agent" label="智能体" at={[0.4, 0, 0.7]} {...{ onSelect, onHover, paused }}><Assistant /></Station>
    <Station id="canvas" label="无限画布" at={[-2.6, 0, 1.7]} {...{ onSelect, onHover, paused }}><Easel /></Station>
    <Station id="tools" label="图像工具" at={[0.2, 0, -2.3]} {...{ onSelect, onHover, paused }}><ToolBench /></Station>
    <Station id="novel" label="短剧工坊" at={[2.5, 0, -2.6]} {...{ onSelect, onHover, paused }}><Bookshelf /></Station>
    <Rod at={[2.5, 1.4, -0.5]} height={2.8} radius={0.025} color="#beb9b3" />
    <Rod at={[2.5, 0.05, -0.5]} height={0.07} radius={0.32} />
    <mesh position={[2.5, 2.75, -0.5]}><coneGeometry args={[0.38, 0.38, 24, 1, true]} /><meshStandardMaterial color="#efcab0" side={THREE.DoubleSide} emissive={ORANGE} emissiveIntensity={0.18} /></mesh>
    <Block at={[-0.4, 2.3, -3.17]} size={[0.8, 0.8, 0.06]} color="#c7baad" />
    <Block at={[-0.4, 2.3, -3.13]} size={[0.64, 0.64, 0.02]} color="#a96250" />
    <mesh position={[-0.4, 2.3, -3.1]}><ringGeometry args={[0.13, 0.21, 32]} /><meshBasicMaterial color="#f7c49b" /></mesh>
  </group>
}

function Dust({ paused, count }) {
  const points = useRef()
  const positions = useMemo(() => {
    const a = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) { a[i * 3] = Math.sin(i * 137.5) * 10; a[i * 3 + 1] = (i % 37) / 5; a[i * 3 + 2] = Math.cos(i * 73.9) * 9 }
    return a
  }, [count])
  useFrame((_, dt) => { if (!paused) points.current.rotation.y += dt * 0.008 })
  return <points ref={points}><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry><pointsMaterial size={0.018} color="#e4c0a9" transparent opacity={0.35} depthWrite={false} /></points>
}

function CameraRig({ paused, progress, onReady }) {
  const { camera, gl, invalidate, size } = useThree()
  const drag = useRef({ active: false, x: 0, y: 0, rx: 0, ry: 0 })
  const elapsed = useRef(0)
  const destination = useMemo(() => new THREE.Vector3(), [])
  useEffect(() => { onReady?.() }, [])
  useEffect(() => {
    const el = gl.domElement
    const down = e => { drag.current.active = true; drag.current.x = e.clientX; drag.current.y = e.clientY; invalidate() }
    const move = e => {
      const d = drag.current
      if (!d.active) return
      d.ry = THREE.MathUtils.clamp(d.ry + (e.clientX - d.x) * 0.003, -Math.PI / 6, Math.PI / 6)
      d.rx = THREE.MathUtils.clamp(d.rx + (e.clientY - d.y) * 0.002, -Math.PI / 6, Math.PI / 6)
      d.x = e.clientX; d.y = e.clientY; invalidate()
    }
    const up = () => { drag.current.active = false; invalidate() }
    el.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => { el.removeEventListener('pointerdown', down); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up) }
  }, [gl, invalidate])
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05), d = drag.current
    if (!paused) elapsed.current += dt
    if (!d.active) { d.rx = THREE.MathUtils.damp(d.rx, 0, 5, dt); d.ry = THREE.MathUtils.damp(d.ry, 0, 5, dt) }
    const intro = Math.max(0, 1 - elapsed.current / 1.4)
    const angle = 0.76 + d.ry + (paused ? 0 : progress.current * 0.12)
    const compact = size.width / size.height < 1.5
    const radius = (compact ? 16 : 14.5) + intro * 2
    destination.set(Math.sin(angle) * radius, (compact ? 10.7 : 9.6) + d.rx * 5 + intro, Math.cos(angle) * radius)
    camera.position.lerp(destination, 1 - Math.exp(-5 * dt))
    camera.lookAt(0, 0.8, 0)
    if (paused && camera.position.distanceTo(destination) > 0.001) invalidate()
  })
  return null
}

export default function StudioScene({ onSelect, onHover, onReady, quality = 'high', visible = true, paused = false, progress }) {
  const high = quality === 'high'
  const q = QUALITY[quality] || QUALITY.low
  return <Canvas shadows={q.shadows} dpr={[1, q.dpr]} frameloop={!visible ? 'never' : paused ? 'demand' : 'always'} camera={{ position: [11, 10, 11], fov: 40 }} gl={{ antialias: q.antialias, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' }} onCreated={({ gl }) => { gl.toneMappingExposure = 1.25 }}>
    <fog attach="fog" args={['#0b0b10', 23, 43]} />
    <ambientLight intensity={1.5} color="#d7deeb" />
    <directionalLight position={[2, 10, 7]} intensity={3.5} color="#fff4e6" castShadow={high} shadow-mapSize={[1024, 1024]} shadow-camera-left={-8} shadow-camera-right={8} shadow-camera-top={8} shadow-camera-bottom={-8} shadow-bias={-0.001} />
    <pointLight position={[-2, 3, 2]} intensity={22} color={ORANGE} distance={12} decay={2} />
    <CameraRig {...{ paused, progress, onReady }} />
    <Room {...{ onSelect, onHover, paused }} />
    <Dust paused={paused} count={q.particles} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.39, 0]} receiveShadow><planeGeometry args={[200, 200]} /><shadowMaterial transparent opacity={0.26} /></mesh>
  </Canvas>
}
