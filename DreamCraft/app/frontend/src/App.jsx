import { useEffect, useRef, useState } from 'react'
import { Routes, Route, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { Aperture, ArrowUpRight, Bot, Boxes, Clapperboard, Code2, Compass, CreditCard, Film, FolderOpen, House, Image, Layers, ListTodo, LogOut, Menu, Settings2, Users, WandSparkles, X } from 'lucide-react'
import Home from './pages/Home'
import AiImage from './pages/AiImage'
import AiVideo from './pages/AiVideo'
import AiAgent from './pages/AiAgent'
import Tools from './pages/Tools'
import Canvas from './pages/Canvas'
import Explore from './pages/Explore'
import Asset from './pages/Asset'
import TaskCenter from './pages/TaskCenter'
import Novel from './pages/Novel'
import ApiConsole from './pages/ApiConsole'
import Pricing from './pages/Pricing'
import Team from './pages/Team'
import Login from './pages/Login'
import EngineConfig from './pages/EngineConfig'
import { api, getToken, setToken } from './api'
import StarField from './components/StarField'

const NAV = [
  { to: '/ai-tool/home', label: '创作首页', icon: House, group: '创作空间' },
  { to: '/ai-tool/ai-image', label: 'AI 图片', icon: Image },
  { to: '/ai-tool/ai-video', label: 'AI 视频', icon: Film },
  { to: '/ai-tool/ai-agent', label: 'AI 智能体', icon: Bot },
  { to: '/ai-tool/tools', label: '图像工具', icon: WandSparkles },
  { to: '/ai-tool/canvas-home', label: '无限画布', icon: Layers },
  { to: '/ai-tool/novel', label: '短剧工坊', icon: Clapperboard },
  { to: '/ai-tool/explore', label: '灵感发现', icon: Compass, group: '我的工作区' },
  { to: '/ai-tool/asset', label: '素材库', icon: FolderOpen },
  { to: '/ai-tool/task-center', label: '任务中心', icon: ListTodo },
  { to: '/ai-tool/team', label: '团队协作', icon: Users },
  { to: '/ai-tool/jimeng-api', label: '开放 API', icon: Code2, group: '管理' },
  { to: '/ai-tool/engine', label: '引擎设置', icon: Settings2 },
]

export default function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const [user, setUser] = useState(null)
  const [navOpen, setNavOpen] = useState(false)
  const mainRef = useRef(null)
  const menuRef = useRef(null)
  const asideRef = useRef(null)
  const isHome = location.pathname === '/ai-tool/home' || location.pathname === '/'
  const isLogin = location.pathname === '/login'
  const current = NAV.find(n => n.to === location.pathname)

  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      const token = getToken()
      if (!token) { setUser(null); return }
      api.me().then(r => { if (!cancelled && token === getToken()) setUser(r.anon ? null : r) }).catch(() => {})
    }
    refresh()
    window.addEventListener('dc-auth-changed', refresh)
    window.addEventListener('dc-wallet-changed', refresh)
    const timer = setInterval(refresh, 30 * 60 * 1000)
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('dc-auth-changed', refresh); window.removeEventListener('dc-wallet-changed', refresh) }
  }, [])

  useEffect(() => {
    mainRef.current?.scrollTo(0, 0)
    setNavOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!navOpen) return
    asideRef.current?.querySelector('a')?.focus()
    const handleKey = e => {
      if (e.key === 'Escape') { setNavOpen(false); menuRef.current?.focus() }
      if (e.key === 'Tab') {
        const items = asideRef.current?.querySelectorAll('a, button')
        const first = items?.[0], last = items?.[items.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [navOpen])

  return (
    <div className={`app-frame ${isLogin ? 'is-login' : ''}`}>
      <a href="#workspace" className="skip-link">跳至内容</a>
      {navOpen && <button className="nav-scrim" onClick={() => setNavOpen(false)} aria-label="关闭导航" />}
      <aside ref={asideRef} id="navigation" className={`app-sidebar ${navOpen ? 'is-open' : ''}`}>
        <NavLink to="/ai-tool/home" className="brand-lockup">
          <span className="brand-symbol"><Aperture size={23} strokeWidth={1.6} /></span>
          <span><strong>造梦工坊</strong><small>DreamCraft</small></span>
        </NavLink>
        <nav aria-label="主导航" className="sidebar-nav">
          {NAV.map(n => (
            <div key={n.to}>
              {n.group && <div className="nav-group-label">{n.group}</div>}
              <NavLink to={n.to} end className={({ isActive }) => `nav-item ${isActive || (n.to.endsWith('/home') && isHome) ? 'is-active' : ''}`}>
                <n.icon size={17} strokeWidth={1.7} /><span>{n.label}</span>
                {n.to.endsWith('/ai-agent') && <span className="nav-new">新</span>}
              </NavLink>
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <NavLink to="/pricing" className="membership-link"><CreditCard size={17} /><span>会员与积分</span><ArrowUpRight size={15} /></NavLink>
          <div className="sidebar-signature"><Boxes size={13} /> 灵感，从这里发生</div>
        </div>
      </aside>
      <div className="app-workspace">
        <header className="app-topbar">
          <div className="topbar-location">
            <button ref={menuRef} className="icon-button mobile-menu" aria-label="打开导航" aria-expanded={navOpen} aria-controls="navigation" onClick={() => setNavOpen(v => !v)} title="打开导航">{navOpen ? <X size={20} /> : <Menu size={20} />}</button>
            <span className="topbar-brand">DreamCraft</span><span className="topbar-divider">/</span>
            <span>{isLogin ? '账号' : location.pathname === '/pricing' ? '会员与积分' : current?.label || '创作首页'}</span>
          </div>
          <div className="topbar-actions">
            <NavLink to="/ai-tool/task-center" className="icon-button" aria-label="任务中心" title="任务中心"><ListTodo size={18} /></NavLink>
            <NavLink to="/ai-tool/engine" className="icon-button" aria-label="引擎设置" title="引擎设置"><Settings2 size={18} /></NavLink>
            <span className="topbar-rule" />
            {user ? <>
              <NavLink to="/pricing" className="balance-label">{user.balance} <span>积分</span></NavLink>
              <span className="user-avatar" title={user.username}>{user.username?.slice(0, 1)}</span>
              <button className="icon-button" title="退出登录" aria-label="退出登录" onClick={() => { setToken(''); setUser(null) }}><LogOut size={16} /></button>
            </> : <NavLink to="/login" className="login-link">登录 <ArrowUpRight size={14} /></NavLink>}
          </div>
        </header>
        {!isHome && <div className="workspace-atmosphere"><StarField density={0.28} meteors={false} /></div>}
        <main id="workspace" ref={mainRef} className={`workspace-main ${isHome ? 'home-main' : 'tool-main'}`} tabIndex={-1}>
          <div key={`${location.pathname}:${user?.user_id || user?.username || 'anon'}`} className={`route-view ${isHome ? 'home-view' : ''}`}>
            <Routes>
              <Route path="/login" element={<Login onLogin={setUser} />} />
              <Route path="/ai-tool/home" element={<Home onOpen={navigate} />} />
              <Route path="/ai-tool/ai-image" element={<AiImage />} />
              <Route path="/ai-tool/ai-video" element={<AiVideo />} />
              <Route path="/ai-tool/ai-agent" element={<AiAgent />} />
              <Route path="/ai-tool/tools" element={<Tools />} />
              <Route path="/ai-tool/canvas-home" element={<Canvas />} />
              <Route path="/ai-tool/explore" element={<Explore />} />
              <Route path="/ai-tool/asset" element={<Asset />} />
              <Route path="/ai-tool/task-center" element={<TaskCenter />} />
              <Route path="/ai-tool/novel" element={<Novel />} />
              <Route path="/ai-tool/team" element={<Team />} />
              <Route path="/ai-tool/jimeng-api" element={<ApiConsole />} />
              <Route path="/pricing" element={<Pricing />} />
              <Route path="/ai-tool/engine" element={<EngineConfig />} />
              <Route path="*" element={<Home onOpen={navigate} />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  )
}
