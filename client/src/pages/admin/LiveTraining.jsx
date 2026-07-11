// Admin "Live Training" — assign a real customer to an agent, then monitor the
// live chat. Before each customer message reaches the agent, the admin gets a
// 15-second window to edit it (or accept an AI-suggested rewrite). Edits also
// become training examples. Both sides poll for real-time sync.
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { Card, Spinner, Button } from '../../components/ui';

export default function LiveTraining() {
  const [options, setOptions] = useState({ agents: [], customers: [] });
  const [agentId, setAgentId] = useState('');
  const [custId, setCustId] = useState('');
  const [sessions, setSessions] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [monitor, setMonitor] = useState(null);
  const [editText, setEditText] = useState('');
  const [busy, setBusy] = useState(false);
  const lastOriginal = useRef('__none__');
  const bottomRef = useRef(null);

  const loadSessions = () => api('/admin/supervised').then(setSessions).catch(console.error);
  useEffect(() => {
    api('/admin/supervised/options').then(setOptions).catch(console.error);
    loadSessions();
    const t = setInterval(loadSessions, 3000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [monitor?.messages?.length]);

  // Poll the open session for live updates + the countdown.
  useEffect(() => {
    if (!openId) return;
    let alive = true;
    const tick = async () => {
      try {
        const m = await api(`/admin/supervised/${openId}`);
        if (!alive) return;
        setMonitor(m);
        const orig = m.pending?.original ?? null;
        if (orig !== lastOriginal.current) { lastOriginal.current = orig; setEditText(m.pending?.body || ''); }
      } catch { /* session may have ended */ }
    };
    tick();
    const t = setInterval(tick, 1500);
    return () => { alive = false; clearInterval(t); };
  }, [openId]);

  const start = async () => {
    if (!agentId || !custId) return;
    setBusy(true);
    try {
      const r = await api('/admin/supervised', { method: 'POST', body: { agent_id: agentId, real_chat_id: custId } });
      lastOriginal.current = '__none__';
      setOpenId(r.session_id); loadSessions();
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };

  const suggest = async () => {
    setBusy(true);
    try { const r = await api(`/admin/supervised/${openId}/suggest`, { method: 'POST' }); if (r.suggestion) setEditText(r.suggestion); }
    catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };
  const sendNow = async () => {
    setBusy(true);
    try {
      await api(`/admin/supervised/${openId}/pending`, { method: 'PUT', body: { body: editText } });
      await api(`/admin/supervised/${openId}/release`, { method: 'POST' });
      lastOriginal.current = '__none__';
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };

  const pending = monitor?.pending;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-black text-slate-800">Live Training</h1>
        <p className="text-sm text-slate-500">Assign a real customer to an agent and watch live. You get 15 seconds to edit each customer message (or use the AI suggestion) before it reaches the agent — your edits also train the AI.</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Left: assign + session list */}
        <div className="space-y-4">
          <Card title="Assign a customer">
            <div className="space-y-2">
              <select value={agentId} onChange={e => setAgentId(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="">Choose agent…</option>
                {options.agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <select value={custId} onChange={e => setCustId(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="">Choose real customer…</option>
                {options.customers.map(c => <option key={c.id} value={c.id}>{c.name} — {c.intent}</option>)}
              </select>
              <Button onClick={start} disabled={busy || !agentId || !custId}>Start live session</Button>
            </div>
          </Card>

          <Card title={`Active sessions (${sessions.length})`}>
            <div className="space-y-1.5">
              {sessions.length === 0 && <p className="text-xs text-slate-400">No live sessions.</p>}
              {sessions.map(s => (
                <button key={s.id} onClick={() => { lastOriginal.current = '__none__'; setOpenId(s.id); }}
                  className={`w-full flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm ${openId === s.id ? 'border-violet-400 bg-violet-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <span className="min-w-0 truncate"><b>{s.agent_name}</b> <span className="text-slate-400">·</span> {s.customer_name}</span>
                  {s.has_pending ? <span className="shrink-0 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 animate-pulse">Review</span> : <span className="shrink-0 text-[10px] text-slate-400">live</span>}
                </button>
              ))}
            </div>
          </Card>
        </div>

        {/* Right: monitor */}
        <div className="lg:col-span-2">
          {!openId ? (
            <Card><p className="text-sm text-slate-500">Start or pick a live session to monitor it here.</p></Card>
          ) : !monitor ? <Spinner /> : (
            <div className="flex flex-col h-[calc(100vh-13rem)]">
              <div className="mb-2 text-xs font-semibold text-slate-500">Monitoring: <span className="text-violet-600">{monitor.session?.agent_name}</span> ↔ {monitor.session?.customer_name} · {monitor.session?.status}</div>
              <div className="flex-1 overflow-y-auto bg-white rounded-lg border border-slate-200 p-4 space-y-3">
                {monitor.messages.map(m => (
                  <div key={m.id} className={`flex ${m.role === 'intern' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${m.role === 'intern' ? 'bg-violet-700 text-white rounded-br-sm' : 'bg-slate-100 text-slate-800 rounded-bl-sm'}`}>
                      {m.body}
                      {m.attachment_url && <a href={m.attachment_url} target="_blank" rel="noreferrer" className="mt-2 block overflow-hidden rounded-lg border border-slate-200 bg-white"><img src={m.attachment_url} alt="artwork" className="max-h-40 w-full object-contain bg-slate-50" /></a>}
                      <span className="block mt-0.5 text-[10px] uppercase opacity-60">{m.role === 'intern' ? 'Agent' : 'Customer'}</span>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>

              {/* Pending review panel */}
              {pending ? (
                <div className="mt-3 rounded-lg border-2 border-amber-300 bg-amber-50 p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold uppercase text-amber-700">Next customer message — review before it reaches the agent</span>
                    <span className="text-xs font-bold tabular-nums text-amber-700">auto-send in {pending.seconds_left}s</span>
                  </div>
                  {pending.attachment_url && <a href={pending.attachment_url} target="_blank" rel="noreferrer" className="mb-2 block overflow-hidden rounded-lg border border-amber-200 bg-white max-w-[220px]"><img src={pending.attachment_url} alt="customer artwork" className="max-h-40 w-full object-contain bg-white" /></a>}
                  {pending.original && <p className="text-[11px] text-slate-500 mb-1">Original: “{pending.original}”</p>}
                  <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={2}
                    className="w-full border border-amber-300 rounded-lg px-3 py-2 text-sm bg-white" />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button onClick={sendNow} disabled={busy}>Send to agent now</Button>
                    <Button variant="secondary" onClick={suggest} disabled={busy}>✨ AI suggestion</Button>
                    <span className="self-center text-[11px] text-slate-500">Edit &amp; send, or it auto-sends in {pending.seconds_left}s. Edits train the AI.</span>
                  </div>
                </div>
              ) : (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  {monitor.session?.status === 'ended' ? 'Chat ended.' : 'Waiting for the agent to reply…'}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
