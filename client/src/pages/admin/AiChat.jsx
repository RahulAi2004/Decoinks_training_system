// Admin "Chat with AI" — toggle between two modes, training the AI both ways:
//  • AI = customer (admin plays agent): approve good customer messages.
//  • AI = agent   (admin plays customer): AI answers from the knowledge base;
//    admin approves good replies or CORRECTS wrong ones. Corrections become hard
//    rules so the agent follows the admin's guidance next time.
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { Card, Spinner, Button } from '../../components/ui';

export default function AiChat() {
  const [mode, setMode] = useState('customer'); // 'customer' = AI is customer, 'agent' = AI is agent
  const bottomRef = useRef(null);

  // shared
  const [busy, setBusy] = useState(false);
  const [customerExamples, setCustomerExamples] = useState([]);
  const [agentExamples, setAgentExamples] = useState([]);
  const [newExample, setNewExample] = useState('');

  // customer mode (AI = customer)
  const [personas, setPersonas] = useState([]);
  const [persona, setPersona] = useState('');   // '' = random
  const [session, setSession] = useState(null);
  const [cMessages, setCMessages] = useState([]);
  const [cInput, setCInput] = useState('');
  const [cEnded, setCEnded] = useState(false);
  const [cSaved, setCSaved] = useState(new Set());
  const [cCorrecting, setCCorrecting] = useState(null); // {id, text}

  // Enter sends, Shift+Enter makes a new line.
  const onEnter = (submit) => (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(e); } };

  // agent mode (AI = agent)
  const [aMessages, setAMessages] = useState([]);
  const [aInput, setAInput] = useState('');
  const [aSaved, setASaved] = useState(new Set());
  const [correcting, setCorrecting] = useState(null); // {idx, text}

  const loadCustomer = () => api('/admin/customer-examples').then(setCustomerExamples).catch(console.error);
  const loadAgent = () => api('/admin/agent-examples').then(setAgentExamples).catch(console.error);
  useEffect(() => {
    loadCustomer(); loadAgent();
    api('/practice/talk-styles').then(setPersonas).catch(console.error);
  }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [cMessages, aMessages]);

  // ---------------- Customer mode ----------------
  const startCustomer = async () => {
    setBusy(true);
    try {
      const r = await api('/practice/talk-sessions', { method: 'POST', body: persona ? { style_id: persona } : {} });
      setSession(r); setCMessages(r.messages); setCEnded(false); setCSaved(new Set());
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };
  const sendCustomer = async (e) => {
    e.preventDefault();
    const body = cInput.trim();
    if (!body || busy || !session) return;
    setCInput('');
    setCMessages(m => [...m, { id: 'tmp', role: 'intern', body }]);
    setBusy(true);
    try {
      const r = await api(`/practice/talk-sessions/${session.session_id}/messages`, { method: 'POST', body: { body } });
      setCMessages(r.messages);
      if (r.complete) setCEnded(true);
    } catch (e2) { alert(e2.message); }
    finally { setBusy(false); }
  };
  const saveCustomerMsg = async (m) => {
    try {
      await api('/admin/customer-examples', { method: 'POST', body: { body: m.body } });
      setCSaved(prev => new Set(prev).add(m.id));
      loadCustomer();
    } catch (e) { alert(e.message); }
  };
  const submitCustomerCorrection = async (m) => {
    const text = cCorrecting.text.trim();
    if (!text) return;
    try {
      await api('/admin/customer-examples', { method: 'POST', body: { body: text } });
      setCMessages(ms => ms.map(x => x.id === m.id ? { ...x, body: text } : x));
      setCSaved(prev => new Set(prev).add(m.id));
      setCCorrecting(null);
      loadCustomer();
    } catch (e) { alert(e.message); }
  };

  // ---------------- Agent mode ----------------
  const sendAgent = async (e) => {
    e.preventDefault();
    const customer_text = aInput.trim();
    if (!customer_text || busy) return;
    setAInput('');
    const convo = [...aMessages, { role: 'customer', body: customer_text }];
    setAMessages(convo);
    setBusy(true);
    try {
      const r = await api('/admin/agent-chat', { method: 'POST', body: { conversation: aMessages, customer_text } });
      setAMessages([...convo, { role: 'agent', body: r.reply, id: `a${convo.length}` }]);
    } catch (e2) { alert(e2.message); }
    finally { setBusy(false); }
  };
  const priorCustomer = (idx) => {
    for (let i = idx - 1; i >= 0; i--) if (aMessages[i].role === 'customer') return aMessages[i].body;
    return '';
  };
  const saveAgentReply = async (m, idx) => {
    try {
      await api('/admin/agent-examples', { method: 'POST', body: { customer_text: priorCustomer(idx), reply: m.body, is_correction: false } });
      setASaved(prev => new Set(prev).add(m.id));
      loadAgent();
    } catch (e) { alert(e.message); }
  };
  const submitCorrection = async (idx) => {
    const text = correcting.text.trim();
    if (!text) return;
    try {
      await api('/admin/agent-examples', { method: 'POST', body: { customer_text: priorCustomer(idx), reply: text, is_correction: true } });
      setAMessages(ms => ms.map((m, i) => i === idx ? { ...m, body: text, corrected: true } : m));
      setCorrecting(null);
      loadAgent();
    } catch (e) { alert(e.message); }
  };

  const addCustom = async (e) => {
    e.preventDefault();
    const body = newExample.trim();
    if (!body) return;
    try {
      if (mode === 'customer') await api('/admin/customer-examples', { method: 'POST', body: { body } });
      else await api('/admin/agent-examples', { method: 'POST', body: { reply: body, is_correction: false } });
      setNewExample('');
      mode === 'customer' ? loadCustomer() : loadAgent();
    } catch (e2) { alert(e2.message); }
  };
  const removeExample = async (id) => {
    try {
      if (mode === 'customer') { await api(`/admin/customer-examples/${id}`, { method: 'DELETE' }); loadCustomer(); }
      else { await api(`/admin/agent-examples/${id}`, { method: 'DELETE' }); loadAgent(); }
    } catch (e) { alert(e.message); }
  };

  const bubble = (m, i, side, children) => (
    <div key={m.id || i} className={`flex ${side === 'right' ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[80%]">
        <div className={`rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${side === 'right' ? 'bg-violet-700 text-white rounded-br-sm' : 'bg-slate-100 text-slate-800 rounded-bl-sm'}`}>
          {m.body}
          {m.attachment_url && (
            <a href={m.attachment_url} target="_blank" rel="noreferrer" className="mt-2 block overflow-hidden rounded-lg border border-slate-200 bg-white">
              <img src={m.attachment_url} alt="Customer artwork" className="max-h-52 w-full object-contain bg-slate-50" />
            </a>
          )}
        </div>
        {children}
      </div>
    </div>
  );

  const examples = mode === 'customer' ? customerExamples : agentExamples;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-black text-slate-800">Chat with AI</h1>
        <p className="text-sm text-slate-500">
          Train the AI both ways. Approve good messages, or correct wrong agent replies — corrections become
          rules the AI agent will follow.
        </p>
      </div>

      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
        <button onClick={() => setMode('customer')} className={`px-3 py-1.5 rounded-md text-sm font-semibold ${mode === 'customer' ? 'bg-violet-700 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>AI is customer (you = agent)</button>
        <button onClick={() => setMode('agent')} className={`px-3 py-1.5 rounded-md text-sm font-semibold ${mode === 'agent' ? 'bg-violet-700 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>AI is agent (you = customer)</button>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Chat column */}
        <div className="lg:col-span-2 flex flex-col h-[calc(100vh-13rem)]">
          {mode === 'customer' ? (
            !session ? (
              <Card>
                <p className="text-sm text-slate-600 mb-3">Pick a persona to train, then start a chat. You reply as the Decoinks agent; approve or correct the AI customer's messages.</p>
                <label className="block mb-3">
                  <span className="text-xs font-semibold text-slate-500">Persona</span>
                  <select value={persona} onChange={e => setPersona(e.target.value)}
                    className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
                    <option value="">🎲 Random persona</option>
                    {personas.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <Button onClick={startCustomer} disabled={busy}>{busy ? 'Starting…' : 'Start AI customer chat'}</Button>
              </Card>
            ) : (
              <>
                <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                  <p className="text-xs font-semibold text-slate-500">{cEnded ? 'Chat ended' : 'Live'} — <span className="text-violet-600">{session.style?.name || 'AI customer'}</span></p>
                  <div className="flex items-center gap-2">
                    <select value={persona} onChange={e => setPersona(e.target.value)} disabled={busy}
                      className="border border-slate-300 rounded-md px-2 py-1 text-xs bg-white">
                      <option value="">🎲 Random</option>
                      {personas.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <Button variant="secondary" onClick={startCustomer} disabled={busy}>New chat</Button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto bg-white rounded-lg border border-slate-200 p-4 space-y-3">
                  {cMessages.map((m, i) => bubble(m, i, m.role === 'intern' ? 'right' : 'left',
                    m.role !== 'intern' && m.id && m.id !== 'tmp' && (
                      cCorrecting?.id === m.id ? (
                        <div className="mt-1.5 space-y-1.5">
                          <textarea value={cCorrecting.text} onChange={e => setCCorrecting({ id: m.id, text: e.target.value })} rows={2}
                            className="w-full border border-amber-300 rounded-lg px-2.5 py-1.5 text-xs bg-amber-50" />
                          <div className="flex gap-2">
                            <Button onClick={() => submitCustomerCorrection(m)} disabled={!cCorrecting.text.trim()}>Save correction</Button>
                            <button onClick={() => setCCorrecting(null)} className="text-xs text-slate-500 hover:text-slate-700">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-1 flex gap-3">
                          {cSaved.has(m.id)
                            ? <span className="text-[11px] font-semibold text-emerald-600">✓ Saved</span>
                            : <button onClick={() => saveCustomerMsg(m)} className="text-[11px] font-semibold text-violet-600 hover:text-violet-800">★ Save as example</button>}
                          <button onClick={() => setCCorrecting({ id: m.id, text: m.body })} className="text-[11px] font-semibold text-amber-600 hover:text-amber-800">✎ Correct</button>
                        </div>
                      )
                    )
                  ))}
                  {busy && <p className="text-xs text-slate-400 italic">customer is typing…</p>}
                  {cEnded && <div className="flex justify-center"><div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-800"><span className="font-bold">Chat ended.</span> The order was completed.</div></div>}
                  <div ref={bottomRef} />
                </div>
                {!cEnded && (
                  <form onSubmit={sendCustomer} className="mt-3 flex gap-2 items-end">
                    <textarea value={cInput} onChange={e => setCInput(e.target.value)} onKeyDown={onEnter(sendCustomer)} disabled={busy} autoFocus rows={1}
                      placeholder="Reply as the Decoinks agent…  (Enter to send, Shift+Enter for new line)"
                      className="flex-1 resize-none border border-slate-300 rounded-lg px-4 py-2.5 text-sm bg-white" />
                    <Button disabled={busy || !cInput.trim()}>Send</Button>
                  </form>
                )}
              </>
            )
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-slate-500">You are the customer — AI answers from the knowledge base</p>
                {aMessages.length > 0 && <Button variant="secondary" onClick={() => { setAMessages([]); setASaved(new Set()); setCorrecting(null); }} disabled={busy}>Clear</Button>}
              </div>
              <div className="flex-1 overflow-y-auto bg-white rounded-lg border border-slate-200 p-4 space-y-3">
                {aMessages.length === 0 && <p className="text-xs text-slate-400">Type a customer message below. The AI will answer as the Decoinks agent using your knowledge base.</p>}
                {aMessages.map((m, i) => bubble(m, i, m.role === 'customer' ? 'right' : 'left',
                  m.role === 'agent' && (
                    correcting?.idx === i ? (
                      <div className="mt-1.5 space-y-1.5">
                        <textarea value={correcting.text} onChange={e => setCorrecting({ idx: i, text: e.target.value })} rows={2}
                          className="w-full border border-amber-300 rounded-lg px-2.5 py-1.5 text-xs bg-amber-50" />
                        <div className="flex gap-2">
                          <Button onClick={() => submitCorrection(i)} disabled={!correcting.text.trim()}>Save correction</Button>
                          <button onClick={() => setCorrecting(null)} className="text-xs text-slate-500 hover:text-slate-700">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-1 flex gap-3">
                        {m.corrected
                          ? <span className="text-[11px] font-semibold text-amber-600">✎ Corrected — saved as rule</span>
                          : aSaved.has(m.id)
                            ? <span className="text-[11px] font-semibold text-emerald-600">✓ Saved</span>
                            : <button onClick={() => saveAgentReply(m, i)} className="text-[11px] font-semibold text-violet-600 hover:text-violet-800">★ Save reply</button>}
                        {!m.corrected && <button onClick={() => setCorrecting({ idx: i, text: m.body })} className="text-[11px] font-semibold text-amber-600 hover:text-amber-800">✎ Correct</button>}
                      </div>
                    )
                  )
                ))}
                {busy && <p className="text-xs text-slate-400 italic">agent is typing…</p>}
                <div ref={bottomRef} />
              </div>
              <form onSubmit={sendAgent} className="mt-3 flex gap-2 items-end">
                <textarea value={aInput} onChange={e => setAInput(e.target.value)} onKeyDown={onEnter(sendAgent)} disabled={busy} autoFocus rows={1}
                  placeholder="Message as the customer…  (Enter to send, Shift+Enter for new line)"
                  className="flex-1 resize-none border border-slate-300 rounded-lg px-4 py-2.5 text-sm bg-white" />
                <Button disabled={busy || !aInput.trim()}>Send</Button>
              </form>
            </>
          )}
        </div>

        {/* Examples column */}
        <div className="flex flex-col h-[calc(100vh-13rem)]">
          <Card title={`${mode === 'customer' ? 'Customer' : 'Agent'} examples (${examples.length})`}>
            <form onSubmit={addCustom} className="flex gap-2 mb-3">
              <input value={newExample} onChange={e => setNewExample(e.target.value)}
                placeholder={mode === 'customer' ? 'Add a customer message…' : 'Add a good agent reply…'}
                className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white" />
              <Button disabled={!newExample.trim()}>Add</Button>
            </form>
            <div className="space-y-2 overflow-y-auto max-h-[calc(100vh-22rem)] pr-1">
              {examples.length === 0 && <p className="text-xs text-slate-400">No examples yet.</p>}
              {examples.map(ex => (
                <div key={ex.id} className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="min-w-0">
                    {ex.is_correction ? <span className="text-[10px] font-bold uppercase text-amber-600">Correction</span> : null}
                    {mode === 'agent' && ex.customer_text ? <p className="text-[10px] text-slate-400 truncate">↳ for: {ex.customer_text}</p> : null}
                    <p className="text-xs text-slate-700 whitespace-pre-wrap">{ex.body || ex.reply}</p>
                  </div>
                  <button onClick={() => removeExample(ex.id)} className="text-slate-400 hover:text-rose-600 text-xs shrink-0">✕</button>
                </div>
              ))}
            </div>
          </Card>
          <p className="mt-2 text-[11px] text-slate-400">
            {mode === 'customer'
              ? 'Fed to the AI customer as few-shot guidance in this portal and intern practice.'
              : 'Corrections are hard rules; approved replies guide the AI agent from now on.'}
          </p>
        </div>
      </div>
      {busy && mode === 'customer' && !session && <Spinner text="Starting…" />}
    </div>
  );
}
