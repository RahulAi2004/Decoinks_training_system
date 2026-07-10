// Admin "Chat with AI" — the admin plays the Decoinks agent, the AI plays the
// customer. The admin approves the AI's good customer messages as examples that
// train how the AI customer messages in practice mode.
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { Card, Spinner, Button } from '../../components/ui';

export default function AiChat() {
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [ended, setEnded] = useState(false);
  const [examples, setExamples] = useState([]);
  const [savedIds, setSavedIds] = useState(new Set());
  const [newExample, setNewExample] = useState('');
  const bottomRef = useRef(null);

  const loadExamples = () => api('/admin/customer-examples').then(setExamples).catch(console.error);
  useEffect(() => { loadExamples(); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const start = async () => {
    setBusy(true);
    try {
      const r = await api('/practice/talk-sessions', { method: 'POST' });
      setSession(r); setMessages(r.messages); setEnded(false); setSavedIds(new Set());
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };

  const send = async (e) => {
    e.preventDefault();
    const body = input.trim();
    if (!body || busy || !session) return;
    setInput('');
    setMessages(m => [...m, { id: 'tmp', role: 'intern', body }]);
    setBusy(true);
    try {
      const r = await api(`/practice/talk-sessions/${session.session_id}/messages`, { method: 'POST', body: { body } });
      setMessages(r.messages);
      if (r.complete) setEnded(true);
    } catch (e2) { alert(e2.message); }
    finally { setBusy(false); }
  };

  const saveExample = async (m) => {
    try {
      await api('/admin/customer-examples', { method: 'POST', body: { body: m.body } });
      setSavedIds(prev => new Set(prev).add(m.id));
      loadExamples();
    } catch (e) { alert(e.message); }
  };

  const addCustom = async (e) => {
    e.preventDefault();
    const body = newExample.trim();
    if (!body) return;
    try {
      await api('/admin/customer-examples', { method: 'POST', body: { body } });
      setNewExample(''); loadExamples();
    } catch (e2) { alert(e2.message); }
  };

  const removeExample = async (id) => {
    try { await api(`/admin/customer-examples/${id}`, { method: 'DELETE' }); loadExamples(); }
    catch (e) { alert(e.message); }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-black text-slate-800">Chat with AI</h1>
        <p className="text-sm text-slate-500">
          You are the Decoinks agent — the AI plays the customer. Approve the AI's good customer
          messages with <span className="font-semibold">★ Save as example</span>; approved messages train
          how the AI customer chats with interns.
        </p>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Chat column */}
        <div className="lg:col-span-2 flex flex-col h-[calc(100vh-11rem)]">
          {!session ? (
            <Card>
              <p className="text-sm text-slate-600 mb-3">Start a live chat with an AI customer to test its replies and collect good examples.</p>
              <Button onClick={start} disabled={busy}>{busy ? 'Starting…' : 'Start AI customer chat'}</Button>
            </Card>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-slate-500">{ended ? 'Chat ended' : 'Live — AI customer'}</p>
                <Button variant="secondary" onClick={start} disabled={busy}>New chat</Button>
              </div>
              <div className="flex-1 overflow-y-auto bg-white rounded-lg border border-slate-200 p-4 space-y-3">
                {messages.map((m, i) => (
                  <div key={m.id || i} className={`flex ${m.role === 'intern' ? 'justify-end' : 'justify-start'}`}>
                    <div className="max-w-[80%]">
                      <div className={`rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${m.role === 'intern' ? 'bg-violet-700 text-white rounded-br-sm' : 'bg-slate-100 text-slate-800 rounded-bl-sm'}`}>
                        {m.body}
                        {m.attachment_url && (
                          <a href={m.attachment_url} target="_blank" rel="noreferrer" className="mt-2 block overflow-hidden rounded-lg border border-slate-200 bg-white">
                            <img src={m.attachment_url} alt="Customer artwork" className="max-h-52 w-full object-contain bg-slate-50" />
                          </a>
                        )}
                      </div>
                      {m.role !== 'intern' && m.id && m.id !== 'tmp' && (
                        savedIds.has(m.id)
                          ? <span className="mt-1 inline-block text-[11px] font-semibold text-emerald-600">✓ Saved as example</span>
                          : <button onClick={() => saveExample(m)} className="mt-1 text-[11px] font-semibold text-violet-600 hover:text-violet-800">★ Save as example</button>
                      )}
                    </div>
                  </div>
                ))}
                {busy && <p className="text-xs text-slate-400 italic">customer is typing…</p>}
                {ended && <div className="flex justify-center"><div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-800"><span className="font-bold">Chat ended.</span> The order was completed.</div></div>}
                <div ref={bottomRef} />
              </div>
              {!ended && (
                <form onSubmit={send} className="mt-3 flex gap-2">
                  <input value={input} onChange={e => setInput(e.target.value)} disabled={busy} autoFocus
                    placeholder="Reply as the Decoinks agent…"
                    className="flex-1 border border-slate-300 rounded-lg px-4 py-2.5 text-sm bg-white" />
                  <Button disabled={busy || !input.trim()}>Send</Button>
                </form>
              )}
            </>
          )}
        </div>

        {/* Examples column */}
        <div className="flex flex-col h-[calc(100vh-11rem)]">
          <Card title={`Approved examples (${examples.length})`}>
            <form onSubmit={addCustom} className="flex gap-2 mb-3">
              <input value={newExample} onChange={e => setNewExample(e.target.value)}
                placeholder="Add a custom example message…"
                className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white" />
              <Button disabled={!newExample.trim()}>Add</Button>
            </form>
            <div className="space-y-2 overflow-y-auto max-h-[calc(100vh-20rem)] pr-1">
              {examples.length === 0 && <p className="text-xs text-slate-400">No examples yet. Approve the AI's good messages, or add your own above.</p>}
              {examples.map(ex => (
                <div key={ex.id} className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-xs text-slate-700 whitespace-pre-wrap">{ex.body}</p>
                  <button onClick={() => removeExample(ex.id)} className="text-slate-400 hover:text-rose-600 text-xs shrink-0">✕</button>
                </div>
              ))}
            </div>
          </Card>
          <p className="mt-2 text-[11px] text-slate-400">These examples are fed to the AI customer as few-shot guidance in both this portal and intern practice.</p>
        </div>
      </div>
      {busy && !session && <Spinner text="Starting…" />}
    </div>
  );
}
