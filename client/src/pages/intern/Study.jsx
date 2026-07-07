import { useEffect, useState } from 'react';
import { api, getToken } from '../../api';
import { Card, Spinner } from '../../components/ui';

const KIND_LABEL = { knowledge: 'Knowledge Base', training: 'Training Manual', qa: 'Real Q&A' };

export default function Study() {
  const [docs, setDocs] = useState(null);
  const [products, setProducts] = useState([]);
  const [activeProduct, setActiveProduct] = useState(null);
  const [active, setActive] = useState(null);
  const [chunks, setChunks] = useState(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);

  useEffect(() => {
    api('/study/documents').then(setDocs).catch(console.error);
    api('/study/company-products').then(setProducts).catch(console.error);
  }, []);

  const openDoc = async (d) => {
    setActiveProduct(null); setActive(d); setResults(null); setChunks(null);
    setChunks(await api(`/study/documents/${d.id}/chunks`));
  };
  const openProduct = async (p) => {
    setActive(null); setResults(null); setChunks(null);
    setActiveProduct(await api(`/study/company-products/${p.id}`));
  };
  const search = async (e) => {
    e.preventDefault();
    if (!q.trim()) return;
    setActiveProduct(null); setActive(null); setChunks(null);
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
          {docs.map((d, i) => (
            <div key={d.id}>
              {d.featured === 1 && i === 0 && (
                <p className="text-[10px] uppercase tracking-wider text-amber-600 font-bold mb-1 mt-0.5">★ Start here</p>
              )}
              {d.featured !== 1 && docs[i - 1]?.featured === 1 && (
                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1 mt-3">All material</p>
              )}
              <button onClick={() => openDoc(d)}
                className={`w-full text-left rounded-xl border p-3 transition ${active?.id === d.id ? 'border-violet-500 bg-violet-50' : d.featured === 1 ? 'border-amber-300 bg-amber-50/60 hover:border-amber-400' : 'border-slate-200 bg-white hover:border-violet-300'}`}>
                <p className={`text-[11px] uppercase tracking-wide font-bold ${d.featured === 1 ? 'text-amber-600' : 'text-violet-600'}`}>{d.featured === 1 && '★ '}{KIND_LABEL[d.kind]}</p>
                <p className="text-sm font-medium text-slate-700 break-all">{d.filename}</p>
                <p className="text-xs text-slate-400">{d.chunk_count} sections</p>
              </button>
            </div>
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
          {!activeProduct && !active && !results && <p className="text-sm text-slate-400 pt-8 text-center">Pick a product topic, document, or search to start studying.</p>}
        </div>
      </div>
    </div>
  );
}
