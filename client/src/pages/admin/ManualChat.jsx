// Admin "Trainer Chat" — a fully manual, live chat with a real trainee. You
// invite a Decoinks agent, they accept on their Practice page, then the two of
// you message each other in real time (you play the customer, they reply as the
// agent). No AI, no replay. A reply timer you set puts the trainee under
// pressure: after you send a message they must reply before the countdown ends,
// and late replies are flagged in the transcript.
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { Card, Button } from '../../components/ui';
import { TranslateMessage, TranslateReply } from '../../components/Translate';
import { Attachment, AttachButton, StagedAttachment } from '../../components/Attachment';

export default function ManualChat() {
  const [agents, setAgents] = useState([]);
  const [agentId, setAgentId] = useState('');
  const [name, setName] = useState('');
  const [replySeconds, setReplySeconds] = useState(60);   // timer for a new chat
  const [sessions, setSessions] = useState([]);           // this admin's open live chats
  const [live, setLive] = useState(null);                 // active live session detail
  const [input, setInput] = useState('');
  const [file, setFile] = useState(null);        // staged attachment
  const [timerInput, setTimerInput] = useState(60);       // editable timer in the live view
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef(null);
  const timerSeeded = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [live?.messages?.length]);

  const loadSessions = () => api('/admin/live-manual').then(setSessions).catch(() => {});
  useEffect(() => {
    api('/admin/live-manual/agents').then(setAgents).catch(() => {});
    loadSessions();
  }, []);
  useEffect(() => {
    if (live) return;
    const t = setInterval(loadSessions, 4000);
    return () => clearInterval(t);
  }, [!!live]);

  // While in a live session, poll so the trainee's messages + countdown update.
  useEffect(() => {
    if (!live) return;
    let alive = true;
    const tick = async () => {
      try { const r = await api(`/admin/live-manual/${live.session_id}`); if (alive) setLive(r); }
      catch { /* session may have ended */ }
    };
    const t = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [live?.session_id]);

  // Seed the editable timer input once per session opened.
  useEffect(() => {
    if (live && timerSeeded.current !== live.session_id) {
      timerSeeded.current = live.session_id;
      setTimerInput(Number(live.reply_seconds || 60));
    }
  }, [live?.session_id, live?.reply_seconds]);

  const start = async () => {
    if (!agentId) return;
    setBusy(true);
    try {
      const r = await api('/admin/live-manual', { method: 'POST', body: { agent_id: agentId, name: name.trim(), reply_seconds: Number(replySeconds) } });
      timerSeeded.current = null;
      setLive({ ...r, agent_name: agents.find(a => a.id === agentId)?.name });
      loadSessions();
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };
  const openLive = async (id) => {
    setBusy(true);
    try { timerSeeded.current = null; setLive(await api(`/admin/live-manual/${id}`)); }
    catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };
  const send = async (e) => {
    e?.preventDefault?.();
    const body = input.trim();
    if ((!body && !file) || busy || !live) return;
    const sending = file;
    setInput(''); setFile(null);
    setLive(cur => cur ? { ...cur, messages: [...(cur.messages || []), { id: 'tmp', role: 'customer', body, attachment_url: sending?.url, attachment_name: sending?.name, attachment_mime: sending?.mime }] } : cur);
    setBusy(true);
    try {
      const r = await api(`/admin/live-manual/${live.session_id}/messages`, { method: 'POST', body: { body, attachment: sending } });
      setLive(cur => cur ? { ...cur, ...r } : cur);
    } catch (e2) { alert(e2.message); }
    finally { setBusy(false); }
  };
  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e); } };
  const saveTimer = async () => {
    if (!live || busy) return;
    setBusy(true);
    try {
      const r = await api(`/admin/live-manual/${live.session_id}/timer`, { method: 'PUT', body: { reply_seconds: Number(timerInput) } });
      setTimerInput(Number(r.reply_seconds));
      setLive(cur => cur ? { ...cur, ...r } : cur);
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };
  const endLive = async () => {
    if (!live) return;
    setBusy(true);
    try {
      await api(`/admin/live-manual/${live.session_id}/end`, { method: 'POST' });
      setLive(null); setInput(''); loadSessions();
    }
    catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };
  const deleteSession = async (id, e) => {
    e?.stopPropagation?.();
    if (!window.confirm('Delete this chat permanently? All its messages will be removed.')) return;
    try {
      await api(`/admin/live-manual/${id}`, { method: 'DELETE' });
      if (live?.session_id === id) { setLive(null); setInput(''); }
      loadSessions();
    } catch (err) { alert(err.message); }
  };

  const header = (
    <div>
      <h1 className="text-2xl font-black text-slate-800">Trainer Chat</h1>
      <p className="text-sm text-slate-500">Chat live with a real trainee — fully manual, no AI. Invite a Decoinks agent; once they accept, you message each other in real time. You play the customer, they reply as the agent within the reply timer you set.</p>
    </div>
  );

  // ===== Live session view =====
  if (live) {
    const waiting = live.status === 'invited';
    const ended = live.status === 'ended';
    const turn = live.turn || {};
    return (
      <div className="space-y-4">
        {header}
        <div className="flex flex-col h-[70vh] lg:h-[calc(100vh-11rem)] max-w-3xl">
          <div className="flex flex-wrap items-center justify-between mb-2 gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-slate-700">{live.name || `Live chat with ${live.agent_name}`}</p>
              <p className="text-xs">
                {ended ? <span className="text-slate-400">Chat ended.</span>
                  : waiting ? <span className="text-amber-600 font-semibold">Waiting for {live.agent_name} to accept the invite…</span>
                  : <span className="text-emerald-600 font-semibold">🟢 Live — {live.agent_name} joined. You are the customer.</span>}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {!ended && !waiting && (
                <span className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-500">
                  <label htmlFor="reply-timer">Reply timer</label>
                  <input id="reply-timer" type="number" min="5" max="600" value={timerInput}
                    onChange={e => setTimerInput(e.target.value)} className="w-16 rounded border border-slate-300 px-1.5 py-1 text-xs" />
                  <span className="text-slate-400">sec</span>
                  <button type="button" onClick={saveTimer} disabled={busy} className="rounded bg-slate-800 px-2 py-1 text-[10px] font-bold text-white disabled:opacity-50">Set</button>
                </span>
              )}
              <Button variant="secondary" onClick={() => { setLive(null); setInput(''); loadSessions(); }}>Back</Button>
              {!ended && <Button variant="danger" onClick={endLive} disabled={busy}>End chat</Button>}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto bg-white rounded-lg border border-slate-200 p-4 space-y-3">
            {(live.messages || []).length === 0 && (
              <p className="text-xs text-slate-400">{waiting ? 'The chat will unlock after the trainee accepts the invite.' : 'No messages yet. Type below as the customer.'}</p>
            )}
            {(live.messages || []).map((m, i) => (
              <div key={m.id || i} className={`flex ${m.role === 'customer' ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-[80%]">
                  <div className={`rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${m.role === 'customer' ? 'bg-violet-700 text-white rounded-br-sm' : 'bg-slate-100 text-slate-800 rounded-bl-sm'}`}>
                    {m.body}
                    <Attachment url={m.attachment_url} name={m.attachment_name} mime={m.attachment_mime} />
                  </div>
                  <p className={`mt-0.5 text-[10px] uppercase tracking-wide ${m.role === 'customer' ? 'text-right text-slate-400' : 'text-slate-400'}`}>
                    {m.role === 'customer' ? 'You (customer)' : live.agent_name || 'Trainee'}
                    {m.role === 'intern' && m.reply_took != null && (
                      <span className={m.late ? 'text-rose-600 font-bold' : 'text-emerald-600 font-bold'}> · {m.late ? `⏰ late (${m.reply_took}s)` : `replied in ${m.reply_took}s`}</span>
                    )}
                    {m.role === 'intern' && m.id && m.id !== 'tmp' && (
                      <TranslateMessage path={`/admin/messages/${m.id}/translate`} className="ml-2" />
                    )}
                  </p>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {!ended && turn.waiting_for_trainee && (
            <div className={`mt-2 rounded-lg border px-3 py-2 text-xs font-semibold ${turn.expired ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
              {turn.expired
                ? <>⏰ {live.agent_name} is out of time — still waiting for a reply.</>
                : <>⏳ Waiting for {live.agent_name} to reply — <span className="tabular-nums">{turn.seconds_left}s</span> left.</>}
            </div>
          )}

          {!ended && !waiting && (
            <div className="mt-3">
              <StagedAttachment file={file} onClear={() => setFile(null)} />
            <form onSubmit={send} className="flex gap-2 items-end">
              <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKey} disabled={busy} autoFocus rows={1}
                placeholder="Type the customer message…  (Enter to send, Shift+Enter for new line)"
                className="flex-1 resize-none border border-slate-300 rounded-lg px-4 py-2.5 text-sm bg-white" />
              <AttachButton onPick={setFile} disabled={busy} />
              <TranslateReply path="/admin/translate" text={input} onResult={setInput} disabled={busy} />
              <Button disabled={busy || (!input.trim() && !file)}>Send</Button>
            </form>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ===== Start screen: invite a trainee =====
  return (
    <div className="space-y-4">
      {header}
      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Invite a trainee to a live chat">
          <div className="max-w-md space-y-3">
            <p className="text-sm text-slate-500">Pick a Decoinks agent and start a live chat. They get an invite on their Practice page under “Trainer chat”. Once they accept, you message each other in real time. Fully manual — no AI.</p>
            <select value={agentId} onChange={e => setAgentId(e.target.value)} className="w-full min-w-0 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
              <option value="">Choose a trainee…</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <label className="block">
              <span className="text-xs font-semibold text-slate-500">Chat name (optional)</span>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Bulk hoodies roleplay"
                className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white" />
            </label>
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-600 shrink-0" htmlFor="new-reply-timer">Reply timer</label>
              <input id="new-reply-timer" type="number" min="5" max="600" value={replySeconds}
                onChange={e => setReplySeconds(e.target.value)} className="w-20 border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white" />
              <span className="text-xs text-slate-400">seconds — how long the trainee gets to reply</span>
            </div>
            <Button onClick={start} disabled={busy || !agentId}>{busy ? 'Starting…' : 'Invite & start live chat'}</Button>
          </div>
        </Card>

        <Card title={`Your chats (${sessions.length})`}>
          <div className="space-y-1.5">
            {sessions.length === 0 && <p className="text-xs text-slate-400">No chats yet. Invite a trainee to start one.</p>}
            {sessions.map(s => (
              <div key={s.id} className="flex items-center gap-1 rounded-lg border border-slate-200">
                <button onClick={() => openLive(s.id)}
                  className="min-w-0 flex-1 flex items-center justify-between gap-2 rounded-l-lg px-3 py-2 text-left text-sm hover:bg-slate-50">
                  <span className="min-w-0 truncate"><b>{s.agent_name}</b> <span className="text-slate-400">·</span> {s.name} <span className="text-slate-400">· {s.message_count} msgs</span></span>
                  {s.status === 'invited'
                    ? <span className="shrink-0 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Invited</span>
                    : s.status === 'ended'
                      ? <span className="shrink-0 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">Ended</span>
                      : <span className="shrink-0 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">Live</span>}
                </button>
                {s.status !== 'active' && (
                  <button onClick={(e) => deleteSession(s.id, e)} title="Delete chat" aria-label="Delete chat"
                    className="shrink-0 px-2.5 py-2 text-slate-400 hover:text-rose-600">✕</button>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
