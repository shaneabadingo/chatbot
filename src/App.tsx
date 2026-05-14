import { useState, useRef, useEffect, useCallback } from 'react'

interface Message {
  id: number
  role: 'user' | 'assistant'
  text: string
  displayText: string
  time: string
  date: string
  liked: boolean
  copied: boolean
}

const now = () => new Date()
const fmtTime = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const fmtDate = (d: Date) => {
  const today = new Date()
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
}

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY
const MODEL = import.meta.env.VITE_GEMINI_MODEL || 'gemini-2.5-flash-lite'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`

const SUGGESTIONS = [
  { icon: '⌘', label: 'Write & Edit', sub: 'drafts, emails, essays' },
  { icon: '◈', label: 'Explain Concepts', sub: 'science, math, history' },
  { icon: '◎', label: 'Brainstorm', sub: 'ideas & strategy' },
  { icon: '⟨⟩', label: 'Code & Debug', sub: 'review, fix, build' },
]

const HISTORY = [
  { label: 'How neural networks learn', prompt: 'Can you explain how neural networks learn in simple terms?' },
  { label: 'Write a product brief',     prompt: 'Help me write a product brief for a new app idea.' },
  { label: 'Explain async/await',       prompt: 'Can you explain async/await in JavaScript with examples?' },
  { label: 'Best practices for APIs',   prompt: 'What are the best practices for designing REST APIs?' },
]

export default function App() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [apiError, setApiError] = useState('')
  const [activeChat, setActiveChat] = useState<string | null>(null)
  const [tick, setTick] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const streamRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const check = () => {
      const mobile = window.innerWidth < 768
      setIsMobile(mobile)
      setSidebarOpen(!mobile)
    }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => {
    const t = setInterval(() => setTick(p => !p), 530)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, thinking])

  const streamText = useCallback((fullText: string, msgId: number) => {
    setStreaming(true)
    let i = 0
    const tick = () => {
      i += Math.floor(Math.random() * 4) + 1
      const chunk = fullText.slice(0, Math.min(i, fullText.length))
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, displayText: chunk } : m))
      if (i < fullText.length) {
        streamRef.current = setTimeout(tick, 14 + Math.random() * 12)
      } else {
        setMessages(prev => prev.map(m => m.id === msgId ? { ...m, displayText: fullText } : m))
        setStreaming(false)
      }
    }
    tick()
  }, [])

  const send = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || thinking || streaming) return
    const d = now()
    const userMsg: Message = {
      id: Date.now(), role: 'user',
      text: trimmed, displayText: trimmed,
      time: fmtTime(d), date: fmtDate(d), liked: false, copied: false,
    }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setApiError('')
    if (isMobile) setSidebarOpen(false)
    if (textareaRef.current) textareaRef.current.style.height = '44px'
    setThinking(true)

    try {
      const history = [...messages, userMsg].map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.text }],
      }))
      const res = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: history }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err?.error?.message || `Request failed (${res.status})`)
      }
      const data = await res.json()
      const reply: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? 'No response received.'
      const d2 = now()
      const aiId = Date.now() + 1
      setMessages(prev => [...prev, {
        id: aiId, role: 'assistant',
        text: reply, displayText: '',
        time: fmtTime(d2), date: fmtDate(d2), liked: false, copied: false,
      }])
      setThinking(false)
      streamText(reply, aiId)
    } catch (err: unknown) {
      setThinking(false)
      setApiError(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }

  const toggleLike = (id: number) =>
    setMessages(prev => prev.map(m => m.id === id ? { ...m, liked: !m.liked } : m))

  const copyMsg = (id: number, text: string) => {
    navigator.clipboard.writeText(text)
    setMessages(prev => prev.map(m => m.id === id ? { ...m, copied: true } : m))
    setTimeout(() => setMessages(prev => prev.map(m => m.id === id ? { ...m, copied: false } : m)), 1800)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
  }
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const ta = textareaRef.current
    if (ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 180) + 'px' }
  }

  const grouped: { date: string; msgs: Message[] }[] = []
  messages.forEach(m => {
    const last = grouped[grouped.length - 1]
    if (last && last.date === m.date) last.msgs.push(m)
    else grouped.push({ date: m.date, msgs: [m] })
  })

  const empty = messages.length === 0

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oxanium:wght@300;400;500;600;700&family=DM+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --bg:       #080808;
          --s1:       #0f0f0f;
          --s2:       #141414;
          --s3:       #1a1a1a;
          --s4:       #202020;
          --b0:       rgba(255,255,255,0.04);
          --b1:       rgba(255,255,255,0.07);
          --b2:       rgba(255,255,255,0.12);
          --b3:       rgba(255,255,255,0.20);
          --green:    #00C07A;
          --green-hi: #00E090;
          --green-lo: #00A066;
          --ga:       rgba(0,192,122,0.12);
          --gf:       rgba(0,192,122,0.06);
          --red:      #FF4757;
          --text:     #EBEBEB;
          --t2:       #909090;
          --t3:       #555555;
          --t4:       #333333;
          --r1:       6px;
          --r2:       10px;
          --r3:       14px;
          --mono:     'JetBrains Mono', monospace;
          --sans:     'DM Sans', sans-serif;
          --display:  'Oxanium', sans-serif;
        }

        html, body, #root { height: 100%; width: 100%; overflow: hidden; }
        body {
          background: var(--bg); color: var(--text);
          font-family: var(--sans); -webkit-font-smoothing: antialiased;
        }

        /* Dot-grid background */
        body::before {
          content: ''; position: fixed; inset: 0; z-index: 0; pointer-events: none;
          background-image: radial-gradient(circle, rgba(255,255,255,0.035) 1px, transparent 1px);
          background-size: 24px 24px;
        }
        /* Vignette */
        body::after {
          content: ''; position: fixed; inset: 0; z-index: 0; pointer-events: none;
          background: radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.7) 100%);
        }

        /* Scanline shimmer */
        @keyframes scan {
          0%   { transform: translateY(-100%); }
          100% { transform: translateY(100vh); }
        }
        .scanline {
          position: fixed; left: 0; right: 0; top: 0; height: 2px; z-index: 0; pointer-events: none;
          background: linear-gradient(to bottom, transparent, rgba(0,192,122,0.04), transparent);
          animation: scan 6s linear infinite;
        }

        .layout { position: relative; z-index: 1; display: flex; height: 100dvh; width: 100%; }

        /* ── BACKDROP ── */
        .sb-backdrop {
          position: fixed; inset: 0; z-index: 10;
          background: rgba(0,0,0,0.75); backdrop-filter: blur(6px);
          animation: fadeIn 0.2s ease;
        }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

        /* ── SIDEBAR ── */
        .sidebar {
          flex-shrink: 0; overflow: hidden;
          width: ${sidebarOpen ? '260px' : '0px'};
          transition: width 0.3s cubic-bezier(0.4,0,0.2,1);
          display: flex; flex-direction: column;
          background: var(--s1);
          border-right: 1px solid var(--b1);
          position: relative; z-index: 11;
        }
        .sidebar-inner { width: 260px; height: 100%; display: flex; flex-direction: column; overflow: hidden; }

        /* Sidebar accent line */
        .sidebar-inner::before {
          content: ''; position: absolute; top: 0; left: 0; bottom: 0; width: 1px;
          background: linear-gradient(to bottom, transparent, var(--green), transparent);
          opacity: 0.3;
        }

        .sb-head { padding: 18px 16px 14px; border-bottom: 1px solid var(--b1); flex-shrink: 0; }
        .sb-logo { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
        .sb-logo-mark {
          width: 32px; height: 32px; border-radius: var(--r1); flex-shrink: 0;
          background: var(--green); display: flex; align-items: center; justify-content: center;
          font-family: var(--display); font-size: 0.9rem; font-weight: 700; color: #000;
          box-shadow: 0 0 16px rgba(0,192,122,0.4);
          position: relative;
        }
        .sb-logo-mark::after {
          content: ''; position: absolute; inset: -1px; border-radius: calc(var(--r1) + 1px);
          border: 1px solid rgba(0,192,122,0.5); pointer-events: none;
        }
        .sb-logo-name { font-family: var(--display); font-size: 1rem; font-weight: 600; color: var(--text); letter-spacing: 0.04em; }
        .sb-logo-ver {
          margin-left: auto; font-family: var(--mono); font-size: 0.55rem;
          color: var(--green); background: var(--gf); border: 1px solid rgba(0,192,122,0.2);
          border-radius: 3px; padding: 2px 6px;
        }

        .new-chat {
          width: 100%; padding: 0 14px; height: 40px; min-height: 40px;
          background: var(--gf); border: 1px solid rgba(0,192,122,0.18);
          border-radius: var(--r1); color: var(--green);
          font-family: var(--mono); font-size: 0.72rem; font-weight: 500;
          cursor: pointer; display: flex; align-items: center; gap: 8px;
          transition: all 0.18s; letter-spacing: 0.02em;
        }
        .new-chat:hover { background: var(--ga); border-color: rgba(0,192,122,0.4); box-shadow: 0 0 16px rgba(0,192,122,0.1); }
        .new-chat svg { width: 14px; height: 14px; flex-shrink: 0; }

        .sb-label { padding: 14px 16px 5px; font-family: var(--mono); font-size: 0.55rem; text-transform: uppercase; letter-spacing: 0.15em; color: var(--t3); flex-shrink: 0; }
        .sb-history { flex: 1; overflow-y: auto; padding: 4px 8px; }
        .sb-history::-webkit-scrollbar { width: 2px; }
        .sb-history::-webkit-scrollbar-thumb { background: var(--b2); }

        .hist-item {
          padding: 9px 10px; min-height: 40px; border-radius: var(--r1);
          font-family: var(--sans); font-size: 0.75rem; color: var(--t2);
          cursor: pointer; display: flex; align-items: center; gap: 8px;
          transition: all 0.14s; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          margin-bottom: 1px; position: relative; border: 1px solid transparent;
        }
        .hist-item:hover { background: var(--s3); color: var(--text); border-color: var(--b1); }
        .hist-item.active {
          background: var(--gf); color: var(--green); border-color: rgba(0,192,122,0.15);
        }
        .hist-item.active::before {
          content: ''; position: absolute; left: 0; top: 25%; bottom: 25%;
          width: 2px; border-radius: 0 2px 2px 0; background: var(--green);
          box-shadow: 0 0 6px var(--green);
        }
        .hist-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--t3); flex-shrink: 0; transition: all 0.14s; }
        .hist-item.active .hist-dot { background: var(--green); box-shadow: 0 0 5px var(--green); }

        .sb-footer { padding: 10px 8px; border-top: 1px solid var(--b1); flex-shrink: 0; }
        .model-card {
          display: flex; align-items: center; gap: 9px; padding: 9px 11px;
          background: var(--s2); border: 1px solid var(--b1); border-radius: var(--r1);
          position: relative; overflow: hidden;
        }
        .model-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent, rgba(0,192,122,0.3), transparent); }
        .status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--green); flex-shrink: 0; animation: blink-dot 2.5s ease-in-out infinite; }
        @keyframes blink-dot { 0%,100% { box-shadow: 0 0 4px var(--green); } 50% { box-shadow: 0 0 10px var(--green), 0 0 18px rgba(0,192,122,0.3); } }
        .model-info { flex: 1; min-width: 0; }
        .model-label { font-family: var(--display); font-size: 0.72rem; font-weight: 600; color: var(--text); }
        .model-id { font-family: var(--mono); font-size: 0.55rem; color: var(--t3); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .model-badge { font-family: var(--mono); font-size: 0.5rem; background: var(--green); color: #000; padding: 2px 6px; border-radius: 3px; font-weight: 700; flex-shrink: 0; letter-spacing: 0.04em; }

        /* ── MAIN ── */
        .main { flex: 1; min-width: 0; display: flex; flex-direction: column; position: relative; }

        /* ── TOPBAR ── */
        .topbar {
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 18px; height: 52px; flex-shrink: 0;
          border-bottom: 1px solid var(--b1);
          background: rgba(8,8,8,0.92); backdrop-filter: blur(16px);
          position: relative; z-index: 2;
        }
        .topbar::after { content: ''; position: absolute; bottom: -1px; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent, rgba(0,192,122,0.25), transparent); }
        .topbar-l { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }
        .topbar-r { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }

        .hamburger {
          width: 34px; height: 34px; border-radius: var(--r1); flex-shrink: 0;
          border: 1px solid var(--b1); background: transparent; color: var(--t2);
          cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s;
        }
        .hamburger:hover { background: var(--s3); border-color: var(--b2); color: var(--text); }

        .topbar-title {
          font-family: var(--mono); font-size: 0.72rem; color: var(--t2);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .topbar-title span { color: var(--green); }

        .model-pill {
          display: flex; align-items: center; gap: 5px; flex-shrink: 0;
          font-family: var(--mono); font-size: 0.58rem; color: var(--green);
          background: var(--gf); border: 1px solid rgba(0,192,122,0.15);
          border-radius: 20px; padding: 3px 9px;
        }
        .model-pill-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--green); box-shadow: 0 0 5px var(--green); flex-shrink: 0; }

        .chars-badge {
          font-family: var(--mono); font-size: 0.58rem; color: var(--t3);
          background: var(--s2); border: 1px solid var(--b1); border-radius: 20px; padding: 3px 9px;
        }
        .tb-btn {
          width: 34px; height: 34px; border-radius: var(--r1);
          border: 1px solid var(--b1); background: transparent; color: var(--t3);
          cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s;
        }
        .tb-btn:hover { background: rgba(255,71,87,0.08); border-color: rgba(255,71,87,0.25); color: var(--red); }

        /* ── MESSAGES ── */
        .msgs { flex: 1; overflow-y: auto; padding: 28px 24px 12px; display: flex; flex-direction: column; }
        .msgs::-webkit-scrollbar { width: 3px; }
        .msgs::-webkit-scrollbar-thumb { background: var(--s4); border-radius: 99px; }

        /* ── EMPTY ── */
        .empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 32px 16px; gap: 36px; text-align: center; }

        .empty-mark {
          width: 72px; height: 72px; position: relative;
          display: flex; align-items: center; justify-content: center;
        }
        .empty-mark-ring {
          position: absolute; inset: 0; border-radius: 50%;
          border: 1px solid rgba(0,192,122,0.25);
          animation: spin 12s linear infinite;
        }
        .empty-mark-ring::before {
          content: ''; position: absolute; top: -3px; left: 50%; transform: translateX(-50%);
          width: 6px; height: 6px; border-radius: 50%; background: var(--green); box-shadow: 0 0 10px var(--green);
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .empty-mark-ring2 {
          position: absolute; inset: 10px; border-radius: 50%;
          border: 1px dashed rgba(0,192,122,0.15);
          animation: spin 20s linear infinite reverse;
        }
        .empty-mark-core {
          width: 40px; height: 40px; border-radius: 50%;
          background: var(--green); display: flex; align-items: center; justify-content: center;
          font-family: var(--display); font-size: 1.1rem; font-weight: 700; color: #000;
          box-shadow: 0 0 30px rgba(0,192,122,0.5), 0 0 60px rgba(0,192,122,0.15);
          position: relative; z-index: 1;
        }

        .empty-head { display: flex; flex-direction: column; gap: 10px; }
        .empty-title {
          font-family: var(--display); font-size: clamp(1.6rem, 4vw, 2.2rem);
          font-weight: 600; color: var(--text); letter-spacing: 0.02em; line-height: 1.2;
        }
        .empty-title em { color: var(--green); font-style: normal; }
        .empty-sub { font-family: var(--mono); font-size: 0.7rem; color: var(--t3); line-height: 1.8; letter-spacing: 0.02em; }
        .empty-prompt-hint {
          font-family: var(--mono); font-size: 0.65rem; color: var(--t3); letter-spacing: 0.04em;
          display: flex; align-items: center; gap: 8px;
        }
        .empty-prompt-hint::before, .empty-prompt-hint::after { content: ''; flex: 1; max-width: 40px; height: 1px; background: var(--b2); }

        .sug-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; max-width: 500px; }
        .sug-card {
          background: var(--s1); border: 1px solid var(--b1); border-radius: var(--r2);
          padding: 14px 15px; cursor: pointer; text-align: left; transition: all 0.2s;
          font-family: var(--sans); position: relative; overflow: hidden; min-height: 44px;
        }
        .sug-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent, var(--b2), transparent); }
        .sug-card:hover { background: var(--s2); border-color: rgba(0,192,122,0.25); transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(0,192,122,0.08); }
        .sug-card:hover .sug-icon { color: var(--green); }
        .sug-card:active { transform: scale(0.98); }
        .sug-icon { font-family: var(--mono); font-size: 0.85rem; color: var(--t3); margin-bottom: 8px; transition: color 0.2s; }
        .sug-label { font-size: 0.78rem; font-weight: 600; color: var(--text); }
        .sug-sub { font-size: 0.65rem; color: var(--t3); margin-top: 3px; font-weight: 400; }

        /* ── DATE ── */
        .date-group { display: flex; flex-direction: column; margin-bottom: 4px; }
        .date-div {
          display: flex; align-items: center; gap: 10px; margin: 10px 0 16px;
          font-family: var(--mono); font-size: 0.57rem; text-transform: uppercase;
          letter-spacing: 0.12em; color: var(--t3);
        }
        .date-div::before, .date-div::after { content: ''; flex: 1; height: 1px; background: var(--b1); }

        /* ── ROWS ── */
        .row { display: flex; gap: 12px; margin-bottom: 20px; animation: rowIn 0.25s cubic-bezier(0.22,1,0.36,1) both; }
        @keyframes rowIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .row.user { flex-direction: row-reverse; }

        .av {
          width: 30px; height: 30px; border-radius: var(--r1); flex-shrink: 0; margin-top: 2px;
          display: flex; align-items: center; justify-content: center;
          font-family: var(--display); font-size: 0.75rem; font-weight: 600; position: relative;
        }
        .av.ai {
          background: var(--green); color: #000;
          box-shadow: 0 0 12px rgba(0,192,122,0.35);
        }
        .av.ai::after { content: ''; position: absolute; inset: -1px; border-radius: calc(var(--r1) + 1px); border: 1px solid rgba(0,192,122,0.4); }
        .av.you { background: var(--s3); color: var(--t2); border: 1px solid var(--b2); font-size: 0.65rem; }

        .msg-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
        .row.user .msg-body { align-items: flex-end; }

        .msg-meta { display: flex; align-items: center; gap: 7px; font-family: var(--mono); font-size: 0.58rem; color: var(--t3); }
        .row.user .msg-meta { flex-direction: row-reverse; }
        .msg-sender { color: var(--t2); font-weight: 500; }
        .row.assistant .msg-sender { color: var(--green); }

        /* ── BUBBLES ── */
        .bubble {
          max-width: min(76%, 640px); padding: 12px 16px;
          font-family: var(--sans); font-size: 0.875rem; line-height: 1.78; font-weight: 300;
          word-break: break-word; white-space: pre-wrap; position: relative;
        }
        .bubble.ai {
          background: var(--s1); color: var(--text);
          border-radius: 2px var(--r3) var(--r3) var(--r3);
          border: 1px solid var(--b1);
          box-shadow: 0 2px 16px rgba(0,0,0,0.4);
        }
        .bubble.ai::before {
          content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px;
          background: linear-gradient(90deg, var(--green), rgba(0,192,122,0.2), transparent);
          border-radius: 2px var(--r3) 0 0; opacity: 0.6;
        }
        .bubble.user {
          background: var(--s3); color: var(--text);
          border-radius: var(--r3) 2px var(--r3) var(--r3);
          border: 1px solid var(--b2);
          box-shadow: 0 2px 16px rgba(0,0,0,0.3);
        }
        .bubble.user::after {
          content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px;
          background: linear-gradient(90deg, transparent, var(--b3), transparent);
          border-radius: var(--r3) 2px 0 0;
        }

        .stream-cur::after { content: '█'; color: var(--green); animation: cur 0.5s steps(1) infinite; font-size: 0.8em; margin-left: 2px; opacity: 0.85; }
        @keyframes cur { 0%,100%{opacity:1} 50%{opacity:0} }

        /* ── ACTIONS ── */
        .msg-actions { display: flex; gap: 4px; opacity: 0; transition: opacity 0.15s; margin-top: 2px; }
        .row:hover .msg-actions { opacity: 1; }
        .act {
          height: 26px; padding: 0 9px; border-radius: var(--r1);
          border: 1px solid var(--b1); background: var(--s1); color: var(--t3);
          cursor: pointer; display: flex; align-items: center; gap: 4px;
          font-family: var(--mono); font-size: 0.6rem; font-weight: 500; transition: all 0.14s;
        }
        .act:hover { border-color: var(--b2); color: var(--text); background: var(--s2); }
        .act.liked { color: #FF6B81; border-color: rgba(255,107,129,0.25); background: rgba(255,107,129,0.06); }
        .act.copied { color: var(--green); border-color: rgba(0,192,122,0.25); background: var(--gf); }

        /* ── THINKING ── */
        .think-row { display: flex; gap: 12px; margin-bottom: 20px; }
        .think-bubble {
          background: var(--s1); border: 1px solid var(--b1);
          border-radius: 2px var(--r3) var(--r3) var(--r3);
          padding: 14px 18px; display: flex; gap: 5px; align-items: center;
          position: relative;
        }
        .think-bubble::before {
          content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px;
          background: linear-gradient(90deg, var(--green), rgba(0,192,122,0.2), transparent);
          opacity: 0.5; border-radius: 2px var(--r3) 0 0;
        }
        .td { width: 5px; height: 5px; border-radius: 50%; background: var(--green); }
        .td:nth-child(1) { animation: td 1.1s 0s infinite; }
        .td:nth-child(2) { animation: td 1.1s 0.18s infinite; }
        .td:nth-child(3) { animation: td 1.1s 0.36s infinite; }
        @keyframes td { 0%,80%,100%{transform:scale(0.4);opacity:0.15} 40%{transform:scale(1);opacity:1;box-shadow:0 0 6px var(--green)} }

        /* ── ERROR ── */
        .err-bar {
          display: flex; align-items: flex-start; gap: 10px; margin: 0 0 16px;
          padding: 11px 14px; background: rgba(255,71,87,0.06);
          border: 1px solid rgba(255,71,87,0.18); border-radius: var(--r1);
          font-family: var(--mono); font-size: 0.7rem; color: #FF6B81; line-height: 1.55;
        }
        .err-prefix { color: var(--red); font-weight: 700; flex-shrink: 0; }
        .err-msg { flex: 1; }
        .err-x { background: none; border: none; color: #FF6B81; cursor: pointer; font-size: 0.9rem; padding: 0; opacity: 0.6; transition: opacity 0.15s; flex-shrink: 0; }
        .err-x:hover { opacity: 1; }

        /* ── INPUT ── */
        .input-wrap {
          padding: 10px 24px 18px; border-top: 1px solid var(--b1); flex-shrink: 0; position: relative; z-index: 2;
        }
        .input-wrap::before { content: ''; position: absolute; top: -1px; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent, rgba(0,192,122,0.2), transparent); }

        .input-shell {
          max-width: 860px; margin: 0 auto; position: relative; border-radius: var(--r2); padding: 1.5px;
          background: var(--b1); transition: background 0.25s;
        }
        .input-shell.focused { background: linear-gradient(135deg, var(--green), rgba(0,192,122,0.4), var(--green)); background-size: 200%; animation: iglow 3s ease infinite; }
        @keyframes iglow { 0%,100%{background-position:0%} 50%{background-position:100%} }

        .input-inner { background: var(--s1); border-radius: calc(var(--r2) - 1.5px); overflow: hidden; }
        .input-row { display: flex; align-items: flex-end; padding: 12px 10px 10px 16px; gap: 8px; }
        textarea {
          flex: 1; border: none; outline: none; background: transparent; color: var(--text);
          font-family: var(--sans); font-size: 0.875rem; font-weight: 300; line-height: 1.65;
          resize: none; min-height: 44px; max-height: 180px;
        }
        textarea::placeholder { color: var(--t4); }
        textarea:disabled { opacity: 0.5; }

        .send {
          width: 38px; height: 38px; border-radius: var(--r1); border: none; cursor: pointer;
          background: var(--green); color: #000; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.18s; box-shadow: 0 0 14px rgba(0,192,122,0.35); position: relative; overflow: hidden;
        }
        .send::before { content: ''; position: absolute; inset: 0; background: linear-gradient(to bottom, rgba(255,255,255,0.15), transparent); }
        .send:hover:not(:disabled) { background: var(--green-hi); box-shadow: 0 0 22px rgba(0,192,122,0.55); transform: scale(1.05); }
        .send:active:not(:disabled) { transform: scale(0.96); }
        .send:disabled { background: var(--s4); color: var(--t3); cursor: not-allowed; box-shadow: none; transform: none; }
        .send svg { width: 16px; height: 16px; position: relative; }

        .input-foot { display: flex; align-items: center; justify-content: space-between; padding: 6px 16px 10px; border-top: 1px solid var(--b0); }
        .input-hint { font-family: var(--mono); font-size: 0.57rem; color: var(--t4); }
        .char-count { font-family: var(--mono); font-size: 0.57rem; color: var(--t4); }
        .char-count.warn { color: var(--red); }

        /* ── RESPONSIVE ── */
        @media (max-width: 767px) {
          .sidebar {
            position: fixed; top: 0; left: 0; bottom: 0; z-index: 11;
            width: ${sidebarOpen ? '260px' : '0px'} !important;
            box-shadow: ${sidebarOpen ? '4px 0 40px rgba(0,0,0,0.7)' : 'none'};
          }
          .topbar { padding: 0 12px; height: 48px; }
          .chars-badge { display: none; }
          .model-pill { max-width: 120px; overflow: hidden; white-space: nowrap; }
          .msgs { padding: 16px 12px 8px; }
          .empty { padding: 24px 12px; gap: 24px; }
          .sug-grid { max-width: 100%; }
          .sug-sub { display: none; }
          .sug-card { padding: 12px 12px; }
          .bubble { max-width: 90%; padding: 10px 13px; font-size: 0.845rem; }
          .av { width: 26px; height: 26px; }
          .row { gap: 8px; margin-bottom: 16px; }
          .msg-actions { opacity: 1; }
          .input-wrap { padding: 8px 12px 14px; }
          .input-hint { display: none; }
        }
        @media (min-width: 768px) and (max-width: 1023px) {
          .sidebar { width: ${sidebarOpen ? '240px' : '0px'}; }
          .sidebar-inner { width: 240px; }
          .msgs { padding: 20px 18px 8px; }
          .input-wrap { padding: 10px 18px 16px; }
          .bubble { max-width: 80%; }
        }
        @media (min-width: 1024px) {
          .msgs { padding: 28px 36px 12px; }
          .input-wrap { padding: 12px 36px 20px; }
        }
        @media (min-width: 1400px) {
          .msgs { padding: 32px 10% 12px; }
          .input-wrap { padding: 12px 10% 22px; }
        }
      `}</style>

      <div className="scanline"/>

      {isMobile && sidebarOpen && <div className="sb-backdrop" onClick={() => setSidebarOpen(false)}/>}

      <div className="layout">
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebar-inner">
            <div className="sb-head">
              <div className="sb-logo">
                <div className="sb-logo-mark">S</div>
                <span className="sb-logo-name">ShanelleAI</span>
                <span className="sb-logo-ver">v2</span>
              </div>
              <button className="new-chat" onClick={() => { setMessages([]); setInput(''); setApiError(''); if (isMobile) setSidebarOpen(false) }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                new_conversation()
              </button>
            </div>

            <div className="sb-label">// recent</div>
            <div className="sb-history">
              {HISTORY.map((item, i) => (
                <div
                  key={i}
                  className={`hist-item ${activeChat === item.label ? 'active' : ''}`}
                  onClick={() => {
                    setMessages([])
                    setInput('')
                    setApiError('')
                    setActiveChat(item.label)
                    if (isMobile) setSidebarOpen(false)
                    setTimeout(() => send(item.prompt), 80)
                  }}
                >
                  <div className="hist-dot"/>{item.label}
                </div>
              ))}
            </div>

            <div className="sb-footer">
              <div className="model-card">
                <div className="status-dot"/>
                <div className="model-info">
                  <div className="model-label">ShanelleAI</div>
                  <div className="model-id">{MODEL}</div>
                </div>
                <div className="model-badge">LIVE</div>
              </div>
            </div>
          </div>
        </aside>

        {/* Main */}
        <main className="main">
          {/* Topbar */}
          <div className="topbar">
            <div className="topbar-l">
              <button className="hamburger" onClick={() => setSidebarOpen(p => !p)} aria-label="Toggle sidebar">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
                </svg>
              </button>
              <span className="topbar-title">
                {empty ? '~ ShanelleAI' : <><span style={{color:'var(--t3)'}}>~/</span>{messages.length} message{messages.length !== 1 ? 's' : ''}</>}
              </span>
              <div className="model-pill">
                <div className="model-pill-dot"/>
                {MODEL}
              </div>
            </div>
            <div className="topbar-r">
              <div className="chars-badge">{messages.reduce((a, m) => a + m.text.length, 0).toLocaleString()} chars</div>
              <button className="tb-btn" title="Clear chat" onClick={() => { setMessages([]); setApiError('') }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Body */}
          {empty ? (
            <div className="empty">
              <div className="empty-mark">
                <div className="empty-mark-ring"/>
                <div className="empty-mark-ring2"/>
                <div className="empty-mark-core">S</div>
              </div>
              <div className="empty-head">
                <div className="empty-title">Hi, I'm <em>ShanelleAI</em></div>
                <div className="empty-sub">// your AI assistant · powered by {MODEL}</div>
              </div>
              <div className="empty-prompt-hint">quick start</div>
              <div className="sug-grid">
                {SUGGESTIONS.map(s => (
                  <button key={s.label} className="sug-card" onClick={() => send(s.label)}>
                    <div className="sug-icon">{s.icon}</div>
                    <div className="sug-label">{s.label}</div>
                    <div className="sug-sub">{s.sub}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="msgs">
              {grouped.map(group => (
                <div key={group.date} className="date-group">
                  <div className="date-div">{group.date}</div>
                  {group.msgs.map((msg, idx) => (
                    <div key={msg.id} className={`row ${msg.role}`} style={{ animationDelay: `${idx * 0.025}s` }}>
                      <div className={`av ${msg.role === 'assistant' ? 'ai' : 'you'}`}>
                        {msg.role === 'assistant' ? 'S' : 'U'}
                      </div>
                      <div className="msg-body">
                        <div className="msg-meta">
                          <span className="msg-sender">{msg.role === 'assistant' ? 'ShanelleAI' : 'you'}</span>
                          <span>{msg.time}</span>
                        </div>
                        <div className={`bubble ${msg.role === 'assistant' ? 'ai' : 'user'} ${
                          msg.role === 'assistant' && streaming && msg.displayText !== msg.text ? 'stream-cur' : ''
                        }`}>
                          {msg.displayText || msg.text}
                        </div>
                        {msg.role === 'assistant' && (
                          <div className="msg-actions">
                            <button className={`act ${msg.liked ? 'liked' : ''}`} onClick={() => toggleLike(msg.id)}>
                              {msg.liked ? '♥' : '♡'} {msg.liked ? 'liked' : 'like'}
                            </button>
                            <button className={`act ${msg.copied ? 'copied' : ''}`} onClick={() => copyMsg(msg.id, msg.text)}>
                              {msg.copied ? '✓ copied' : '⎘ copy'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ))}

              {apiError && (
                <div className="err-bar">
                  <span className="err-prefix">ERR</span>
                  <span className="err-msg">{apiError}</span>
                  <button className="err-x" onClick={() => setApiError('')}>✕</button>
                </div>
              )}

              {thinking && (
                <div className="think-row">
                  <div className="av ai">S</div>
                  <div className="msg-body">
                    <div className="msg-meta"><span className="msg-sender">ShanelleAI</span><span>now</span></div>
                    <div className="think-bubble">
                      <div className="td"/><div className="td"/><div className="td"/>
                    </div>
                  </div>
                </div>
              )}
              <div ref={bottomRef}/>
            </div>
          )}

          {/* Input */}
          <div className="input-wrap">
            <InputCard
              input={input}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onSend={() => send(input)}
              disabled={thinking || streaming}
              textareaRef={textareaRef}
            />
          </div>
        </main>
      </div>
    </>
  )
}

function InputCard({ input, onChange, onKeyDown, onSend, disabled, textareaRef }: {
  input: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onSend: () => void
  disabled: boolean
  textareaRef: React.RefObject<HTMLTextAreaElement>
}) {
  const [focused, setFocused] = useState(false)
  return (
    <div className={`input-shell ${focused ? 'focused' : ''}`}>
      <div className="input-inner">
        <div className="input-row">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="// ask anything..."
            rows={1}
            disabled={disabled}
          />
          <button className="send" onClick={onSend} disabled={!input.trim() || disabled} aria-label="Send">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
        <div className="input-foot">
          <span className="input-hint">↵ send · ⇧↵ newline</span>
          <span className={`char-count ${input.length > 900 ? 'warn' : ''}`}>{input.length}/1000</span>
        </div>
      </div>
    </div>
  )
}