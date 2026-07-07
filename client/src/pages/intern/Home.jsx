import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { Card, Spinner, ReadyPill, ScoreBar } from '../../components/ui';
import { DIMS } from '../../components/Evaluation';
import { useAuth } from '../../auth';

export default function Home() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  useEffect(() => { api('/metrics/me').then(setStats).catch(console.error); }, []);
  if (!stats) return <Spinner />;

  const r = stats.readiness;
  const next =
    stats.volume.sessions === 0 ? { to: '/study', label: 'Start with the Study material', icon: '📚' } :
    r.dimension_scores.accuracy < 70 ? { to: '/quiz', label: 'Sharpen your facts with a Quiz', icon: '📝' } :
    stats.volume.scenarios < 5 ? { to: '/scenarios', label: 'Answer real customer Scenarios', icon: '🎯' } :
    { to: '/practice', label: 'Do a Practice Chat session', icon: '💬' };

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-800">Welcome back, {user?.name?.split(' ')[0]} 👋</h1>
          <p className="text-sm text-slate-500">Train until you're ready to talk to real Decoinks customers.</p>
        </div>
        <ReadyPill ready={r.is_ready} />
      </div>

      <Card>
        <div className="flex items-center gap-4">
          <div className="relative h-24 w-24 shrink-0">
            <svg viewBox="0 0 36 36" className="h-24 w-24 -rotate-90">
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e2e8f0" strokeWidth="3.5" />
              <circle cx="18" cy="18" r="15.9" fill="none" stroke={r.readiness_score >= 85 ? '#059669' : r.readiness_score >= 70 ? '#d97706' : '#e11d48'}
                strokeWidth="3.5" strokeDasharray={`${r.readiness_score} 100`} strokeLinecap="round" />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center font-black text-xl text-slate-700">
              {Math.round(r.readiness_score)}%
            </span>
          </div>
          <div className="flex-1">
            <p className="font-semibold text-slate-700 mb-1">Readiness — rolling average of your last {r.thresholds.window_n} graded replies</p>
            <ul className="text-xs text-slate-500 list-disc pl-4 space-y-0.5">
              {r.reasons.map((x, i) => <li key={i}>{x}</li>)}
            </ul>
          </div>
        </div>
      </Card>

      <Link to={next.to} className="block bg-violet-700 hover:bg-violet-800 text-white rounded-xl p-4 transition">
        <p className="text-xs uppercase tracking-wide opacity-70">Next recommended activity</p>
        <p className="font-bold text-lg">{next.icon} {next.label} →</p>
      </Link>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[['Practice sessions', stats.volume.sessions], ['Scenarios answered', stats.volume.scenarios],
          ['Quiz answers', stats.volume.quizzes], ['Graded replies', stats.volume.graded_replies]].map(([l, v]) => (
          <Card key={l}><p className="text-2xl font-black text-slate-800">{v}</p><p className="text-xs text-slate-500">{l}</p></Card>
        ))}
      </div>

      <Card title="Your dimension scores (rubric)">
        <div className="space-y-2">{DIMS.map(d => <ScoreBar key={d} label={d} value={r.dimension_scores[d]} />)}</div>
      </Card>
    </div>
  );
}
