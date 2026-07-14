// Admin "Manual Chat" — a fully manual, two-sided chat. No AI, no replay: the
// admin types every message themselves and picks who is speaking (Customer or
// Agent). Useful to hand-craft example conversations or demo a flow.
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { Card, Spinner, Button } from '../../components/ui';

export default function ManualChat() {
  const [name, setName] = useState('');
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [role, setRole] = useState('customer');   // who the next message is from
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const start = async () => {
    setBusy(true);
    try {
      const r = await api('/admin/manual-sessions', { method: 'POST', body: { name: name.trim() } });
      setSession(r); setMessages(r.messages || []);
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };

  const send = async (e) => {
    e?.preventDefault?.();
    const body = input.trim();
    if (!body || busy || !session) return;
    setInput('');
    setBusy(true);
    try {
      const r = await api(`/admin/manual-sessions/${session.session_id}/messages`, { method: 'POST', body: { role, body } });
      setMessages(r.messages);
    } catch (e2) { alert(e2.message); }
    finally { setBusy(false); }
  };

  // Enter sends, Shift+Enter = new line.
  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e); } };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-black text-slate-800">Manual Chat</h1>
        <p className="text-sm text-slate-500">A fully manual, two-sided chat — no AI, no replay. You type every message yourself and choose who is speaking. Great for hand-crafting an example conversation.</p>
      </div>

      {!session ? (
        <Card>
          <div className="max-w-md space-y-3">
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">Chat name (optional)</span>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. George Rogers — bulk order"
                className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white" />
            </label>
            <Button onClick={start} disabled={busy}>{busy ? 'Starting…' : 'Start manual chat'}</Button>
          </div>
        </Card>
      ) : (
        <div className="flex flex-col h-[calc(100vh-12rem)] max-w-3xl">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-slate-500">Manual chat{session.name ? ` — ${session.name}` : ''}</p>
            <Button variant="secondary" onClick={() => { setSession(null); setMessages([]); setName(''); }}>New chat</Button>
          </div>

          <div className="flex-1 overflow-y-auto bg-white rounded-lg border border-slate-200 p-4 space-y-3">
            {messages.length === 0 && <p className="text-xs text-slate-400">No messages yet. Pick who is speaking below, type, and press Enter.</p>}
            {messages.map((m, i) => (
              <div key={m.id || i} className={`flex ${m.role === 'intern' ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-[80%]">
                  <div className={`rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${m.role === 'intern' ? 'bg-violet-700 text-white rounded-br-sm' : 'bg-slate-100 text-slate-800 rounded-bl-sm'}`}>
                    {m.body}
                    {m.attachment_url && <a href={m.attachment_url} target="_blank" rel="noreferrer" className="mt-2 block overflow-hidden rounded-lg border border-slate-200 bg-white"><img src={m.attachment_url} alt="artwork" className="max-h-44 w-full object-contain bg-slate-50" /></a>}
                  </div>
                  <p className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-400">{m.role === 'intern' ? 'Agent' : 'Customer'}</p>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <div className="mt-3 space-y-2">
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
              <button type="button" onClick={() => setRole('customer')}
                className={`px-3 py-1 rounded-md text-xs font-semibold ${role === 'customer' ? 'bg-slate-700 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Send as Customer</button>
              <button type="button" onClick={() => setRole('intern')}
                className={`px-3 py-1 rounded-md text-xs font-semibold ${role === 'intern' ? 'bg-violet-700 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Send as Agent</button>
            </div>
            <form onSubmit={send} className="flex gap-2 items-end">
              <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKey} disabled={busy} autoFocus rows={1}
                placeholder={`Type the ${role === 'intern' ? 'agent' : 'customer'} message…  (Enter to send, Shift+Enter for new line)`}
                className="flex-1 resize-none border border-slate-300 rounded-lg px-4 py-2.5 text-sm bg-white" />
              <Button disabled={busy || !input.trim()}>Send</Button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
