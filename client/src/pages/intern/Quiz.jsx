import { useState } from 'react';
import { api } from '../../api';
import { Card, Spinner, Button } from '../../components/ui';

export default function Quiz() {
  const [round, setRound] = useState(null);
  const [idx, setIdx] = useState(0);
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      const r = await api('/quizzes/round');
      if (!r.length) { alert('No quiz questions yet — ask your admin to generate some.'); return; }
      setRound(r); setIdx(0); setResults([]); setFeedback(null); setAnswer('');
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };

  const submit = async (chosen) => {
    const a = chosen ?? answer;
    if (!a.trim()) return;
    setBusy(true);
    try {
      const r = await api(`/quizzes/${round[idx].id}/attempt`, { method: 'POST', body: { answer: a } });
      setFeedback(r);
      setResults(rs => [...rs, { q: round[idx].question, ...r }]);
    } catch (e) { alert(e.message); }
    finally { setBusy(false); }
  };

  const next = () => { setIdx(i => i + 1); setFeedback(null); setAnswer(''); };

  if (!round) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-black text-slate-800">Quiz</h1>
        <p className="text-sm text-slate-500">MCQ and short-answer questions generated from the Decoinks knowledge base — MOQ, pricing, turnaround, shipping, payment, policies.</p>
        <Button onClick={start} disabled={busy}>{busy ? 'Loading…' : 'Start a quiz round'}</Button>
      </div>
    );
  }

  if (idx >= round.length) {
    const correct = results.filter(r => r.is_correct).length;
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-black text-slate-800">Round complete 🎉</h1>
        <Card>
          <p className="text-3xl font-black text-slate-800">{correct} / {results.length}</p>
          <p className="text-sm text-slate-500">correct · average score {Math.round(results.reduce((a, r) => a + (r.score || 0), 0) / (results.length || 1))}</p>
        </Card>
        <Card title="Review">
          <ul className="space-y-2 text-sm">
            {results.map((r, i) => (
              <li key={i} className="border-b border-slate-100 pb-2">
                <p className="font-medium">{r.is_correct ? '✅' : '❌'} {r.q}</p>
                <p className="text-xs text-slate-500">{r.feedback}</p>
              </li>
            ))}
          </ul>
        </Card>
        <Button onClick={start}>Another round</Button>
      </div>
    );
  }

  const q = round[idx];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black text-slate-800">Quiz</h1>
        <span className="text-sm text-slate-500">Question {idx + 1} of {round.length}</span>
      </div>
      <Card>
        <p className="font-semibold text-slate-800 mb-3">{q.question}</p>
        {q.type === 'mcq' ? (
          <div className="space-y-2">
            {q.options.map(opt => {
              const chosen = feedback && results[results.length - 1]?.q === q.question;
              const isCorrect = feedback && opt === feedback.correct_answer;
              return (
                <button key={opt} disabled={busy || !!feedback} onClick={() => submit(opt)}
                  className={`w-full text-left border rounded-lg px-3 py-2 text-sm transition
                    ${isCorrect ? 'border-emerald-500 bg-emerald-50' : chosen ? 'border-slate-300' : 'border-slate-200 bg-white hover:border-violet-400'}`}>
                  {opt}
                </button>
              );
            })}
          </div>
        ) : !feedback && (
          <form onSubmit={e => { e.preventDefault(); submit(); }} className="space-y-2">
            <input value={answer} onChange={e => setAnswer(e.target.value)} disabled={busy} autoFocus
              placeholder="Type your answer…" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            <Button disabled={busy || !answer.trim()}>{busy ? 'Grading…' : 'Submit'}</Button>
          </form>
        )}
        {feedback && (
          <div className={`mt-3 rounded-lg p-3 text-sm ${feedback.is_correct ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
            <p className="font-bold">{feedback.is_correct ? 'Correct!' : 'Not quite.'} <span className="font-normal">{feedback.feedback}</span></p>
            {feedback.source && <p className="text-xs mt-1 opacity-70">Source: {feedback.source}</p>}
            <Button className="mt-2" onClick={next}>Next →</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
