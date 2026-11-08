import { useRef, useState } from 'react'
import { api, assetUrl } from '../api'
import { getLocalEngine, routeGenerate } from '../engine'
import { Bot, LoaderCircle, Send, User } from 'lucide-react'

export default function AiAgent() {
  const [msgs, setMsgs] = useState([
    { role: 'assistant', content: '你好，我是造梦工坊创作助手。告诉我你想创作的画面。' },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef(null)

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setMsgs((m) => [...m, { role: 'user', content: text }])
    setBusy(true)
    try {
      const local = getLocalEngine()
      if (local.comfyui_url || local.agnes_key) {
        const r = await routeGenerate({ prompt: text, model: local.default_engine || 'default', aspectRatio: '1:1', resolution: 1024, n: 1 })
        if (!r.results?.[0]?.url) throw new Error('引擎没有返回图片')
        setMsgs(m => [...m, { role: 'assistant', content: r.warning || '画面已生成。', image: r.results[0].url }])
        return
      }
      const r = await api.agentRun({
        messages: [...msgs, { role: 'user', content: text }].map((m) => ({ role: m.role, content: m.content })),
        model: 'agentic',
      })
      const img = r.result?.image?.results?.[0]
      setMsgs((m) => [
        ...m,
        { role: 'assistant', content: r.result.reply, image: img?.url },
      ])
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', content: '请求失败：' + e.message }])
    } finally {
      setBusy(false)
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    }
  }

  return (
    <div className="chat-layout">
      <header className="page-heading"><div><h1>AI 智能体</h1><p>一起整理思路，探索创作的更多可能。</p></div><Bot size={23} className="text-brand-500" /></header>
      <div className="chat-messages" aria-live="polite">
        {msgs.map((m, i) => (
          <div key={i} className={`chat-message ${m.role === 'user' ? 'is-user' : ''}`}>
            <span className="chat-avatar">{m.role === 'user' ? <User size={16} /> : <Bot size={17} />}</span>
            <div className="chat-bubble">
              {m.content}
              {m.image && <img src={assetUrl(m.image)} className="mt-3 rounded-lg max-h-72" alt="gen" />}
            </div>
          </div>
        ))}
        {busy && <div className="chat-message"><span className="chat-avatar"><Bot size={17} /></span><div className="chat-bubble"><LoaderCircle size={16} className="animate-spin" /></div></div>}
        <div ref={endRef} />
      </div>
      <div className="chat-composer">
        <input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && send()}
          placeholder="此刻，有什么创作灵感？" aria-label="消息"
          />
        <button onClick={send} disabled={busy || !input.trim()} title="发送消息" aria-label="发送消息"
          className="btn-primary"><Send size={16} /></button>
      </div>
    </div>
  )
}
