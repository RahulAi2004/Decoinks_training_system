// Scenarios — real customer questions from the ingested Q&A; graded vs the model best reply.
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Card, Spinner, Button } from '../../components/ui';
import Evaluation from '../../components/Evaluation';

export default function Scenarios() {
  const [intents, setIntents] = useState([]);
  const [intent, setIntent] = useState('');
  const [scenario, setScenario] = useState(null);
  const [reply, setReply] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api('/scenarios/intents').then(setIntents).catch(console.error); }, []);

  const load = async (chosenIntent = intent) => {
    setBusy(true); setResult(null); setReply('');
    try { setScenario(await api(`/scenarios/next${chosenIntent ? `?intent=${encodeURIComponent(chosenIntent)}` : ''}`)); }
    catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!reply.trim()) return;
    setBusy(true);
    try { setResult(await api(`/scenarios/${scenario.id}/attempt`, { method: 'POST', body: { reply } })); }
    catch (e2) { alert(e2.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black text-slate-800">Scenarios</h1>
      <p className="text-sm text-slate-500">A real customer question from Decoinks history. Write the best possible agent reply — you're graded against the actual best reply.</p>

      <div className="flex flex-wrap gap-2 items-center">
        <select value={intent} onChange={e => setIntent(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white">
          <option value="">All intents</option>
          {intents.map(i => <option key={i.intent} value={i.intent}>{i.intent} ({i.n})</option>)}
        </select>
        <Button onClick={() => load()} disabled={busy}>{scenario ? 'Next scenario' : 'Start'}</Button>
      </div>

      {busy && !scenario && <Spinner />}

      {scenario && (
        <Card title={`Customer question · ${scenario.intent || 'General'}${scenario.language === 'es' ? ' · Spanish 🇪🇸' : ''} · asked ${scenario.frequency}×`}>
          <p className="text-base font-medium text-slate-800 bg-slate-50 rounded-lg p-3 whitespace-pre-wrap">“{scenario.question}”</p>
          {!result && (
            <form onSubmit={submit} className="mt-3 space-y-2">
              <textarea value={reply} onChange={e => setReply(e.target.value)} rows={3} disabled={busy}
                placeholder="Write your best agent reply…"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              <Button disabled={busy || !reply.trim()}>{busy ? 'Grading…' : 'Submit for grading'}</Button>
            </form>
          )}
        </Card>
      )}

      {result && (
        <>
          <Card title="Your evaluation">
            <p className="text-xs text-slate-500 mb-2"><span className="font-semibold">Your reply:</span> {reply}</p>
            <Evaluation e={result.evaluation} />
          </Card>
          <Card title="The real 'best reply' this was graded against">
            <p className="text-sm whitespace-pre-wrap text-slate-700">{result.model_reply}</p>
          </Card>
          <Button onClick={() => load()}>Next scenario →</Button>
        </>
      )}
    </div>
  );
}
