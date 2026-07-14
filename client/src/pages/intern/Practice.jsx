// Practice Chat — AI personas plus transcript-based real customer replay.
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { Card, Spinner, Button, ScoreBadge } from '../../components/ui';
import Evaluation from '../../components/Evaluation';

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function Practice() {
  const [personas, setPersonas] = useState([]);
  const [realChats, setRealChats] = useState([]);
  const [supervisedList, setSupervisedList] = useState([]);
  const [liveManualList, setLiveManualList] = useState([]);
  const [assignedChats, setAssignedChats] = useState([]);
  const [replyLeft, setReplyLeft] = useState(null);   // trainee's live-manual reply countdown (null = not their turn)
  const [customerTyping, setCustomerTyping] = useState(false);
  const [tab, setTab] = useState('real');
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [awaitingNext, setAwaitingNext] = useState(false);
  const [completedScorecard, setCompletedScorecard] = useState(null);
  const [scorecard, setScorecard] = useState(null);
  const bottomRef = useRef(null);
  const nextTimerRef = useRef(null);
  const [countdown, setCountdown] = useState(0);
  const [paused, setPaused] = useState(false);

  // Enter sends, Shift+Enter makes a new line.
  const onEnter = (submit) => (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(e); } };
  const clearNextTimer = () => { if (nextTimerRef.current) { clearInterval(nextTimerRef.current); nextTimerRef.current = null; } setCountdown(0); setPaused(false); };

  useEffect(() => {
    Promise.all([
      api('/practice/personas'),
      api('/practice/real-chats'),
    ]).then(([p, c]) => { setPersonas(p); setRealChats(c); }).catch(console.error);
  }, []);

  // Poll for live (supervised) sessions an admin assigned to this agent — acts as a notification.
  useEffect(() => {
    const load = () => api('/practice/supervised').then(setSupervisedList).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  // Poll for live manual chats a trainer invited this agent to — acts as a notification.
  useEffect(() => {
    const load = () => api('/practice/live-manual').then(setLiveManualList).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  // Poll for chats an admin assigned to this agent.
  const loadAssigned = () => api('/practice/assigned-chats').then(setAssignedChats).catch(() => {});
  useEffect(() => {
    loadAssigned();
    const t = setInterval(loadAssigned, 6000);
    return () => clearInterval(t);
  }, []);

  // While in a live manual chat, poll so the trainer's messages + reply countdown update.
  useEffect(() => {
    if (session?.mode !== 'live_manual' || session.status === 'ended') return;
    let alive = true;
    const tick = async () => {
      try {
        const r = await api(`/practice/live-manual/${session.session_id}`);
        if (!alive) return;
        setMessages(r.messages);
        setReplyLeft(r.turn?.waiting_for_trainee ? r.turn.seconds_left : null);
        if (r.status === 'ended') { setSession(cur => cur ? { ...cur, status: 'ended' } : cur); setReplyLeft(null); }
      } catch (e) {
        if (alive && e.status === 404) {
          setSession(cur => cur ? { ...cur, status: 'ended', deleted: true } : cur);
          setReplyLeft(null);
        }
      }
    };
    const t = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [session?.mode, session?.session_id, session?.status]);

  // Smooth per-second countdown between the 2s polls.
  useEffect(() => {
    if (session?.mode !== 'live_manual' || replyLeft == null) return;
    const t = setInterval(() => setReplyLeft(v => (v == null ? null : Math.max(0, v - 1))), 1000);
    return () => clearInterval(t);
  }, [session?.mode, session?.session_id, replyLeft == null]);

  // While in a live session, poll so admin-released customer messages appear.
  useEffect(() => {
    if (session?.mode !== 'supervised' || session.status === 'ended') return;
    let alive = true;
    const tick = async () => {
      try {
        const r = await api(`/practice/supervised/${session.session_id}`);
        if (!alive) return;
        setMessages(r.messages);
        setCustomerTyping(!!r.customer_pending);
        if (r.status === 'ended') {
          setSession(cur => cur ? { ...cur, status: 'ended' } : cur);
          setCustomerTyping(false);
        }
      } catch { /* ignore */ }
    };
    const t = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [session?.mode, session?.session_id, session?.status]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const startPersona = async (persona_id) => {
    setBusy(true); setScorecard(null);
    try {
      const r = await api('/practice/sessions', { method: 'POST', body: { persona_id } });
      setAwaitingNext(false); setCompletedScorecard(null);
      setSession({ ...r, mode: 'persona' }); setMessages(r.messages);
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };

  const startReal = async (chatId) => {
    setBusy(true); setScorecard(null);
    try {
      const r = await api(`/practice/real-chats/${chatId}/sessions`, { method: 'POST' });
      setAwaitingNext(false); setCompletedScorecard(null);
      setSession(r); setMessages(r.messages);
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };

  const startSupervised = async (id) => {
    setBusy(true); setScorecard(null);
    try {
      const r = await api(`/practice/supervised/${id}`);
      setAwaitingNext(false); setCompletedScorecard(null); setCustomerTyping(!!r.customer_pending);
      setSession({ ...r, mode: 'supervised' }); setMessages(r.messages);
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };

  const startLiveManual = async (id) => {
    setBusy(true); setScorecard(null);
    try {
      const r = await api(`/practice/live-manual/${id}/claim`, { method: 'POST' });
      setAwaitingNext(false); setCompletedScorecard(null);
      setSession({ ...r, mode: 'live_manual' }); setMessages(r.messages);
      setReplyLeft(r.turn?.waiting_for_trainee ? r.turn.seconds_left : null);
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };

  const startTalk = async () => {
    setBusy(true); setScorecard(null);
    try {
      const r = await api('/practice/talk-sessions', { method: 'POST' });
      setAwaitingNext(false); setCompletedScorecard(null);
      setSession(r); setMessages(r.messages);
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };

  const send = async (e) => {
    e.preventDefault();
    const body = input.trim();
    if (!body || busy) return;
    const activeSession = session;
    setInput('');
    setMessages(m => [...m, { id: 'tmp', role: 'intern', body }]);
    setBusy(true);
    try {
      if (activeSession.mode === 'live_manual') {
        const r = await api(`/practice/live-manual/${activeSession.session_id}/messages`, { method: 'POST', body: { body } });
        setMessages(r.messages);
        setReplyLeft(r.turn?.waiting_for_trainee ? r.turn.seconds_left : null);
        return;
      }
      const path = activeSession.mode === 'real_chat'
        ? `/practice/real-chat-sessions/${activeSession.session_id}/messages`
        : activeSession.mode === 'talk_customer'
          ? `/practice/talk-sessions/${activeSession.session_id}/messages`
        : activeSession.mode === 'supervised'
          ? `/practice/supervised/${activeSession.session_id}/messages`
        : `/practice/sessions/${activeSession.session_id}/messages`;
      if (activeSession.mode === 'talk_customer') await new Promise(resolve => setTimeout(resolve, 15000));
      const r = await api(path, { method: 'POST', body: { body } });
      setMessages(r.messages);
      if (r.complete) {
        const doneScorecard = { ...r.scorecard, session_id: activeSession.session_id, real_chat: activeSession.real_chat || null };
        setAwaitingNext(false);
        if (['talk_customer', 'real_chat', 'supervised'].includes(activeSession.mode)) {
          setCompletedScorecard(doneScorecard);
        } else {
          setCompletedScorecard(null);
          setScorecard(doneScorecard);
          setSession(null);
        }
      } else if (activeSession.mode === 'real_chat') {
        setAwaitingNext(!!r.waiting_for_more);
        if (r.waiting_for_more) startCountdown();   // customer replies after 15s
      } else if (activeSession.mode === 'supervised') {
        setCustomerTyping(!!r.customer_pending);    // admin is preparing the next customer message
      }
    } catch (e2) { alert(e2.message); }
    finally { setBusy(false); }
  };

  const continueReal = async () => {
    clearNextTimer();
    if (!session || session.mode !== 'real_chat' || busy) return;
    const activeSession = session;
    setBusy(true);
    try {
      const r = await api(`/practice/real-chat-sessions/${activeSession.session_id}/continue`, { method: 'POST' });
      setMessages(r.messages);
      setAwaitingNext(false);
      if (r.complete) {
        setCompletedScorecard({ ...r.scorecard, session_id: activeSession.session_id, real_chat: activeSession.real_chat });
      }
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };

  // After an intern reply, the real customer "replies" (next message block) in 15s.
  // Sending another reply restarts the wait; Stop ends the chat.
  const runCountdown = (fromN) => {
    if (nextTimerRef.current) clearInterval(nextTimerRef.current);
    let n = fromN;
    setCountdown(n); setPaused(false);
    nextTimerRef.current = setInterval(() => {
      n -= 1;
      setCountdown(n);
      if (n <= 0) { clearNextTimer(); continueReal(); }
    }, 1000);
  };
  const startCountdown = () => runCountdown(15);
  const pauseCountdown = () => { if (nextTimerRef.current) { clearInterval(nextTimerRef.current); nextTimerRef.current = null; } setPaused(true); };
  const resumeCountdown = () => { if (countdown > 0) runCountdown(countdown); };
  const stopReal = async () => {
    clearNextTimer();
    const activeSession = session;
    if (!activeSession) return;
    setBusy(true);
    try {
      const r = await api(`/practice/sessions/${activeSession.session_id}/end`, { method: 'POST' });
      setScorecard({ ...r, session_id: activeSession.session_id, real_chat: activeSession.real_chat || null });
      setAwaitingNext(false); setCompletedScorecard(null); setSession(null);
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };
  useEffect(() => () => clearNextTimer(), []);

  const end = async () => {
    clearNextTimer();
    const activeSession = session;
    setBusy(true);
    try {
      const r = await api(`/practice/sessions/${activeSession.session_id}/end`, { method: 'POST' });
      setScorecard({ ...r, session_id: activeSession.session_id, real_chat: activeSession.real_chat || null });
      setAwaitingNext(false); setCompletedScorecard(null);
      setSession(null);
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };

  const downloadTranscript = async (sessionId) => {
    try {
      const r = await api(`/practice/real-chat-sessions/${sessionId}/export`);
      downloadText(r.filename, r.text);
    } catch (e) { alert(e.message); }
  };

  if (scorecard) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-black text-slate-800">Session scorecard</h1>
            {scorecard.real_chat && <p className="text-sm text-slate-500">{scorecard.real_chat.customer_name} · {scorecard.real_chat.intent}</p>}
          </div>
          {scorecard.real_chat && (
            <Button variant="secondary" onClick={() => downloadTranscript(scorecard.session_id)}>Download chat</Button>
          )}
        </div>
        <Card>
          <div className="flex items-center gap-3">
            <span className="text-4xl font-black text-slate-800">{scorecard.overall ?? '-'}</span>
            <div className="text-sm text-slate-500">
              <p>average over {scorecard.turn_count} graded replies</p>
              <ScoreBadge value={scorecard.overall} label="overall" />
            </div>
          </div>
        </Card>
        {scorecard.weakest_turns?.length > 0 && (
          <Card title="Your weakest turns — study the ideal replies">
            <div className="space-y-5">
              {scorecard.weakest_turns.map(e => (
                <div key={e.id} className="border-b border-slate-100 pb-4">
                  <Evaluation e={e} showContext />
                </div>
              ))}
            </div>
          </Card>
        )}
        <Card title="All graded turns">
          <div className="space-y-5">
            {scorecard.evaluations.map(e => (
              <div key={e.id} className="border-b border-slate-100 pb-4"><Evaluation e={e} showContext /></div>
            ))}
          </div>
        </Card>
        <Button onClick={() => setScorecard(null)}>Practise again</Button>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800">Practice Chat</h1>
          <p className="text-sm text-slate-500">Handle real Decoinks conversations or train with AI personas. Every reply is silently scored.</p>
        </div>

        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
          {supervisedList.length > 0 && (
            <button onClick={() => setTab('live')} className={`px-3 py-1.5 rounded-md text-sm font-semibold flex items-center gap-1.5 ${tab === 'live' ? 'bg-violet-700 text-white' : 'text-violet-700 hover:bg-violet-50'}`}>
              🎧 Live session <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-500 text-white">{supervisedList.length}</span>
            </button>
          )}
          {liveManualList.length > 0 && (
            <button onClick={() => setTab('trainer')} className={`px-3 py-1.5 rounded-md text-sm font-semibold flex items-center gap-1.5 ${tab === 'trainer' ? 'bg-violet-700 text-white' : 'text-violet-700 hover:bg-violet-50'}`}>
              💬 Trainer chat <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-500 text-white">{liveManualList.length}</span>
            </button>
          )}
          {assignedChats.length > 0 && (
            <button onClick={() => setTab('assigned')} className={`px-3 py-1.5 rounded-md text-sm font-semibold flex items-center gap-1.5 ${tab === 'assigned' ? 'bg-violet-700 text-white' : 'text-violet-700 hover:bg-violet-50'}`}>
              📌 Assigned <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-500 text-white">{assignedChats.filter(c => c.status !== 'done').length}</span>
            </button>
          )}
          <button onClick={() => setTab('real')} className={`px-3 py-1.5 rounded-md text-sm font-semibold ${tab === 'real' ? 'bg-violet-700 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Real customer chats</button>
          <button onClick={() => setTab('talk')} className={`px-3 py-1.5 rounded-md text-sm font-semibold ${tab === 'talk' ? 'bg-violet-700 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Talk to customer</button>
          <button onClick={() => setTab('persona')} className={`px-3 py-1.5 rounded-md text-sm font-semibold ${tab === 'persona' ? 'bg-violet-700 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>AI personas</button>
        </div>

        {tab === 'live' ? (
          <div className="grid md:grid-cols-2 gap-3">
            {supervisedList.length === 0 && <p className="text-sm text-slate-400">No live sessions assigned right now.</p>}
            {supervisedList.map(s => (
              <button key={s.id} onClick={() => startSupervised(s.id)} disabled={busy}
                className="rounded-lg border border-violet-300 bg-violet-50 hover:bg-violet-100 p-4 text-left transition">
                <p className="font-bold text-violet-800">🎧 {s.customer_name}</p>
                <p className="text-xs text-slate-500 mt-0.5">{s.intent || 'Live customer'} · {s.customer_shown} messages so far</p>
                <div className="mt-3 inline-flex rounded-md bg-violet-700 px-3 py-1.5 text-sm font-bold text-white">Join live chat</div>
              </button>
            ))}
          </div>
        ) : tab === 'trainer' ? (
          <div className="grid md:grid-cols-2 gap-3">
            {liveManualList.length === 0 && <p className="text-sm text-slate-400">No trainer chats right now.</p>}
            {liveManualList.map(s => (
              <button key={s.id} onClick={() => startLiveManual(s.id)} disabled={busy}
                className="rounded-lg border border-violet-300 bg-violet-50 hover:bg-violet-100 p-4 text-left transition">
                <p className="font-bold text-violet-800">💬 {s.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">Trainer: {s.trainer_name} · {s.message_count} messages so far</p>
                <div className="mt-3 inline-flex rounded-md bg-violet-700 px-3 py-1.5 text-sm font-bold text-white">
                  {s.status === 'invited' ? 'Accept & join' : 'Rejoin live chat'}
                </div>
              </button>
            ))}
          </div>
        ) : tab === 'assigned' ? (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            {assignedChats.length === 0 && <p className="text-sm text-slate-400">No chats assigned to you right now.</p>}
            {assignedChats.map(c => (
              <button key={c.assignment_id} onClick={() => startReal(c.chat_id)} disabled={busy}
                className={`rounded-lg border p-4 text-left transition ${c.status === 'done' ? 'border-slate-200 bg-slate-50 hover:border-slate-300' : 'border-violet-300 bg-violet-50 hover:bg-violet-100'}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-bold text-slate-800">📌 {c.customer_name}</p>
                  {c.status === 'done' && <span className="shrink-0 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">Done ✓</span>}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">{c.intent || 'Assigned chat'}</p>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                  {c.product_type && <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-bold">{c.product_type === 'dtf' ? 'DTF' : c.product_type === 'tshirt' ? 'Custom t-shirt' : 'Other'}</span>}
                  {c.chat_language && <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-bold">{c.chat_language === 'en' ? 'English' : c.chat_language === 'es' ? 'Spanish' : 'Other'}</span>}
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{c.customer_messages} customer msgs</span>
                </div>
                <div className="mt-3 inline-flex rounded-md bg-violet-700 px-3 py-1.5 text-sm font-bold text-white">{c.status === 'done' ? 'Practise again' : 'Start chat'}</div>
              </button>
            ))}
          </div>
        ) : tab === 'real' ? (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            {realChats.map(c => (
              <button key={c.id} onClick={() => startReal(c.id)} disabled={busy}
                className="rounded-lg border border-slate-200 bg-white hover:border-violet-400 p-4 text-left transition">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-bold text-slate-800">{c.source_number}. {c.customer_name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{c.intent || 'General inquiry'}</p>
                  </div>
                </div>
                <p className="text-xs text-slate-500 mt-2 line-clamp-3">{c.summary}</p>
                <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-slate-500">
                  <span className="px-2 py-0.5 rounded bg-slate-100">{c.customer_messages} customer msgs</span>
                  {c.artwork_count > 0 && <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700">{c.artwork_count} artwork</span>}
                </div>
              </button>
            ))}
          </div>
        ) : tab === 'talk' ? (
          <div className="max-w-2xl">
            <button onClick={startTalk} disabled={busy}
              className="w-full rounded-lg border border-violet-200 bg-white hover:border-violet-500 hover:bg-violet-50 p-5 text-left transition">
              <p className="font-black text-lg text-slate-800">Start live customer chat</p>
              <p className="mt-1 text-sm text-slate-500">
                A Decoinks customer will chat naturally, use real customer writing styles, ask broken or unclear questions, and share artwork/design images during the conversation.
              </p>
              <div className="mt-4 inline-flex rounded-md bg-violet-700 px-3 py-2 text-sm font-bold text-white">Start chat</div>
            </button>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <button onClick={() => startPersona(null)} disabled={busy}
              className="rounded-lg border-2 border-dashed border-violet-300 bg-violet-50 hover:bg-violet-100 p-4 text-left transition">
              <p className="font-bold text-violet-700">Random persona</p>
              <p className="text-xs text-slate-500 mt-1">Like real life, you do not choose your customer.</p>
            </button>
            {personas.map(p => (
              <button key={p.id} onClick={() => startPersona(p.id)} disabled={busy}
                className="rounded-lg border border-slate-200 bg-white hover:border-violet-400 p-4 text-left transition">
                <div className="flex items-center justify-between">
                  <p className="font-bold text-slate-700">{p.name}</p>
                  <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${p.difficulty === 'hard' ? 'bg-rose-100 text-rose-600' : p.difficulty === 'easy' ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>{p.difficulty}</span>
                </div>
                <p className="text-xs text-slate-500 mt-1">{p.description}</p>
              </button>
            ))}
          </div>
        )}
        {busy && <Spinner text="Starting session..." />}
      </div>
    );
  }

  const liveEnded = session.mode === 'live_manual' && session.status === 'ended';
  const supervisedEnded = session.mode === 'supervised' && session.status === 'ended';
  const sessionEnded = liveEnded || supervisedEnded;
  const title = (session.mode === 'real_chat' || session.mode === 'supervised')
    ? session.real_chat?.customer_name
    : session.mode === 'live_manual'
      ? (session.name || 'Live trainer chat')
    : session.mode === 'talk_customer'
      ? session.style?.name
      : (session.persona?.name || 'Customer');
  const subtitle = session.mode === 'supervised'
    ? (supervisedEnded ? 'Live session ended by your trainer' : '🎧 Live — supervised by admin')
    : session.mode === 'live_manual'
      ? (liveEnded ? (session.deleted ? 'Chat deleted by your trainer' : 'Chat ended by your trainer') : `💬 Live — chatting with ${session.trainer_name || 'your trainer'}`)
    : session.mode === 'real_chat'
      ? `${session.real_chat?.intent || 'Real transcript'}`
      : session.mode === 'talk_customer'
        ? session.style?.agent_tip
        : session.persona?.description;

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)]">
      <div className="flex items-center justify-between mb-3 gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-800">{title}</h1>
          <p className="text-xs text-slate-500">{subtitle}</p>
        </div>
        <div className="flex gap-2">
          {session.mode === 'real_chat' && <Button variant="secondary" onClick={() => downloadTranscript(session.session_id)} disabled={busy}>Download chat</Button>}
          {session.mode === 'live_manual' || supervisedEnded
            ? <Button variant="secondary" onClick={() => setSession(null)}>Leave</Button>
            : completedScorecard
              ? <Button onClick={() => { setScorecard(completedScorecard); setCompletedScorecard(null); setSession(null); }}>Check your results</Button>
              : <Button variant="danger" onClick={end} disabled={busy}>End & see scorecard</Button>}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto bg-white rounded-lg border border-slate-200 p-4 space-y-3">
        {messages.map((m, i) => (
          <div key={m.id || i} className={`flex ${m.role === 'intern' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${m.role === 'intern' ? 'bg-violet-700 text-white rounded-br-sm' : 'bg-slate-100 text-slate-800 rounded-bl-sm'}`}>
              {m.body}
              {m.attachment_url && (
                <a href={m.attachment_url} target="_blank" rel="noreferrer" className="mt-2 block overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <img src={m.attachment_url} alt="Customer artwork" className="max-h-52 w-full object-contain bg-slate-50" />
                </a>
              )}
              {m.is_artwork && !m.attachment_url && <p className="mt-2 text-xs font-semibold text-slate-500">Artwork attachment shared</p>}
            </div>
          </div>
        ))}
        {busy && <p className="text-xs text-slate-400 italic">{session.mode === 'real_chat' ? 'checking your reply...' : session.mode === 'live_manual' ? 'sending…' : 'customer is typing...'}</p>}
        {sessionEnded && !busy && (
          <div className="flex justify-center">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <span className="font-bold">Chat ended.</span> {session.deleted ? 'Your trainer deleted this chat.' : 'Your trainer closed this live chat.'}
            </div>
          </div>
        )}
        {session.mode === 'live_manual' && !liveEnded && replyLeft != null && (
          <div className="flex justify-center">
            <div className={`rounded-lg border px-3 py-2 text-xs font-semibold ${replyLeft <= 0 ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
              {replyLeft <= 0 ? "⏰ Time's up — reply now!" : <>⏳ Your turn — reply within <span className="tabular-nums">{replyLeft}s</span></>}
            </div>
          </div>
        )}
        {session.mode === 'supervised' && customerTyping && !busy && <p className="text-xs text-slate-400 italic">customer is typing…</p>}
        {session.mode === 'real_chat' && awaitingNext && !busy && (
          <div className="flex justify-center">
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {countdown > 0
                ? (paused
                    ? <>Paused at <span className="font-bold tabular-nums">{countdown}s</span> — press Resume to continue.</>
                    : <>Customer will reply in <span className="font-bold tabular-nums">{countdown}s</span>… send more replies to reset, Pause to hold, or Stop to end.</>)
                : 'Send as many replies as you need.'}
            </div>
          </div>
        )}
        {(session.mode === 'real_chat' || session.mode === 'talk_customer') && completedScorecard && !busy && (
          <div className="flex justify-center">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <span className="font-bold">Chat ended.</span> All customer messages are complete.
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      {sessionEnded ? (
        <div className="mt-3 flex justify-end">
          <Button variant="secondary" onClick={() => setSession(null)}>Back to Practice</Button>
        </div>
      ) : completedScorecard ? (
        <div className="mt-3 flex justify-end gap-2">
          {session.mode === 'real_chat' && <Button variant="secondary" onClick={() => downloadTranscript(session.session_id)} disabled={busy}>Download chat</Button>}
          <Button onClick={() => { setScorecard(completedScorecard); setCompletedScorecard(null); setSession(null); }}>Check your results</Button>
        </div>
      ) : <form onSubmit={send} className="mt-3 flex gap-2 items-end">
        <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={onEnter(send)} disabled={busy} rows={1}
          placeholder="Reply like a Decoinks agent…  (Enter to send, Shift+Enter for new line)" autoFocus
          className="flex-1 resize-none border border-slate-300 rounded-lg px-4 py-2.5 text-sm bg-white" />
        <Button disabled={busy || !input.trim()}>Send</Button>
        {session.mode === 'real_chat' && countdown > 0 && (
          paused
            ? <Button type="button" variant="secondary" onClick={resumeCountdown} disabled={busy}>Resume</Button>
            : <Button type="button" variant="secondary" onClick={pauseCountdown} disabled={busy}>Pause</Button>
        )}
        {session.mode === 'real_chat' && (
          <Button type="button" variant="danger" onClick={stopReal} disabled={busy}>Stop</Button>
        )}
      </form>}
    </div>
  );
}
