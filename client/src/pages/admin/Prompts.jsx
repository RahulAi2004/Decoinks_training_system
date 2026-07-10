// Admin "AI Prompts" — view and customize the system prompts that drive the AI.
// Editing a prompt changes AI behaviour immediately (no code change / redeploy).
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Card, Spinner, Button } from '../../components/ui';

export default function Prompts() {
  const [prompts, setPrompts] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');

  const load = () => api('/admin/prompts').then(list => {
    setPrompts(list);
    setDrafts(Object.fromEntries(list.map(p => [p.key, p.current])));
  }).catch(console.error);
  useEffect(() => { load(); }, []);

  const save = async (key) => {
    setBusy(key); setMsg('');
    try {
      await api(`/admin/prompts/${key}`, { method: 'PUT', body: { text: drafts[key] } });
      setMsg(`✅ Saved — "${key}" is now live.`);
      load();
    } catch (e) { setMsg(`Error: ${e.message}`); }
    finally { setBusy(''); }
  };
  const reset = async (key) => {
    setBusy(key); setMsg('');
    try {
      const p = await api(`/admin/prompts/${key}/reset`, { method: 'POST' });
      setDrafts(d => ({ ...d, [key]: p.current }));
      setMsg(`↩ Reset "${key}" to default.`);
      load();
    } catch (e) { setMsg(`Error: ${e.message}`); }
    finally { setBusy(''); }
  };

  if (!prompts) return <Spinner />;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-black text-slate-800">AI Prompts</h1>
        <p className="text-sm text-slate-500">
          These are the instructions the AI follows. Edit any prompt to change how the AI behaves —
          it takes effect immediately. Use <code className="bg-slate-200 px-1 rounded">{'{{placeholder}}'}</code> tokens
          where shown; they are filled in automatically at runtime.
        </p>
      </div>
      {msg && <p className={`text-sm ${msg.startsWith('Error') ? 'text-rose-600' : 'text-emerald-700'}`}>{msg}</p>}

      {prompts.map(p => {
        const dirty = drafts[p.key] !== p.current;
        return (
          <Card key={p.key} title={p.label}>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <p className="text-sm text-slate-500 flex-1 min-w-[12rem]">{p.description}</p>
              {p.customized && <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-amber-100 text-amber-700">Customized</span>}
            </div>
            {p.placeholders.length > 0 && (
              <p className="text-xs text-slate-500 mb-2">
                Placeholders: {p.placeholders.map(ph => <code key={ph} className="bg-slate-100 px-1 rounded mr-1">{`{{${ph}}}`}</code>)}
              </p>
            )}
            <textarea
              value={drafts[p.key] ?? ''}
              onChange={e => setDrafts(d => ({ ...d, [p.key]: e.target.value }))}
              rows={Math.min(22, Math.max(6, (drafts[p.key] || '').split('\n').length + 1))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs font-mono bg-white leading-relaxed" />
            <div className="mt-2 flex gap-2">
              <Button onClick={() => save(p.key)} disabled={busy === p.key || !dirty}>{busy === p.key ? 'Saving…' : 'Save'}</Button>
              <Button variant="secondary" onClick={() => reset(p.key)} disabled={busy === p.key || !p.customized}>Reset to default</Button>
              {dirty && <span className="self-center text-xs text-amber-600">Unsaved changes</span>}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
