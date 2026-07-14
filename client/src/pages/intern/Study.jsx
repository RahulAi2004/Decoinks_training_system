import { useEffect, useState } from 'react';
import { api, getToken } from '../../api';
import { Card, Spinner } from '../../components/ui';
import { TranslateMessage } from '../../components/Translate';

const KIND_LABEL = { knowledge: 'Knowledge Base', training: 'Training Manual', qa: 'Real Q&A' };
const PRODUCT_LABEL = { dtf: 'DTF', tshirt: 'Custom t-shirt', other: 'Other' };
const LANG_LABEL = { en: 'English', es: 'Spanish', other: 'Other' };

export default function Study() {
  const [docs, setDocs] = useState(null);
  const [products, setProducts] = useState([]);
  const [assigned, setAssigned] = useState([]);
  const [activeProduct, setActiveProduct] = useState(null);
  const [activeChat, setActiveChat] = useState(null);   // an assigned chat, read-only
  const [active, setActive] = useState(null);
  const [chunks, setChunks] = useState(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);

  const loadAssigned = () => api('/study/assigned-chats').then(setAssigned).catch(() => {});
  useEffect(() => {
    api('/study/documents').then(setDocs).catch(console.error);
    api('/study/company-products').then(setProducts).catch(console.error);
    loadAssigned();
  }, []);

  const openDoc = async (d) => {
    setActiveProduct(null); setActiveChat(null); setActive(d); setResults(null); setChunks(null);
    setChunks(await api(`/study/documents/${d.id}/chunks`));
  };
  const openProduct = async (p) => {
    setActive(null); setActiveChat(null); setResults(null); setChunks(null);
    setActiveProduct(await api(`/study/company-products/${p.id}`));
  };
  const openChat = async (a) => {
    setActive(null); setActiveProduct(null); setResults(null); setChunks(null);
    try {
      setActiveChat(await api(`/study/assigned-chats/${a.chat_id}`));
      loadAssigned();   // opening it marks it read
    } catch (e) { alert(e.message); }
  };
  const search = async (e) => {
    e.preventDefault();
    if (!q.trim()) return;
    setActiveProduct(null); setActive(null); setActiveChat(null); setChunks(null);
    setResults(await api(`/study/search?q=${encodeURIComponent(q)}`));
  };
  const downloadProductDoc = async (p) => {
    const res = await fetch(`/api/study/company-products/${p.id}/download`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) throw new Error('Download failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = p.document_filename || 'company-product.docx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  if (!docs) return <Spinner />;
  const featuredDocs = docs.filter(d => d.featured === 1);
  const restDocs = docs.filter(d => d.featured !== 1);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black text-slate-800">Study</h1>
      {products.length > 0 && (
        <Card title="Company Products">
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            {products.map(p => (
              <button key={p.id} onClick={() => openProduct(p)}
                className={`text-left rounded-lg border p-3 transition ${activeProduct?.id === p.id ? 'border-violet-500 bg-violet-50' : 'border-slate-200 bg-slate-50 hover:border-violet-300'}`}>
                <p className="font-semibold text-slate-800">{p.topic}</p>
                <p className="text-xs text-slate-500 mt-1 line-clamp-2">{p.preview || p.document_filename}</p>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                  {p.youtube_url && <span className="px-2 py-0.5 rounded bg-rose-50 text-rose-700">YouTube</span>}
                  {p.document_filename && <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700">Document</span>}
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}
      <form onSubmit={search} className="flex gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search the knowledge base… (e.g. minimum order, shipping time)"
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white" />
        <button className="px-4 py-2 rounded-lg bg-violet-700 text-white text-sm font-medium">Search</button>
      </form>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="space-y-2">
          {featuredDocs.length > 0 && <p className="text-[10px] uppercase tracking-wider text-amber-600 font-bold mb-1 mt-0.5">★ Start here</p>}
          {featuredDocs.map(d => (
            <button key={d.id} onClick={() => openDoc(d)}
              className={`w-full text-left rounded-xl border p-3 transition ${active?.id === d.id ? 'border-violet-500 bg-violet-50' : 'border-amber-300 bg-amber-50/60 hover:border-amber-400'}`}>
              <p className="text-[11px] uppercase tracking-wide font-bold text-amber-600">★ {KIND_LABEL[d.kind]}</p>
              <p className="text-sm font-medium text-slate-700 break-all">{d.filename}</p>
              <p className="text-xs text-slate-400">{d.chunk_count} sections</p>
            </button>
          ))}

          {/* Real customer chats an admin assigned for this agent to read. */}
          {assigned.length > 0 && (
            <>
              <p className="text-[10px] uppercase tracking-wider text-violet-600 font-bold mb-1 mt-3">
                📌 Assigned to you — read these
                <span className="ml-1 text-slate-400">({assigned.filter(a => a.status !== 'done').length} new)</span>
              </p>
              {assigned.map(a => (
                <button key={a.assignment_id} onClick={() => openChat(a)}
                  className={`w-full text-left rounded-xl border p-3 transition ${activeChat?.chat?.id === a.chat_id ? 'border-violet-500 bg-violet-50' : a.status === 'done' ? 'border-slate-200 bg-white hover:border-violet-300' : 'border-violet-300 bg-violet-50/60 hover:border-violet-400'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[11px] uppercase tracking-wide font-bold text-violet-600">📌 Customer chat</p>
                    {a.status === 'done' && <span className="text-[10px] font-bold text-emerald-600">Read ✓</span>}
                  </div>
                  <p className="text-sm font-medium text-slate-700">{a.source_number}. {a.customer_name}</p>
                  <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                    {a.product_type && <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-bold">{PRODUCT_LABEL[a.product_type] || a.product_type}</span>}
                    {a.chat_language && <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-bold">{LANG_LABEL[a.chat_language] || a.chat_language}</span>}
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{a.customer_messages} customer msgs</span>
                  </div>
                </button>
              ))}
            </>
          )}

          {restDocs.length > 0 && <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1 mt-3">All material</p>}
          {restDocs.map(d => (
            <button key={d.id} onClick={() => openDoc(d)}
              className={`w-full text-left rounded-xl border p-3 transition ${active?.id === d.id ? 'border-violet-500 bg-violet-50' : 'border-slate-200 bg-white hover:border-violet-300'}`}>
              <p className="text-[11px] uppercase tracking-wide font-bold text-violet-600">{KIND_LABEL[d.kind]}</p>
              <p className="text-sm font-medium text-slate-700 break-all">{d.filename}</p>
              <p className="text-xs text-slate-400">{d.chunk_count} sections</p>
            </button>
          ))}
        </div>
        <div className="lg:col-span-2">
          {results && (
            <Card title={`Search results for "${q}"`}>
              {results.length === 0 && <p className="text-sm text-slate-400">No matches.</p>}
              <div className="space-y-3">
                {results.map(r => (
                  <div key={r.id} className="border-b border-slate-100 pb-2">
                    <p className="text-[10px] uppercase text-violet-500 font-bold">{KIND_LABEL[r.kind]} · relevance {Math.round(r.score * 100)}%</p>
                    <p className="text-sm whitespace-pre-wrap text-slate-700">{r.content}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {activeProduct && (
            <Card title={activeProduct.topic}
              action={
                <div className="flex gap-2">
                  {activeProduct.youtube_url && (
                    <a href={activeProduct.youtube_url} target="_blank" rel="noreferrer"
                      className="px-3 py-1.5 rounded-lg text-sm font-medium bg-rose-600 hover:bg-rose-700 text-white">YouTube</a>
                  )}
                  {activeProduct.document_filename && (
                    <button onClick={() => downloadProductDoc(activeProduct)}
                      className="px-3 py-1.5 rounded-lg text-sm font-medium bg-white hover:bg-slate-50 text-slate-700 border border-slate-300">Download doc</button>
                  )}
                </div>
              }>
              {activeProduct.document_text ? (
                <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-2">
                  {activeProduct.document_text.split(/\n{2,}/).filter(Boolean).map((para, i) => (
                    <p key={i} className="text-sm whitespace-pre-wrap text-slate-700 border-b border-slate-50 pb-3">{para}</p>
                  ))}
                </div>
              ) : <p className="text-sm text-slate-400">No readable text preview for this document. Use download doc.</p>}
            </Card>
          )}
          {active && (
            <Card title={active.filename}>
              {!chunks ? <Spinner /> : (
                <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
                  {chunks.map(c => <p key={c.id} className="text-sm whitespace-pre-wrap text-slate-700 border-b border-slate-50 pb-3">{c.content}</p>)}
                </div>
              )}
            </Card>
          )}
          {activeChat && (
            <Card title={`${activeChat.chat.source_number}. ${activeChat.chat.customer_name}`}>
              <p className="-mt-1 mb-3 text-xs text-slate-400">
                {activeChat.chat.intent} · {activeChat.messages.length} messages · {activeChat.chat.outcome}
                <span className="ml-1 text-slate-300">· reading only</span>
              </p>
              <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-2">
                {activeChat.messages.map(m => (
                  <div key={m.id} className={`flex ${m.role === 'agent' ? 'justify-end' : 'justify-start'}`}>
                    <div className="max-w-[85%]">
                      <div className={`rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${m.role === 'agent' ? 'bg-violet-700 text-white rounded-br-sm' : 'bg-slate-100 text-slate-800 rounded-bl-sm'}`}>
                        {m.body}
                        {m.attachment_url && (
                          <a href={m.attachment_url} target="_blank" rel="noreferrer" className="mt-2 block overflow-hidden rounded-lg border border-slate-200 bg-white">
                            <img src={m.attachment_url} alt="Shared artwork" className="max-h-52 w-full object-contain bg-slate-50" />
                          </a>
                        )}
                      </div>
                      <p className={`mt-0.5 text-[10px] uppercase tracking-wide text-slate-400 ${m.role === 'agent' ? 'text-right' : ''}`}>
                        {m.role === 'agent' ? 'Decoinks agent' : 'Customer'}{m.sent_at ? ` · ${m.sent_at}` : ''}
                        {m.role === 'customer' && (
                          <TranslateMessage path={`/study/assigned-chats/${activeChat.chat.id}/messages/${m.id}/translate`} className="ml-2" />
                        )}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {!activeProduct && !active && !activeChat && !results && <p className="text-sm text-slate-400 pt-8 text-center">Pick an assigned customer chat, a product topic, a document, or search to start studying.</p>}
        </div>
      </div>
    </div>
  );
}
