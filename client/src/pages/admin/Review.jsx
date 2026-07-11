// Reply Review — feed of intern replies with evaluator scores + rationale;
// admin can agree with or override each score.
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Card, Spinner, Button, ScoreBadge } from '../../components/ui';
import Evaluation from '../../components/Evaluation';

export default function Review() {
  const [interns, setInterns] = useState([]);
  const [filterIntern, setFilterIntern] = useState('');
  const [maxScore, setMaxScore] = useState('');
  const [feed, setFeed] = useState(null);
  const [override, setOverride] = useState({});   // evalId -> value being typed

  const load = async (internId = filterIntern, max = maxScore) => {
    setFeed(null);
    const params = new URLSearchParams();
    if (internId) params.set('intern_id', internId);
    if (max) params.set('max_overall', max);
    setFeed(await api(`/admin/review?${params}`));
  };
  useEffect(() => { api('/admin/interns').then(setInterns); load(); }, []);

  const verdict = async (e, v) => {
    await api(`/admin/review/${e.id}/verdict`, {
      method: 'POST',
      body: { verdict: v, override_overall: v === 'override' ? Number(override[e.id]) : undefined },
    });
    load();
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black text-slate-800">Reply Review</h1>
      <div className="flex flex-wrap gap-2 items-center">
        <select value={filterIntern} onChange={e => { setFilterIntern(e.target.value); load(e.target.value, maxScore); }}
          className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white">
          <option value="">All agents</option>
          {interns.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={maxScore} onChange={e => { setMaxScore(e.target.value); load(filterIntern, e.target.value); }}
          className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white">
          <option value="">Any score</option>
          <option value="70">Below 70 (weak replies)</option>
          <option value="50">Below 50 (bad replies)</option>
        </select>
      </div>

      {!feed ? <Spinner /> : feed.length === 0 ? <p className="text-sm text-slate-400">No graded replies match.</p> : (
        <div className="space-y-4">
          {feed.map(e => (
            <Card key={e.id}
              title={`${e.intern_name} · ${new Date(e.created_at + 'Z').toLocaleString()}`}
              action={e.admin_verdict
                ? <span className="text-xs font-bold text-slate-500">{e.admin_verdict === 'agree' ? '✓ agreed' : `overridden → ${e.admin_override_overall}`}</span>
                : null}>
              <Evaluation e={e} showContext />
              {!e.admin_verdict && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                  <Button variant="secondary" onClick={() => verdict(e, 'agree')}>✓ Agree with score</Button>
                  <input type="number" min="0" max="100" placeholder="New overall"
                    value={override[e.id] ?? ''} onChange={ev => setOverride({ ...override, [e.id]: ev.target.value })}
                    className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm w-28" />
                  <Button disabled={override[e.id] === undefined || override[e.id] === ''} onClick={() => verdict(e, 'override')}>Override</Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
