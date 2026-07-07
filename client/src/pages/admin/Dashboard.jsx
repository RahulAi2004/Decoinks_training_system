import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { api } from '../../api';
import { Card, Spinner, ReadyPill, ScoreBadge, ScoreBar } from '../../components/ui';
import { DIMS } from '../../components/Evaluation';

export default function Dashboard() {
  const [data, setData] = useState(null);
  useEffect(() => { api('/metrics/dashboard').then(setData).catch(console.error); }, []);
  if (!data) return <Spinner />;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black text-slate-800">Metrics Dashboard</h1>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[['Interns', data.totals.interns], ['Ready', data.totals.ready], ['Avg readiness', `${data.totals.avg_readiness}%`],
          ['Graded replies', data.totals.graded_replies], ['Practice sessions', data.totals.sessions]].map(([l, v]) => (
          <Card key={l}><p className="text-2xl font-black text-slate-800">{v}</p><p className="text-xs text-slate-500">{l}</p></Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Org-wide score trend">
          {data.org_trend.length < 2 ? <p className="text-sm text-slate-400">Not enough graded activity yet.</p> : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={data.org_trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="score" stroke="#6d28d9" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>
        <Card title="Org-wide dimension averages">
          <div className="space-y-2">{DIMS.map(d => <ScoreBar key={d} label={d} value={data.org_dimensions[d]} />)}</div>
        </Card>
      </div>

      <Card title="Leaderboard — ranked by readiness">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-400 uppercase">
              <th className="py-1">#</th><th>Intern</th><th>Readiness</th><th>Graded</th><th>Violations</th><th>Verdict</th><th></th>
            </tr>
          </thead>
          <tbody>
            {data.leaderboard.map((u, i) => (
              <tr key={u.id} className="border-t border-slate-100">
                <td className="py-2 font-bold text-slate-400">{i + 1}</td>
                <td><p className="font-medium">{u.name}</p><p className="text-xs text-slate-400">{u.email}</p></td>
                <td><ScoreBadge value={u.readiness} /></td>
                <td className="text-slate-500">{u.graded_turns}</td>
                <td className={u.violations ? 'text-rose-600 font-bold' : 'text-slate-500'}>{u.violations}</td>
                <td><ReadyPill ready={u.is_ready} /></td>
                <td><Link className="text-violet-600 text-xs font-medium hover:underline" to={`/admin/interns/${u.id}`}>Detail →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
