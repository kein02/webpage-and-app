import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, afterLogin, setToken } from '../api'
import { Aperture } from 'lucide-react'

/** 登录 / 注册：JWT，新用户送 100 积分。 */
export default function Login({ onLogin }) {
  const [tab, setTab] = useState('login')
  const [form, setForm] = useState({ username: '', password: '' })
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()

  const doIt = async () => {
    if (busy) return
    setBusy(true); setMsg('')
    try {
      const r = tab === 'login'
        ? await api.login(form)
        : await api.register(form)
      afterLogin(r)
      if (onLogin) onLogin({ user_id: r.user_id, username: r.username, balance: r.balance })
      setMsg(`已${tab === 'login' ? '登录' : '注册'}，余额 ${r.balance}`)
      setTimeout(() => nav('/'), 400)
    } catch (e) {
      setMsg('✗ ' + e.message)
    } finally { setBusy(false) }
  }

  return (
    <div className="login-screen">
      <div className="w-full max-w-sm panel p-6 space-y-4 border border-white/[0.07]">
        <div className="text-center space-y-1">
          <div className="login-brand-icon"><Aperture size={35} strokeWidth={1.3} /></div>
          <h1 className="text-lg font-bold">造梦工坊</h1>
          <p className="text-xs text-ink-faint">{tab === 'login' ? '欢迎回来，继续你的创作。' : '开启创作，领取 100 积分。'}</p>
        </div>

        <div className="flex gap-2">
          {['login', 'register'].map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 rounded-lg py-1.5 text-sm ${tab === t ? 'bg-brand-500' : 'bg-white/[0.07]'}`}>
              {t === 'login' ? '登录' : '注册'}
            </button>
          ))}
        </div>

        <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })}
          placeholder="用户名" className="w-full rounded-lg bg-space-950/60 border border-white/[0.07] px-3 py-2 text-sm" />
        <input value={form.password} type="password"
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && doIt()}
          placeholder="密码（至少 6 位）"
          className="w-full rounded-lg bg-space-950/60 border border-white/[0.07] px-3 py-2 text-sm" />
        <button onClick={doIt} disabled={busy}
          className="w-full rounded-lg bg-brand-500 py-2 text-sm disabled:opacity-50">
          {busy ? '…' : (tab === 'login' ? '登录' : '注册并登录')}
        </button>

        {msg && <div className="text-xs text-center text-ink-dim">{msg}</div>}
        <div className="text-center text-xs text-ink-faint">
          <Link to="/" className="text-ink-faint hover:text-ink-dim">先匿名体验 →</Link>
        </div>
      </div>
    </div>
  )
}
