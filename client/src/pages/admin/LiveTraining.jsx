// Admin "Live Training" — assign a real customer to an agent, then monitor the
// live chat. Before each customer message reaches the agent, the admin gets a
// configurable window to edit it (or accept an AI-suggested rewrite). Edits also
// become training examples. Both sides poll for real-time sync.
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { Card, Spinner, Button } from '../../components/ui';
import { TranslateMessage } from '../../components/Translate';
import { Attachment, AttachButton, StagedAttachment } from '../../components/Attachment';

export default function LiveTraining() {
  const [options, setOptions] = useState({ agents: [], customers: [] });
  const [agentId, setAgentId] = useState('');
  const [custId, setCustId] = useState('');
  const [sessions, setSessions] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [monitor, setMonitor] = useState(null);
  const [editText, setEditText] = useState('');
  const [file, setFile] = useState(null);   // file the admin attaches to the pending customer message
  const [holdSeconds, setHoldSeconds] = useState(15);
  const [sessionTimer, setSessionTimer] = useState(15);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [librarySearch, setLibrarySearch] = useState('');
  const [libraryLetter, setLibraryLetter] = useState('');
  const [library, setLibrary] = useState({ customers: [], total: 0, active: 0 });
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const lastOriginal = useRef('__none__');
  const lastTimerSession = useRef(null);
  const bottomRef = useRef(null);

  const loadOptions = () => api('/admin/supervised/options').then(setOptions).catch(console.error);
  const loadSessions = () => api('/admin/supervised').then(setSessions).catch(console.error);
  useEffect(() => {
    loadOptions();
    loadSessions();
    const t = setInterval(loadSessions, 3000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!libraryOpen) return;
    const t = setTimeout(() => {
      const params = new URLSearchParams({ q: librarySearch, letter: libraryLetter, limit: '60' });
      setLibraryBusy(true);
      api(`/admin/customer-library?${params}`).then(setLibrary).catch(console.error).finally(() => setLibraryBusy(false));
    }, 200);
    return () => clearTimeout(t);
  }, [libraryOpen, librarySearch, libraryLetter]);
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
        if (lastTimerSession.current !== m.session?.id) {
          lastTimerSession.current = m.session?.id;
          setSessionTimer(Number(m.session?.hold_seconds || 15));
        }
        const orig = m.pending?.original ?? null;
        if (orig !== lastOriginal.current) { lastOriginal.current = orig; setEditText(m.pending?.body || ''); setFile(m.pending?.upload || null); }
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
      const r = await api('/admin/supervised', { method: 'POST', body: {
        agent_id: agentId, real_chat_id: custId, hold_seconds: Number(holdSeconds),
      } });
      lastOriginal.current = '__none__';
      lastTimerSession.current = null;
      setOpenId(r.session_id); loadSessions();
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };

  const activateCustomer = async (customer) => {
    setLibraryBusy(true);
    try {
      await api(`/admin/customer-library/${customer.id}/activate`, { method: 'POST' });
      await loadOptions();
      setCustId(customer.id);
      setLibrary(current => ({
        ...current,
        active: current.active + (customer.is_available ? 0 : 1),
        customers: current.customers.map(item => item.id === customer.id ? { ...item, is_available: true } : item),
      }));
    } catch (e) { alert(e.message); }
    finally { setLibraryBusy(false); }
  };

  const deleteSession = async (id, e) => {
    e?.stopPropagation?.();
    if (!window.confirm('Delete this live session? It will be removed from the active list.')) return;
    try {
      await api(`/admin/supervised/${id}`, { method: 'DELETE' });
      if (openId === id) { setOpenId(null); setMonitor(null); }
      loadSessions();
    } catch (err) { alert(err.message); }
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
      await api(`/admin/supervised/${openId}/pending`, { method: 'PUT', body: { body: editText, attachment: file } });
      await api(`/admin/supervised/${openId}/release`, { method: 'POST' });
      lastOriginal.current = '__none__';
      setFile(null);
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };

  const setAutoSendState = async (enabled) => {
    if (!openId || busy) return;
    setBusy(true);
    try {
      if (enabled && monitor?.pending) {
        await api(`/admin/supervised/${openId}/pending`, { method: 'PUT', body: { body: editText, attachment: file } });
      }
      const result = await api(`/admin/supervised/${openId}/auto-send`, { method: 'PUT', body: { enabled } });
      setMonitor(current => current ? {
        ...current,
        session: { ...current.session, auto_send_enabled: enabled ? 1 : 0 },
        pending: result.pending,
      } : current);
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };

  const pauseForEdit = () => {
    if (monitor?.pending?.auto_send_enabled) setAutoSendState(false);
  };

  const saveTimer = async () => {
    if (!openId || busy) return;
    setBusy(true);
    try {
      const result = await api(`/admin/supervised/${openId}/timer`, {
        method: 'PUT', body: { hold_seconds: Number(sessionTimer) },
      });
      setSessionTimer(Number(result.hold_seconds));
      setMonitor(current => current ? {
        ...current,
        session: { ...current.session, hold_seconds: result.hold_seconds },
        pending: result.pending,
      } : current);
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };

  const pending = monitor?.pending;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-black text-slate-800">Live Training</h1>
        <p className="text-sm text-slate-500">Assign a real customer to an agent and watch live. Set the review timer, pause auto-send while editing, or use an AI suggestion before the message reaches the agent.</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Left: assign + session list */}
        <div className="space-y-4">
          <Card title="Assign a customer">
            <div className="space-y-2">
              <select value={agentId} onChange={e => setAgentId(e.target.value)} className="w-full min-w-0 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="">Choose agent…</option>
                {options.agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <select value={custId} onChange={e => setCustId(e.target.value)} className="w-full min-w-0 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="">Choose real customer…</option>
                {options.customers.map(c => <option key={c.id} value={c.id}>{c.name} — {c.intent}</option>)}
              </select>
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-slate-600 shrink-0" htmlFor="new-session-timer">Review timer</label>
                <input id="new-session-timer" type="number" min="3" max="300" value={holdSeconds}
                  onChange={e => setHoldSeconds(e.target.value)}
                  className="w-20 border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white" />
                <span className="text-xs text-slate-400">seconds</span>
              </div>
              <Button onClick={start} disabled={busy || !agentId || !custId}>Start live session</Button>
              <button type="button" onClick={() => setLibraryOpen(value => !value)}
                className="w-full rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-left text-xs font-bold text-violet-700 hover:bg-violet-100">
                {libraryOpen ? 'Hide customer library' : '＋ Search & add more customers'}
              </button>

              {libraryOpen && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <input value={librarySearch} onChange={e => setLibrarySearch(e.target.value)}
                      placeholder="Search customer name…" aria-label="Search customer name"
                      className="min-w-0 flex-1 border border-slate-300 rounded-lg px-2.5 py-2 text-xs bg-white" />
                    <span className="text-[10px] text-slate-500 whitespace-nowrap">{library.active}/{library.total} added</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <button type="button" onClick={() => setLibraryLetter('')}
                      className={`rounded px-1.5 py-1 text-[10px] font-bold ${!libraryLetter ? 'bg-violet-700 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}>All</button>
                    {Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index)).map(letter => (
                      <button type="button" key={letter} onClick={() => setLibraryLetter(letter)}
                        className={`rounded px-1.5 py-1 text-[10px] font-bold ${libraryLetter === letter ? 'bg-violet-700 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}>{letter}</button>
                    ))}
                  </div>
                  <div className="max-h-72 overflow-y-auto space-y-1.5">
                    {libraryBusy && <div className="py-3 flex justify-center"><Spinner /></div>}
                    {!libraryBusy && library.customers.length === 0 && <p className="py-3 text-center text-xs text-slate-400">No customers found.</p>}
                    {!libraryBusy && library.customers.map(customer => (
                      <div key={customer.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2">
                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-slate-100">
                          {customer.thumbnail_url
                            ? <img src={customer.thumbnail_url} alt="" className="h-full w-full object-cover" />
                            : <div className="flex h-full items-center justify-center text-sm font-black text-slate-400">{customer.name.slice(0, 1).toUpperCase()}</div>}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-bold text-slate-700">{customer.name}</p>
                          <p className="truncate text-[10px] text-slate-400">{customer.intent} · {customer.message_count || 0} messages · {customer.artwork_count || 0} images</p>
                        </div>
                        {customer.is_available
                          ? <span className="shrink-0 text-[10px] font-bold text-emerald-600">Added ✓</span>
                          : <button type="button" disabled={libraryBusy} onClick={() => activateCustomer(customer)}
                              className="shrink-0 rounded-md bg-violet-700 px-2 py-1.5 text-[10px] font-bold text-white hover:bg-violet-800">Add</button>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>

          <Card title={`Active sessions (${sessions.length})`}>
            <div className="space-y-1.5">
              {sessions.length === 0 && <p className="text-xs text-slate-400">No live sessions.</p>}
              {sessions.map(s => (
                <div key={s.id}
                  className={`flex items-center gap-1 rounded-lg border ${openId === s.id ? 'border-violet-400 bg-violet-50' : 'border-slate-200'}`}>
                  <button onClick={() => { lastOriginal.current = '__none__'; lastTimerSession.current = null; setOpenId(s.id); }}
                    className="min-w-0 flex-1 flex items-center justify-between gap-2 rounded-l-lg px-3 py-2 text-left text-sm hover:bg-slate-50">
                    <span className="min-w-0 truncate"><b>{s.agent_name}</b> <span className="text-slate-400">·</span> {s.customer_name}</span>
                    {s.has_pending ? <span className="shrink-0 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 animate-pulse">Review</span> : <span className="shrink-0 text-[10px] text-slate-400">live</span>}
                  </button>
                  <button onClick={(e) => deleteSession(s.id, e)} title="Delete session" aria-label="Delete session"
                    className="shrink-0 px-2.5 py-2 text-slate-400 hover:text-rose-600">✕</button>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Right: monitor */}
        <div className="lg:col-span-2">
          {!openId ? (
            <Card><p className="text-sm text-slate-500">Start or pick a live session to monitor it here.</p></Card>
          ) : !monitor ? <Spinner /> : (
            <div className="flex flex-col h-[70vh] lg:h-[calc(100vh-13rem)]">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-slate-500">
                <span>Monitoring: <span className="text-violet-600">{monitor.session?.agent_name}</span> ↔ {monitor.session?.customer_name} · {monitor.session?.status}</span>
                <span className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1">
                  <label htmlFor="session-timer">Timer</label>
                  <input id="session-timer" type="number" min="3" max="300" value={sessionTimer}
                    onChange={e => setSessionTimer(e.target.value)}
                    className="w-16 rounded border border-slate-300 px-1.5 py-1 text-xs" />
                  <span className="text-slate-400">sec</span>
                  <button type="button" onClick={saveTimer} disabled={busy}
                    className="rounded bg-slate-800 px-2 py-1 text-[10px] font-bold text-white disabled:opacity-50">Set</button>
                </span>
              </div>
              <div className="flex-1 overflow-y-auto bg-white rounded-lg border border-slate-200 p-4 space-y-3">
                {monitor.messages.map(m => (
                  <div key={m.id} className={`flex ${m.role === 'intern' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${m.role === 'intern' ? 'bg-violet-700 text-white rounded-br-sm' : 'bg-slate-100 text-slate-800 rounded-bl-sm'}`}>
                      {m.body}
                      <Attachment url={m.attachment_url} name={m.attachment_name} mime={m.attachment_mime} />
                      <span className="block mt-0.5 text-[10px] uppercase opacity-60">
                        {m.role === 'intern' ? 'Agent' : 'Customer'}
                        {m.role === 'customer' && <TranslateMessage path={`/admin/messages/${m.id}/translate`} className="ml-2" />}
                      </span>
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
                    <button type="button" disabled={busy} onClick={() => setAutoSendState(!pending.auto_send_enabled)}
                      className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase disabled:opacity-50 ${pending.auto_send_enabled ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-white'}`}>
                      {pending.auto_send_enabled ? `Auto-send ON · ${pending.seconds_left}s` : `Timer paused · ${pending.seconds_left}s left`}
                    </button>
                  </div>
                  {pending.attachment_url && <a href={pending.attachment_url} target="_blank" rel="noreferrer" className="mb-2 block overflow-hidden rounded-lg border border-amber-200 bg-white max-w-[220px]"><img src={pending.attachment_url} alt="customer artwork" className="max-h-40 w-full object-contain bg-white" /></a>}
                  {pending.original && <p className="text-[11px] text-slate-500 mb-1">Original: “{pending.original}”</p>}
                  <textarea value={editText} onFocus={pauseForEdit} onChange={e => setEditText(e.target.value)} rows={2}
                    className="w-full border border-amber-300 rounded-lg px-3 py-2 text-sm bg-white" />
                  <StagedAttachment file={file} onClear={() => setFile(null)} />
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <AttachButton onPick={f => { pauseForEdit(); setFile(f); }} disabled={busy}
                      title="Attach an image, PDF or document to this customer message" />
                    <Button onClick={sendNow} disabled={busy}>Send to agent now</Button>
                    <Button variant="secondary" onClick={suggest} disabled={busy}>✨ AI suggestion</Button>
                    <span className="self-center text-[11px] text-slate-500">
                      {pending.auto_send_enabled
                        ? `Auto-sends in ${pending.seconds_left}s. Click the message to pause while editing.`
                        : 'Timer is paused. Turn auto-send back on to resume with your edited message.'} Edits train the AI.
                    </span>
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
