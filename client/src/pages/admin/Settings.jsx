import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Card, Spinner, Button } from '../../components/ui';
import { DIMS } from '../../components/Evaluation';

export default function Settings() {
  const [s, setS] = useState(null);
  const [personas, setPersonas] = useState(null);
  const [msg, setMsg] = useState('');
  const [genBusy, setGenBusy] = useState(false);

  const load = () => Promise.all([
    api('/admin/settings').then(setS),
    api('/admin/personas').then(setPersonas),
  ]).catch(console.error);
  useEffect(() => { load(); }, []);

  const save = async () => {
    setMsg('');
    const r = await api('/admin/settings', { method: 'PUT', body: { weights: s.weights, thresholds: s.thresholds, llm: s.llm, quiz: s.quiz } });
    setMsg(`Saved. Active model: ${r.active_model}`);
  };

  const togglePersona = async (p) => {
    await api(`/admin/personas/${p.id}`, { method: 'PATCH', body: { is_active: !p.is_active } });
    load();
  };

  const generateQuizzes = async () => {
    setGenBusy(true); setMsg('');
    try {
      const r = await api('/quizzes/generate', { method: 'POST', body: { count: 10 } });
      setMsg(r.error ? r.error : `Generated ${r.created} new quiz questions from the KB.`);
    } catch (e) { setMsg(`Error: ${e.message}`); }
    finally { setGenBusy(false); }
  };

  if (!s || !personas) return <Spinner />;
  const weightSum = DIMS.reduce((a, d) => a + Number(s.weights[d] || 0), 0);

  const num = (path, key) => ({
    type: 'number',
    value: s[path][key],
    onChange: e => setS({ ...s, [path]: { ...s[path], [key]: e.target.value === '' ? '' : Number(e.target.value) } }),
    className: 'border border-slate-300 rounded-lg px-2 py-1 text-sm w-24',
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black text-slate-800">Settings</h1>
      {msg && <p className="text-sm text-emerald-700">{msg}</p>}

      <Card title="Scoring weights (re-normalised automatically — take effect immediately)">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {DIMS.map(d => (
            <label key={d} className="text-sm capitalize text-slate-600 flex items-center justify-between gap-2">
              {d}<input {...num('weights', d)} />
            </label>
          ))}
        </div>
        <p className={`text-xs mt-2 ${weightSum === 100 ? 'text-slate-400' : 'text-amber-600'}`}>
          Sum: {weightSum} {weightSum !== 100 && '(will be re-normalised to 100%)'}
        </p>
      </Card>

      <Card title="Readiness thresholds">
        <div className="grid sm:grid-cols-2 gap-3 text-sm text-slate-600">
          <label className="flex items-center justify-between gap-2">Readiness ≥ <input {...num('thresholds', 'readiness_min')} /></label>
          <label className="flex items-center justify-between gap-2">Accuracy ≥ <input {...num('thresholds', 'accuracy_min')} /></label>
          <label className="flex items-center justify-between gap-2">Max policy violations in window <input {...num('thresholds', 'max_violations')} /></label>
          <label className="flex items-center justify-between gap-2">Rolling window N (graded turns) <input {...num('thresholds', 'window_n')} /></label>
        </div>
      </Card>

      <Card title="LLM provider">
        <div className="flex flex-wrap gap-3 items-center text-sm">
          <select value={s.llm.provider} onChange={e => setS({ ...s, llm: { ...s.llm, provider: e.target.value } })}
            className="w-full min-w-0 border border-slate-300 rounded-lg px-3 py-1.5 bg-white sm:w-auto">
            <option value="auto">auto (prefer Anthropic → Groq → OpenAI → mock)</option>
            <option value="anthropic">Anthropic {s.keys.anthropic ? '✓ key set' : '(no key!)'}</option>
            <option value="groq">Groq {s.keys.groq ? '✓ key set' : '(no key!)'}</option>
            <option value="openai">OpenAI {s.keys.openai ? '✓ key set' : '(no key!)'}</option>
            <option value="mock">mock (no LLM — heuristic scoring)</option>
          </select>
          <input placeholder="model override (optional)" value={s.llm.model}
            onChange={e => setS({ ...s, llm: { ...s.llm, model: e.target.value } })}
            className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm sm:w-64" />
          <span className="text-xs text-slate-400">Currently active: {s.active_model}</span>
        </div>
        {!s.keys.anthropic && !s.keys.groq && !s.keys.openai && (
          <p className="text-xs text-amber-600 mt-2">⚠ No API key found in .env — the app runs in mock mode: heuristic scoring and scripted customers. Set ANTHROPIC_API_KEY, GROQ_API_KEY, or OPENAI_API_KEY and restart for real AI evaluation. (Note: embeddings still use OpenAI or the local fallback — Groq does not provide embeddings.)</p>
        )}
      </Card>

      <Card title="Quiz">
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
          <label className="flex items-center gap-2">Questions per round <input {...num('quiz', 'batch_size')} /></label>
          <Button variant="secondary" onClick={generateQuizzes} disabled={genBusy}>{genBusy ? 'Generating…' : '✨ Generate 10 new questions from KB'}</Button>
        </div>
      </Card>

      <Card title={`Personas (${personas.filter(p => p.is_active).length} active)`}>
        <div className="space-y-1">
          {personas.map(p => (
            <label key={p.id} className="flex items-center gap-2 text-sm py-1 border-b border-slate-50">
              <input type="checkbox" checked={!!p.is_active} onChange={() => togglePersona(p)} />
              <span className="font-medium">{p.name}</span>
              <span className="text-xs text-slate-400">{p.description}</span>
            </label>
          ))}
        </div>
      </Card>

      <Button onClick={save}>Save settings</Button>
    </div>
  );
}
