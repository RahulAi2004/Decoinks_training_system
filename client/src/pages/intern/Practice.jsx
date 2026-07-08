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
  const [tab, setTab] = useState('real');
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [awaitingNext, setAwaitingNext] = useState(false);
  const [completedScorecard, setCompletedScorecard] = useState(null);
  const [scorecard, setScorecard] = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    Promise.all([
      api('/practice/personas'),
      api('/practice/real-chats'),
    ]).then(([p, c]) => { setPersonas(p); setRealChats(c); }).catch(console.error);
  }, []);
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

  const send = async (e) => {
    e.preventDefault();
    const body = input.trim();
    if (!body || busy) return;
    const activeSession = session;
    setInput('');
    setMessages(m => [...m, { id: 'tmp', role: 'intern', body }]);
    setBusy(true);
    try {
      const path = activeSession.mode === 'real_chat'
        ? `/practice/real-chat-sessions/${activeSession.session_id}/messages`
        : `/practice/sessions/${activeSession.session_id}/messages`;
      const r = await api(path, { method: 'POST', body: { body } });
      setMessages(r.messages);
      if (r.complete) {
        setScorecard({ ...r.scorecard, session_id: activeSession.session_id, real_chat: activeSession.real_chat });
        setAwaitingNext(false); setCompletedScorecard(null);
        setSession(null);
      } else if (activeSession.mode === 'real_chat') {
        setAwaitingNext(!!r.waiting_for_more);
      }
    } catch (e2) { alert(e2.message); }
    finally { setBusy(false); }
  };

  const continueReal = async () => {
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

  const end = async () => {
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
          <button onClick={() => setTab('real')} className={`px-3 py-1.5 rounded-md text-sm font-semibold ${tab === 'real' ? 'bg-violet-700 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Real customer chats</button>
          <button onClick={() => setTab('persona')} className={`px-3 py-1.5 rounded-md text-sm font-semibold ${tab === 'persona' ? 'bg-violet-700 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>AI personas</button>
        </div>

        {tab === 'real' ? (
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

  const title = session.mode === 'real_chat' ? session.real_chat?.customer_name : (session.persona?.name || 'Customer');
  const subtitle = session.mode === 'real_chat'
    ? `${session.real_chat?.intent || 'Real transcript'}`
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
          {completedScorecard
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
        {busy && <p className="text-xs text-slate-400 italic">{session.mode === 'real_chat' ? 'checking your reply...' : 'customer is typing...'}</p>}
        {session.mode === 'real_chat' && awaitingNext && !busy && (
          <div className="flex justify-center">
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Send as many replies as needed. Click Next question when you are ready for the customer to continue.
            </div>
          </div>
        )}
        {session.mode === 'real_chat' && completedScorecard && !busy && (
          <div className="flex justify-center">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <span className="font-bold">Chat ended.</span> All customer messages are complete.
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      {completedScorecard ? (
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => downloadTranscript(session.session_id)} disabled={busy}>Download chat</Button>
          <Button onClick={() => { setScorecard(completedScorecard); setCompletedScorecard(null); setSession(null); }}>Check your results</Button>
        </div>
      ) : <form onSubmit={send} className="mt-3 flex gap-2">
        <input value={input} onChange={e => setInput(e.target.value)} disabled={busy}
          placeholder="Reply like a Decoinks agent..." autoFocus
          className="flex-1 border border-slate-300 rounded-lg px-4 py-2.5 text-sm bg-white" />
        <Button disabled={busy || !input.trim()}>Send</Button>
        {session.mode === 'real_chat' && awaitingNext && (
          <Button type="button" variant="secondary" onClick={continueReal} disabled={busy}>Next question</Button>
        )}
      </form>}
    </div>
  );
}
