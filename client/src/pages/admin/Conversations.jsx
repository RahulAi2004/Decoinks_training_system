// Admin "Conversations" — review every Decoinks-agent chat (customer + agent
// messages) and fix any wrong customer message. A correction is saved and also
// becomes a training example, so the AI improves from the fix.
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Card, Spinner, Button, ScoreBadge } from '../../components/ui';

const MODE_LABEL = { real_chat: 'Real customer', talk_customer: 'AI customer', persona: 'AI persona' };

export default function Conversations() {
  const [list, setList] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [convo, setConvo] = useState(null);
  const [editing, setEditing] = useState(null);   // {id, text}
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
      <div>
        <h1 className="text-2xl font-black text-slate-800">Conversations</h1>
        <p className="text-sm text-slate-500">Every Decoinks-agent chat — the customer messages and the agent's replies. Fix a wrong customer message and it also becomes a training example.</p>
      </div>
      {msg && <p className="text-sm text-emerald-700">{msg}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <select value={agentFilter} onChange={e => setAgentFilter(e.target.value)}
          className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white">
          <option value="">All agents</option>
          {agents.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={modeFilter} onChange={e => setModeFilter(e.target.value)}
          className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white">
          <option value="">All types</option>
          <option value="real_chat">Real customer</option>
          <option value="talk_customer">AI customer</option>
          <option value="persona">AI persona</option>
        </select>
        <span className="text-xs text-slate-400">{filtered.length} of {list.length}</span>
        {(agentFilter || modeFilter) && (
          <button onClick={() => { setAgentFilter(''); setModeFilter(''); }} className="text-xs font-semibold text-violet-600 hover:text-violet-800">Clear</button>
        )}
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
                                <button onClick={() => setEditing({ id: m.id, text: m.body })} className="ml-2 text-amber-600 hover:text-amber-800 normal-case font-semibold">✎ Fix</button>
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
