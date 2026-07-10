import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Card, Spinner, Button } from '../../components/ui';

const KINDS = [
  ['knowledge', 'Knowledge Base', 'Company facts: products, pricing, MOQ, turnaround, shipping, payment, policies.'],
  ['training', 'Training Material', 'The agent training manual / modules.'],
  ['qa', 'Real Q&A', 'Real customer questions grouped by intent + the best agent reply for each.'],
];

export default function Content() {
  const [docs, setDocs] = useState(null);
  const [products, setProducts] = useState([]);
  const [productForm, setProductForm] = useState({ topic: '', youtube_url: '', document: null });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = () => api('/admin/documents').then(setDocs).catch(console.error);
  const loadProducts = () => api('/admin/company-products').then(setProducts).catch(console.error);
  useEffect(() => { load(); loadProducts(); }, []);

  const upload = async (kind, files) => {
    if (!files?.length) return;
    setBusy(true); setMsg(`Uploading + re-ingesting…`);
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      const r = await api(`/admin/documents/${kind}`, { method: 'POST', formData: fd });
      setMsg(`Ingested: ${r.ingest.filter(x => x.status === 'ready').length}/${r.ingest.length} files ready.`);
      load();
    } catch (e) { setMsg(`Error: ${e.message}`); }
    finally { setBusy(false); }
  };

  const reingest = async () => {
    setBusy(true); setMsg('Training the AI on your knowledge base…');
    try {
      const r = await api('/admin/ingest', { method: 'POST' });
      const ready = r.ingest.filter(x => x.status === 'ready').length;
      setMsg(`✅ Trained — ${ready}/${r.ingest.length} documents indexed. The AI agent now answers from this knowledge.`);
      load();
    } catch (e) { setMsg(`Error: ${e.message}`); }
    finally { setBusy(false); }
  };

  const deleteDocument = async (doc) => {
    if (!confirm(`Delete ${doc.filename}?`)) return;
    setBusy(true); setMsg(`Deleting ${doc.filename}...`);
    try {
      await api(`/admin/documents/${doc.id}`, { method: 'DELETE' });
      setMsg(`${doc.filename} deleted.`);
      load();
    } catch (e) { setMsg(`Error: ${e.message}`); }
    finally { setBusy(false); }
  };

  const addProduct = async (e) => {
    e.preventDefault();
    if (!productForm.topic.trim() || !productForm.document) {
      setMsg('Error: topic name and Word document required.');
      return;
    }
    setBusy(true); setMsg('Saving company product topic...');
    try {
      const fd = new FormData();
      fd.append('topic', productForm.topic);
      fd.append('youtube_url', productForm.youtube_url);
      fd.append('document', productForm.document);
      await api('/admin/company-products', { method: 'POST', formData: fd });
      setProductForm({ topic: '', youtube_url: '', document: null });
      const input = document.getElementById('company-product-doc');
      if (input) input.value = '';
      setMsg('Company product topic saved.');
      loadProducts();
    } catch (e2) { setMsg(`Error: ${e2.message}`); }
    finally { setBusy(false); }
  };

  const deleteProduct = async (id) => {
    if (!confirm('Delete this company product topic?')) return;
    setBusy(true); setMsg('Deleting company product topic...');
    try {
      await api(`/admin/company-products/${id}`, { method: 'DELETE' });
      setMsg('Company product topic deleted.');
      loadProducts();
    } catch (e) { setMsg(`Error: ${e.message}`); }
    finally { setBusy(false); }
  };

  if (!docs) return <Spinner />;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black text-slate-800">Content</h1>
        <Button onClick={reingest} disabled={busy}>🧠 Train on knowledge base</Button>
      </div>
      <p className="text-sm text-slate-500">Uploaded files land in <code className="bg-slate-200 px-1 rounded">./content/</code> and are parsed → chunked → embedded automatically on upload. Press <span className="font-semibold">Train on knowledge base</span> anytime to re-index everything so the AI agent answers from the latest documents.</p>
      {msg && <p className={`text-sm ${msg.startsWith('Error') ? 'text-rose-600' : 'text-emerald-700'}`}>{busy ? '⏳ ' : ''}{msg}</p>}

      <Card title="Company Products">
        <form onSubmit={addProduct} className="grid lg:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">Topic name</span>
            <input value={productForm.topic} onChange={e => setProductForm({ ...productForm, topic: e.target.value })}
              placeholder="e.g. DTF Transfers"
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">YouTube link</span>
            <input value={productForm.youtube_url} onChange={e => setProductForm({ ...productForm, youtube_url: e.target.value })}
              placeholder="https://youtube.com/..."
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white" />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">Word document</span>
            <input id="company-product-doc" type="file" accept=".doc,.docx,.txt,.md"
              onChange={e => setProductForm({ ...productForm, document: e.target.files?.[0] || null })}
              className="mt-1 w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-violet-50 file:px-3 file:py-2 file:text-violet-700" />
          </label>
          <Button disabled={busy}>Add topic</Button>
        </form>
        <div className="mt-4 border-t border-slate-100">
          {products.length === 0 ? <p className="text-sm text-slate-400 pt-3">No company product topics yet.</p> : (
            <table className="w-full text-sm">
              <tbody>
                {products.map(p => (
                  <tr key={p.id} className="border-b border-slate-100">
                    <td className="py-2">
                      <p className="font-medium text-slate-700">{p.topic}</p>
                      <p className="text-xs text-slate-400">{p.document_filename || 'No document'}{p.youtube_url ? ' · YouTube linked' : ''}</p>
                    </td>
                    <td className="text-right">
                      <button onClick={() => deleteProduct(p.id)} disabled={busy}
                        className="text-xs font-medium text-rose-600 hover:underline disabled:opacity-50">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {KINDS.map(([kind, label, desc]) => {
        const files = docs.filter(d => d.kind === kind);
        return (
          <Card key={kind} title={label}
            action={
              <label className={`text-xs font-medium text-violet-700 cursor-pointer hover:underline ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
                + Upload / replace
                <input type="file" multiple className="hidden" accept=".pdf,.docx,.xlsx,.xls,.csv,.txt,.md,.json"
                  onChange={e => { upload(kind, e.target.files); e.target.value = ''; }} />
              </label>
            }>
            <p className="text-xs text-slate-400 mb-2">{desc}</p>
            {files.length === 0 ? <p className="text-sm text-slate-400">No files yet.</p> : (
              <table className="w-full text-sm">
                <tbody>
                  {files.map(d => (
                    <tr key={d.id} className="border-t border-slate-100">
                      <td className="py-1.5">{d.filename}</td>
                      <td className="text-slate-400 text-xs">{d.chunk_count} chunks</td>
                      <td className="text-right">
                        {d.parsed_status === 'ready'
                          ? <span className="text-xs font-bold text-emerald-600">✓ ready</span>
                          : d.parsed_status === 'error'
                            ? <span className="text-xs font-bold text-rose-600" title={d.parse_error}>✗ error</span>
                            : <span className="text-xs text-amber-600">{d.parsed_status}</span>}
                        <button onClick={() => deleteDocument(d)} disabled={busy}
                          className="ml-3 text-xs font-medium text-rose-600 hover:underline disabled:opacity-50">Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        );
      })}
    </div>
  );
}
