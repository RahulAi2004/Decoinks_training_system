import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { Card, Spinner, ReadyPill, ScoreBadge, ScoreBar } from '../../components/ui';
import { DIMS } from '../../components/Evaluation';

export default function Readiness() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api('/metrics/readiness').then(setRows).catch(console.error); }, []);
  if (!rows) return <Spinner />;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black text-slate-800">Readiness verdicts</h1>
      <p className="text-sm text-slate-500">Computed live from each intern's last {rows[0]?.thresholds?.window_n ?? 20} graded replies against the thresholds in Settings.</p>
      {rows.length === 0 && <p className="text-sm text-slate-400">No active interns.</p>}
      {rows.map(r => (
        <Card key={r.user.id}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-64">
              <p className="font-bold text-slate-800">{r.user.name} <ScoreBadge value={r.readiness_score} label="readiness" /></p>
              <p className="text-xs text-slate-400">{r.user.email} · {r.graded_turns} graded turns · {r.violation_count} violations in window</p>
              <ul className="text-xs text-slate-600 list-disc pl-4 mt-2 space-y-0.5">
                {r.reasons.map((x, i) => <li key={i}>{x}</li>)}
              </ul>
              <Link to={`/admin/interns/${r.user.id}`} className="text-violet-600 text-xs font-medium hover:underline">Full detail →</Link>
            </div>
            <div className="flex flex-col items-end gap-2">
              <ReadyPill ready={r.is_ready} />
              <div className="w-64 space-y-1">{DIMS.map(d => <ScoreBar key={d} label={d} value={r.dimension_scores[d]} />)}</div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
