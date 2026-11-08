import { useEffect, useState } from 'react'
import { api } from '../api'
import PageShell from '../components/PageShell'

/** 会员/积分页：真实余额 + 充值 + 订阅 + 消费流水。 */
export default function Pricing() {
  const [w, setW] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState(null)
  const load = () => api.balance().then((r) => { setW(r); setSub(r.subscription || { plan: 'free' }) }).catch(e => setError(e.message))
  useEffect(() => { load() }, [])

  const [sub, setSub] = useState({ plan: 'free', daily: 0 })
  const plans = [
    { name: '免费', price: '¥0', feats: ['注册赠送 100 积分', '本地 ComfyUI 生成不扣积分', '自带 API 按平台计费'], plan: 'free' },
    { name: 'Pro', price: '待开放', feats: ['会员权益筹备中'], plan: 'pro' },
    { name: '企业', price: '待开放', feats: ['企业服务筹备中'], plan: 'team' },
  ]
  const selected = plans.find(p => p.plan === (selectedPlan || sub.plan)) || plans[0]
  const act = async fn => {
    setBusy(true); setError('')
    try { await fn(); await load(); window.dispatchEvent(new Event('dc-wallet-changed')) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  return (
    <PageShell title="会员与积分" subtitle="为下一次创作，留足想象的空间。" actions={w && (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-ink-dim">积分余额</span>
            <span className="text-2xl font-bold text-brand-500">{w.balance}</span>
            <button disabled={busy || !w.demo_commerce} onClick={() => act(() => api.recharge(100))}
              className="rounded-lg bg-white/[0.07] px-3 py-1.5 text-xs hover:bg-white/20">
              {w.demo_commerce ? '+100 测试积分' : '充值暂未开放'}
            </button>
          </div>
        )}>
      <div className="space-y-6">
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {w?.demo_commerce && <p className="text-sm text-ink-dim">当前为本地演示账本，不产生真实支付。</p>}

      <div className="pricing-plans" role="radiogroup" aria-label="选择会员套餐">
        {plans.map((p) => (
          <label key={p.name}
            className={`pricing-plan p-6 ${selected.plan === p.plan ? 'is-selected' : ''}`}>
            <input type="radio" name="membership-plan" value={p.plan} aria-label={p.name + '套餐'}
              checked={selected.plan === p.plan} onChange={() => { setSelectedPlan(p.plan); setError('') }} />
            <div className="text-lg font-medium">{p.name}
              {sub.plan === p.plan && <span className="ml-2 text-xs text-brand-500">当前</span>}
            </div>
            <div className="text-3xl font-bold my-3">{p.price}</div>
            <ul className="space-y-1 text-sm text-ink-dim mb-4">
              {p.feats.map((f) => <li key={f}>· {f}</li>)}
            </ul>
            <span className="pricing-plan-choice">{selected.plan === p.plan ? '已选择' : '选择套餐'}</span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-sm text-ink-dim">
          {selected.plan === sub.plan ? `${selected.name}是当前套餐。` : w?.demo_commerce ? `已选择${selected.name}套餐，确认后将更新测试账本。` : `已选择${selected.name}套餐，会员开通暂未开放。`}
        </p>
        {w?.demo_commerce && selected.plan !== sub.plan && <button disabled={busy} onClick={() => act(() => api.subscribe(selected.plan))} className="btn-primary !text-sm">{busy ? '处理中…' : '确认测试切换'}</button>}
      </div>

      {w && w.ledger?.length > 0 && (
        <section>
          <h2 className="text-sm text-ink-dim mb-2">消费流水</h2>
          <table className="w-full text-xs">
            <thead><tr className="text-ink-faint text-left">
              <th className="p-2">时间</th><th className="p-2">原因</th><th className="p-2">变动</th>
            </tr></thead>
            <tbody>
              {w.ledger.map((l) => (
                <tr key={l.id} className="border-t border-white/[0.07]">
                  <td className="p-2">{new Date(l.created_at * 1000).toLocaleString()}</td>
                  <td className="p-2 text-ink-dim">{l.reason}</td>
                  <td className={`p-2 ${l.delta > 0 ? 'text-green-400' : 'text-red-400'}`}>{l.delta > 0 ? '+' : ''}{l.delta}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
    </PageShell>
  )
}
