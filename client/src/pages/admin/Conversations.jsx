// Admin "Conversations" — two tabs:
//  • Agent conversations: review every Decoinks-agent chat and fix wrong
//    customer messages (a fix also becomes a training example).
//  • Assign chats: classify the real-customer library once (DTF / t-shirts /
//    language), filter it, read any chat in full, tick the ones you want and
//    assign them to a trainee (and remove them again).
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Card, Spinner, Button, ScoreBadge } from '../../components/ui';
import { TranslateMessage } from '../../components/Translate';

const MODE_LABEL = { real_chat: 'Real customer', talk_customer: 'AI customer', live_manual: 'Trainer chat', persona: 'AI persona' };
const PRODUCT_LABEL = { dtf: 'DTF', tshirt: 'Custom t-shirt', other: 'Other' };
const LANG_LABEL = { en: 'English', es: 'Spanish', other: 'Other' };

export default function Conversations() {
  const [tab, setTab] = useState('review');
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-black text-slate-800">Conversations</h1>
        <p className="text-sm text-slate-500">Review agent chats and fix customer messages, or filter the customer library and assign chats to a trainee.</p>
      </div>
      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
        <button onClick={() => setTab('review')} className={`px-3 py-1.5 rounded-md text-sm font-semibold ${tab === 'review' ? 'bg-violet-700 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Agent conversations</button>
        <button onClick={() => setTab('assign')} className={`px-3 py-1.5 rounded-md text-sm font-semibold ${tab === 'assign' ? 'bg-violet-700 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>Assign chats</button>
      </div>
      {tab === 'review' ? <ReviewTab /> : <AssignTab />}
    </div>
  );
}

// ---------------- Agent conversations (review + fix) ----------------
function ReviewTab() {
  const [list, setList] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [convo, setConvo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [msg, setMsg] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [modeFilter, setModeFilter] = useState('');

  useEffect(() => { api('/admin/conversations').then(setList).catch(console.error); }, []);

  const agents = [...new Set((list || []).map(s => s.agent_name).filter(Boolean))].sort();
  const filtered = (list || []).filter(s =>
    (!agentFilter || s.agent_name === agentFilter) && (!modeFilter || s.mode === modeFilter));

  const open = async (id) => {
    if (openId === id) { setOpenId(null); setConvo(null); return; }
    setOpenId(id); setConvo(null); setEditing(null); setMsg('');
    try { setConvo(await api(`/admin/conversations/${id}`)); }
    catch (e) { alert(e.message); }
  };
  const saveEdit = async (m) => {
    const body = editing.text.trim();
    if (!body) return;
    try {
      await api(`/admin/conversations/messages/${m.id}`, { method: 'PUT', body: { body } });
      setConvo(c => ({ ...c, messages: c.messages.map(x => x.id === m.id ? { ...x, body } : x) }));
      setEditing(null);
      setMsg('✅ Saved — the fix is now a training example.');
    } catch (e) { alert(e.message); }
  };

  if (!list) return <Spinner />;
  return (
    <div className="space-y-4">
      {msg && <p className="text-sm text-emerald-700">{msg}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <select value={agentFilter} onChange={e => setAgentFilter(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white">
          <option value="">All agents</option>
          {agents.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={modeFilter} onChange={e => setModeFilter(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white">
          <option value="">All types</option>
          <option value="real_chat">Real customer</option>
          <option value="talk_customer">AI customer</option>
          <option value="live_manual">Trainer chat</option>
          <option value="persona">AI persona</option>
        </select>
        <span className="text-xs text-slate-400">{filtered.length} of {list.length}</span>
        {(agentFilter || modeFilter) && <button onClick={() => { setAgentFilter(''); setModeFilter(''); }} className="text-xs font-semibold text-violet-600 hover:text-violet-800">Clear</button>}
      </div>

      <Card>
        <div className="divide-y divide-slate-100">
          {filtered.length === 0 && <p className="text-sm text-slate-400 py-4">No conversations match.</p>}
          {filtered.map(s => (
            <div key={s.id}>
              <button onClick={() => open(s.id)} className="w-full flex items-center justify-between gap-3 py-3 text-left hover:bg-slate-50 -mx-2 px-2 rounded">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800 truncate">
                    {s.agent_name} <span className="text-slate-400 font-normal">·</span> <span className="text-violet-600">{MODE_LABEL[s.mode] || s.mode}</span>
                    {s.real_name && <span className="text-slate-400 font-normal"> · {s.real_name}</span>}
                    {s.style_name && <span className="text-slate-400 font-normal"> · {s.style_name}</span>}
                    {s.live_manual_name && <span className="text-slate-400 font-normal"> · {s.live_manual_name}</span>}
                  </p>
                  <p className="text-xs text-slate-400">{s.started_at?.slice(0, 16).replace('T', ' ')} · {s.msg_count} messages · {s.status}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {s.overall_score != null && <ScoreBadge value={s.overall_score} label="score" />}
                  <span className="text-slate-400 text-lg">{openId === s.id ? '⌄' : '›'}</span>
                </div>
              </button>

              {openId === s.id && (
                <div className="pb-4">
                  {!convo ? <Spinner /> : (
                    <div className="space-y-2 bg-slate-50 rounded-lg border border-slate-200 p-3">
                      {convo.messages.map(m => (
                        <div key={m.id} className={`flex ${m.role === 'intern' ? 'justify-end' : 'justify-start'}`}>
                          <div className="max-w-[80%]">
                            <div className={`rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${m.role === 'intern' ? 'bg-violet-700 text-white rounded-br-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm'}`}>
                              {editing?.id === m.id ? (
                                <div className="space-y-1.5">
                                  <textarea value={editing.text} onChange={e => setEditing({ id: m.id, text: e.target.value })} rows={2}
                                    className="w-64 max-w-full border border-amber-300 rounded-lg px-2.5 py-1.5 text-xs bg-amber-50 text-slate-800" />
                                  <div className="flex gap-2">
                                    <Button onClick={() => saveEdit(m)} disabled={!editing.text.trim()}>Save fix</Button>
                                    <button onClick={() => setEditing(null)} className="text-xs text-slate-500 hover:text-slate-700">Cancel</button>
                                  </div>
                                </div>
                              ) : m.body}
                              {m.attachment_url && (
                                <a href={m.attachment_url} target="_blank" rel="noreferrer" className="mt-2 block overflow-hidden rounded-lg border border-slate-200 bg-white">
                                  <img src={m.attachment_url} alt="Shared artwork" className="max-h-44 w-full object-contain bg-slate-50" />
                                </a>
                              )}
                            </div>
                            <p className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                              {m.role === 'intern' ? 'Agent' : 'Customer'}
                              {m.role === 'customer' && editing?.id !== m.id && (
                                <>
                                  <button onClick={() => setEditing({ id: m.id, text: m.body })} className="ml-2 text-amber-600 hover:text-amber-800 normal-case font-semibold">✎ Fix</button>
                                  <TranslateMessage path={`/admin/messages/${m.id}/translate`} className="ml-2" />
                                </>
                              )}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// Product / language / completed pills used in both the preview and assigned lists.
function ChatTags({ chat }) {
  return (
    <>
      {chat.product_type && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">{PRODUCT_LABEL[chat.product_type] || chat.product_type}</span>}
      {chat.chat_language && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{LANG_LABEL[chat.chat_language] || chat.chat_language}</span>}
      {chat.is_completed != null && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${chat.is_completed ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>{chat.is_completed ? 'Completed' : 'Not completed'}</span>}
    </>
  );
}

// ---------------- Assign chats (classify + filter + read + assign) ----------------
function AssignTab() {
  const [status, setStatus] = useState(null);        // {total, classified, remaining}
  const [classifying, setClassifying] = useState(false);
  const [trainees, setTrainees] = useState([]);
  const [traineeId, setTraineeId] = useState('');
  const [product, setProduct] = useState('');
  const [language, setLanguage] = useState('');
  const [completed, setCompleted] = useState('');
  const [limit, setLimit] = useState(10);
  const [result, setResult] = useState(null);        // {total, chats}
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState([]);      // chat ids ticked for assigning
  const [assigned, setAssigned] = useState([]);      // what the chosen trainee already has
  const [view, setView] = useState(null);            // {chat, messages} — full transcript
  const [viewLoading, setViewLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [msg, setMsg] = useState('');

  const loadStatus = () => api('/admin/chat-classification').then(setStatus).catch(console.error);
  useEffect(() => {
    loadStatus();
    api('/admin/live-manual/agents').then(setTrainees).catch(console.error);
  }, []);

  // Reload the filtered list whenever a filter or the cap changes (debounced).
  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams({ product, language, completed, limit: String(limit) });
      setLoading(true);
      api(`/admin/assignable-chats?${params}`).then(setResult).catch(console.error).finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(t);
  }, [product, language, completed, limit, status?.classified]);

  const loadAssigned = (id) => {
    if (!id) { setAssigned([]); return; }
    api(`/admin/assignments/${id}`).then(setAssigned).catch(console.error);
  };
  useEffect(() => { loadAssigned(traineeId); }, [traineeId]);

  const runLoop = async () => {
    let guard = 0;
    for (;;) {
      const r = await api('/admin/chat-classification/run', { method: 'POST', body: {} });
      setStatus({ total: r.total, classified: r.classified, remaining: r.remaining });
      if (r.remaining <= 0 || guard++ > 60) break;
    }
    await loadStatus();
  };
  const classifyAll = async () => {
    setClassifying(true); setMsg('');
    try { await runLoop(); setMsg('✅ All chats classified. Filters are ready.'); }
    catch (e) { alert(e.message); }
    finally { setClassifying(false); }
  };
  const reclassifyAll = async () => {
    if (!window.confirm('Re-classify the whole library from scratch? Existing tags will be replaced.')) return;
    setClassifying(true); setMsg('');
    try {
      setStatus(await api('/admin/chat-classification/reset', { method: 'POST' }));
      await runLoop();
      setMsg('✅ Library re-classified.');
    } catch (e) { alert(e.message); }
    finally { setClassifying(false); }
  };

  const openChat = async (id) => {
    setViewLoading(true);
    try { setView(await api(`/admin/real-chats/${id}/transcript`)); }
    catch (e) { alert(e.message); }
    finally { setViewLoading(false); }
  };

  const toggle = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const shown = result?.chats || [];
  const allShownSelected = shown.length > 0 && shown.every(c => selected.includes(c.id));
  const toggleAll = () => setSelected(allShownSelected ? [] : shown.map(c => c.id));

  const assignSelected = async () => {
    if (!traineeId) { alert('Pick a trainee'); return; }
    if (!selected.length) { alert('Tick the chats you want to assign'); return; }
    setAssigning(true); setMsg('');
    try {
      const r = await api('/admin/assign-chats', { method: 'POST', body: { trainee_id: traineeId, real_chat_ids: selected } });
      const name = trainees.find(t => t.id === traineeId)?.name || 'trainee';
      setMsg(`✅ Assigned ${r.assigned} chat${r.assigned === 1 ? '' : 's'} to ${name}${r.assigned < r.requested ? ` (${r.requested - r.assigned} already had it)` : ''}.`);
      setSelected([]);
      loadAssigned(traineeId);
    } catch (e) { alert(e.message); }
    finally { setAssigning(false); }
  };

  const removeAssigned = async (chatId) => {
    try {
      await api(`/admin/assignments/${traineeId}/${chatId}`, { method: 'DELETE' });
      setAssigned(a => a.filter(x => x.chat_id !== chatId));
      setMsg('Removed from the trainee’s list.');
    } catch (e) { alert(e.message); }
  };

  // ===== Full transcript view =====
  if (view) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-black text-slate-800 truncate">{view.chat.source_number}. {view.chat.customer_name}</p>
            <p className="text-xs text-slate-400">{view.chat.intent} · {view.messages.length} messages · {view.chat.outcome}</p>
          </div>
          <Button variant="secondary" onClick={() => setView(null)}>← Back to list</Button>
        </div>
        <Card>
          <div className="space-y-3 max-h-[calc(100vh-18rem)] overflow-y-auto">
            {view.messages.map(m => (
              <div key={m.id} className={`flex ${m.role === 'agent' ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-[80%]">
                  <div className={`rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${m.role === 'agent' ? 'bg-violet-700 text-white rounded-br-sm' : 'bg-slate-100 text-slate-800 rounded-bl-sm'}`}>
                    {m.body}
                    {m.attachment_url && (
                      <a href={m.attachment_url} target="_blank" rel="noreferrer" className="mt-2 block overflow-hidden rounded-lg border border-slate-200 bg-white">
                        <img src={m.attachment_url} alt="Shared artwork" className="max-h-52 w-full object-contain bg-slate-50" />
                      </a>
                    )}
                  </div>
                  <p className={`mt-0.5 text-[10px] uppercase tracking-wide text-slate-400 ${m.role === 'agent' ? 'text-right' : ''}`}>
                    {m.role === 'agent' ? 'Agent' : 'Customer'}{m.sent_at ? ` · ${m.sent_at}` : ''}
                    {m.role === 'customer' && <TranslateMessage path={`/admin/real-chat-messages/${m.id}/translate`} className="ml-2" />}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  const needsClassify = status && status.remaining > 0;

  return (
    <div className="space-y-4">
      {viewLoading && <Spinner text="Opening chat…" />}

      {/* Classification status */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <p className="font-semibold text-slate-700">Chat classification</p>
            {status
              ? <p className="text-xs text-slate-500">{status.classified} / {status.total} chats tagged by product & language{status.remaining > 0 ? ` · ${status.remaining} still need tagging` : ' · all done ✓'}</p>
              : <p className="text-xs text-slate-400">Loading…</p>}
          </div>
          <div className="flex gap-2">
            {needsClassify && (
              <Button onClick={classifyAll} disabled={classifying}>
                {classifying ? `Classifying… ${status?.remaining ?? ''} left` : 'Classify all chats (one-time)'}
              </Button>
            )}
            <Button variant="secondary" onClick={reclassifyAll} disabled={classifying}>
              {classifying && !needsClassify ? `Re-classifying… ${status?.remaining ?? ''} left` : 'Re-classify all'}
            </Button>
          </div>
        </div>
        {needsClassify && !classifying && <p className="mt-2 text-xs text-amber-600">Run this once so the DTF / t-shirt / language filters work. It won’t call the AI again afterwards.</p>}
      </Card>

      {/* Filters */}
      <Card title="Filter the customer library">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">Product</span>
            <select value={product} onChange={e => setProduct(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm bg-white">
              <option value="">All products</option>
              <option value="dtf">DTF transfers</option>
              <option value="tshirt">Custom t-shirts</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">Language</span>
            <select value={language} onChange={e => setLanguage(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm bg-white">
              <option value="">All languages</option>
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">Status</span>
            <select value={completed} onChange={e => setCompleted(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm bg-white">
              <option value="">All</option>
              <option value="yes">Completed (ordered)</option>
              <option value="no">Not completed</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">Chats to show</span>
            <input type="number" min="1" max="200" value={limit} onChange={e => setLimit(e.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm bg-white" />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
          <span className="text-sm text-slate-600">{loading ? 'Counting…' : <><b>{result?.total ?? 0}</b> chats match · <b>{selected.length}</b> ticked</>}</span>
          <div className="flex-1" />
          <select value={traineeId} onChange={e => setTraineeId(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
            <option value="">Choose trainee…</option>
            {trainees.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <Button onClick={assignSelected} disabled={assigning || !traineeId || !selected.length}>
            {assigning ? 'Assigning…' : `Assign selected (${selected.length})`}
          </Button>
        </div>
        {msg && <p className="mt-2 text-sm text-emerald-700">{msg}</p>}
      </Card>

      {/* Preview with tick-boxes */}
      <Card title={`Pick the chats (${shown.length} shown)`}>
        {loading ? <Spinner /> : (shown.length ? (
          <>
            <label className="flex items-center gap-2 pb-2 text-xs font-semibold text-slate-500 border-b border-slate-100 cursor-pointer">
              <input type="checkbox" checked={allShownSelected} onChange={toggleAll} className="h-4 w-4 accent-violet-700" />
              Select all shown
            </label>
            <div className="divide-y divide-slate-100">
              {shown.map(c => (
                <div key={c.id} className="flex items-center gap-3 py-2 text-sm">
                  <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)}
                    aria-label={`Select ${c.customer_name}`} className="h-4 w-4 shrink-0 accent-violet-700" />
                  <button onClick={() => openChat(c.id)} className="min-w-0 flex-1 text-left hover:bg-slate-50 rounded px-1 py-0.5">
                    <p className="font-semibold text-slate-800 truncate">{c.source_number}. {c.customer_name} <span className="text-violet-600 font-normal">· read →</span></p>
                    <p className="text-xs text-slate-400 truncate">{c.intent} · {c.customer_messages} customer msgs{c.artwork_count > 0 ? ` · ${c.artwork_count} artwork` : ''}</p>
                  </button>
                  <div className="flex items-center gap-1.5 shrink-0"><ChatTags chat={c} /></div>
                </div>
              ))}
            </div>
          </>
        ) : <p className="text-sm text-slate-400">No chats match this filter.</p>)}
      </Card>

      {/* What the trainee currently has */}
      {traineeId && (
        <Card title={`Assigned to ${trainees.find(t => t.id === traineeId)?.name || 'trainee'} (${assigned.length})`}>
          {assigned.length === 0 ? <p className="text-sm text-slate-400">Nothing assigned yet. Tick chats above and press “Assign selected”.</p> : (
            <div className="divide-y divide-slate-100">
              {assigned.map(a => (
                <div key={a.assignment_id} className="flex items-center gap-3 py-2 text-sm">
                  <button onClick={() => openChat(a.chat_id)} className="min-w-0 flex-1 text-left hover:bg-slate-50 rounded px-1 py-0.5">
                    <p className="font-semibold text-slate-800 truncate">{a.source_number}. {a.customer_name} <span className="text-violet-600 font-normal">· read →</span></p>
                    <p className="text-xs text-slate-400 truncate">{a.intent} · {a.customer_messages} customer msgs</p>
                  </button>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <ChatTags chat={a} />
                    {a.status === 'done' && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">Done ✓</span>}
                    <button onClick={() => removeAssigned(a.chat_id)} title="Remove from trainee" aria-label="Remove from trainee"
                      className="px-2 text-slate-400 hover:text-rose-600">✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
