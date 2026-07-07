import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { api } from '../../api';
import { Card, Spinner, ReadyPill, ScoreBar } from '../../components/ui';
import { DIMS } from '../../components/Evaluation';

export default function Progress() {
  const [stats, setStats] = useState(null);
  useEffect(() => { api('/metrics/me').then(setStats).catch(console.error); }, []);
  if (!stats) return <Spinner />;
  const r = stats.readiness;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black text-slate-800">My Progress</h1>
        <ReadyPill ready={r.is_ready} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card><p className="text-2xl font-black">{Math.round(r.readiness_score)}%</p><p className="text-xs text-slate-500">Readiness (last {r.thresholds.window_n} replies)</p></Card>
        <Card><p className="text-2xl font-black">{stats.quiz.pass_rate}%</p><p className="text-xs text-slate-500">Quiz pass rate (avg {stats.quiz.avg_score})</p></Card>
        <Card><p className="text-2xl font-black">{r.violation_count}</p><p className="text-xs text-slate-500">Policy violations in window</p></Card>
        <Card><p className="text-2xl font-black">{stats.response_stats.avg_reply_length}</p><p className="text-xs text-slate-500">Avg reply length (chars)</p></Card>
      </div>

      <Card title="Score over time">
        {stats.trend.length < 2 ? <p className="text-sm text-slate-400">Complete more graded activities to see your trend.</p> : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={stats.trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="score" stroke="#6d28d9" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Per-dimension scores">
          <div className="space-y-2">{DIMS.map(d => <ScoreBar key={d} label={d} value={r.dimension_scores[d]} />)}</div>
        </Card>
        <Card title="Weak areas — focus your training here">
          {stats.weak_areas.intents.length === 0 && stats.weak_areas.personas.length === 0 ? (
            <p className="text-sm text-slate-400">Not enough data yet.</p>
          ) : (
            <div className="space-y-3 text-sm">
              {stats.weak_areas.intents.length > 0 && <div>
                <p className="text-xs font-bold text-slate-500 uppercase mb-1">By question intent</p>
                {stats.weak_areas.intents.map(w => <ScoreBar key={w.label} label={w.label || 'General'} value={w.avg_score} />)}
              </div>}
              {stats.weak_areas.personas.length > 0 && <div>
                <p className="text-xs font-bold text-slate-500 uppercase mb-1">By customer persona</p>
                {stats.weak_areas.personas.map(w => <ScoreBar key={w.label} label={w.label} value={w.avg_score} />)}
              </div>}
            </div>
          )}
        </Card>
      </div>

      {stats.violations.recent.length > 0 && (
        <Card title="Recent policy violations">
          <ul className="text-xs text-rose-700 list-disc pl-4 space-y-1">
            {stats.violations.recent.map((v, i) => <li key={i}>{v}</li>)}
          </ul>
        </Card>
      )}

      <Card title="Readiness verdict">
        <ul className="text-sm text-slate-600 list-disc pl-4 space-y-1">{r.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>
      </Card>
    </div>
  );
}
