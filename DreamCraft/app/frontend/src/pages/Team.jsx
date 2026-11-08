import { useEffect, useState } from 'react'
import { api } from '../api'
import { Users } from 'lucide-react'
import PageShell from '../components/PageShell'

const ROLE_LABEL = { owner: '所有者', admin: '管理员', editor: '编辑', viewer: '访客' }
const PLAN_LABEL = { free: '免费版', pro: 'Pro 版', team: '企业版' }

/** 团队管理：切换团队 / 成员 / 角色 / 席位 / 套餐升级。 */
export default function Team() {
  const [teams, setTeams] = useState([])
  const [tid, setTid] = useState(null)
  const [t, setT] = useState(null)
  const [form, setForm] = useState({ name: '', email: '' })
  const [toast, setToast] = useState('')
  const [teamName, setTeamName] = useState('')

  const say = (m) => { setToast(m); setTimeout(() => setToast(''), 3000) }

  const loadTeams = () => api.teamList().then((r) => {
    setTeams(r.teams ?? [])
    if ((r.teams ?? []).length && !tid) setTid(r.teams[0].id)
  }).catch(e => say(e.message))
  // 注意：effect 不能直接返回 Promise，否则 React 会当清理函数调用（destroy is not a function）
  useEffect(() => { loadTeams() }, [])

  useEffect(() => {
    if (!tid) return
    let cancelled = false
    setT(null)
    api.teamGet(tid).then(r => { if (!cancelled) setT(r) }).catch(e => { if (!cancelled) say(e.message) })
    return () => { cancelled = true }
  }, [tid])

  const createTeam = async () => {
    try {
      const r = await api.teamCreate({ name: teamName || '新团队' })
      say('已创建团队 ' + r.name)
      loadTeams()
      setTid(r.team_id)
      setTeamName('')
    } catch (e) { say('✗ ' + e.message) }
  }

  const addMember = async () => {
    try {
      await api.teamAddMember(tid, { name: form.name, email: form.email, role: 'editor' })
      say('已加入成员 ' + form.name)
      setT(await api.teamGet(tid))
      setForm({ name: '', email: '' })
    } catch (e) { say('✗ ' + e.message) }
  }

  const changeRole = async (mid, role) => {
    try {
    await api.teamSetRole(tid, mid, role)
    setT(await api.teamGet(tid))
    } catch (e) { say(e.message) }
  }

  const remove = async (mid) => {
    try {
    await api.teamRemoveMember(tid, mid)
    setT(await api.teamGet(tid))
    } catch (e) { say(e.message) }
  }

  // 席位进度条
  const seatPct = t ? Math.min(100, (t.members.length / t.seat_limit) * 100) : 0

  return (
    <PageShell title="团队协作" subtitle="让好的想法，在彼此之间生长。" actions={toast && <div role="status" className="text-xs text-brand-500">{toast}</div>}>
    <div className="space-y-5">

      {/* 团队切换 */}
      {teams.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          {teams.map((x) => (
            <button key={x.id} onClick={() => setTid(x.id)}
              className={`rounded-lg px-3 py-1.5 text-sm ${tid === x.id ? 'bg-brand-500' : 'bg-white/[0.07]'}`}>
              {x.name}
            </button>
          ))}
          <input value={teamName} onChange={(e) => setTeamName(e.target.value)}
            placeholder="新团队名" className="rounded-lg bg-space-950/60 border border-white/[0.07] px-3 py-1.5 text-sm w-32" />
          <button onClick={createTeam} className="rounded-lg bg-white/[0.07] px-3 text-sm">+ 建团队</button>
        </div>
      )}

      {t && (
        <section className="panel p-4 space-y-4">
          {/* 头部：套餐 + 席位进度 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-ink-dim">
                套餐 <span className="text-ink font-medium">{PLAN_LABEL[t.plan] || t.plan}</span>
              </div>
              <button onClick={async () => {
                try {
                const next = t.plan === 'free' ? 'pro' : t.plan === 'pro' ? 'team' : 'team'
                await api.teamSetPlan(tid, next)
                say('套餐已切换为 ' + PLAN_LABEL[next] + '，席位上限更新')
                setT(await api.teamGet(tid))
                } catch (e) { say(e.message) }
              }}
                className="rounded bg-brand-500/30 px-3 py-1 text-xs hover:bg-brand/50">
                升级套餐 →
              </button>
            </div>
            <div className="text-xs text-ink-faint mb-1">
              席位 {t.members.length}/{t.seat_limit}
            </div>
            <div className="h-1.5 rounded bg-white/[0.07] overflow-hidden">
              <div className="h-full rounded bg-brand-500" style={{ width: seatPct + '%' }} />
            </div>
          </div>

          {/* 加成员 */}
          <div className="flex gap-2 text-xs">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="成员名" className="rounded bg-space-950/60 border border-white/[0.07] px-2 py-1.5 flex-1" />
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="邮箱" className="rounded bg-space-950/60 border border-white/[0.07] px-2 py-1.5 flex-1" />
            <button onClick={addMember}
              disabled={seatPct >= 100}
              className="rounded bg-brand-500/40 px-3 disabled:opacity-40">
              + 加成员{seatPct >= 100 ? '（席位满）' : ''}
            </button>
          </div>

          {/* 成员表 */}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-faint text-xs">
                <th className="p-2">成员</th><th className="p-2">邮箱</th>
                <th className="p-2">角色</th><th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {t.members.map((m) => (
                <tr key={m.id} className="border-t border-white/[0.07]">
                  <td className="p-2">{m.name}</td>
                  <td className="p-2 text-ink-faint text-xs">{m.email}</td>
                  <td className="p-2">
                    <select value={m.role} onChange={(e) => changeRole(m.id, e.target.value)}
                      disabled={m.role === 'owner'}
                      className="rounded bg-space-950/60 border border-white/[0.07] text-xs px-2 py-1">
                      {Object.entries(ROLE_LABEL).filter(([k]) => k !== 'owner' || m.role === 'owner').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td className="p-2 text-right">
                    {m.role !== 'owner' && (
                      <button onClick={() => remove(m.id)} className="text-xs text-red-400">移除</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {!t && teams.length === 0 && (
        <div className="empty-state"><Users size={38} strokeWidth={1} /><strong>组建你的创作团队</strong><div className="flex flex-wrap justify-center gap-2"><input className="inp !w-44" aria-label="团队名称" placeholder="团队名称" value={teamName} onChange={e => setTeamName(e.target.value)} /><button className="btn-primary !text-xs" onClick={createTeam}>创建团队</button></div></div>
      )}
    </div>
    </PageShell>
  )
}
