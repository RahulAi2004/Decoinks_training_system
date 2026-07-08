import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../../api';
import { Card, Spinner, ReadyPill, ScoreBadge } from '../../components/ui';
import { DIMS } from '../../components/Evaluation';

const DIM_LABEL = {
  accuracy: 'Accuracy',
  completeness: 'Complete',
  tone: 'Tone',
  policy: 'Policy',
  language: 'Language',
  sales: 'Sales',
};

const BAR_COLORS = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0891b2'];

function scoreClass(v) {
  if (v >= 85) return 'text-emerald-700 bg-emerald-50 border-emerald-100';
  if (v >= 70) return 'text-amber-700 bg-amber-50 border-amber-100';
  return 'text-rose-700 bg-rose-50 border-rose-100';
}

function StatCard({ label, value, sub, tone = 'slate' }) {
  const tones = {
    slate: 'border-slate-200 bg-white text-slate-800',
    green: 'border-emerald-100 bg-emerald-50 text-emerald-800',
    amber: 'border-amber-100 bg-amber-50 text-amber-800',
    rose: 'border-rose-100 bg-rose-50 text-rose-800',
    blue: 'border-blue-100 bg-blue-50 text-blue-800',
  };
  return (
    <div className={`rounded-lg border p-4 ${tones[tone] || tones.slate}`}>
      <p className="text-3xl font-black leading-none">{value}</p>
      <p className="mt-1 text-sm font-semibold">{label}</p>
      {sub && <p className="mt-1 text-xs opacity-70">{sub}</p>}
    </div>
  );
}

function ProgressRing({ value, ready, total }) {
  const pct = Math.max(0, Math.min(100, total ? (ready / total) * 100 : 0));
  const data = [
    { name: 'Ready', value: ready },
    { name: 'Not ready', value: Math.max(0, total - ready) },
  ];
  return (
    <div className="relative h-56">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} innerRadius={66} outerRadius={88} dataKey="value" startAngle={90} endAngle={-270} paddingAngle={3}>
            <Cell fill="#059669" />
            <Cell fill="#e11d48" />
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <p className="text-4xl font-black text-slate-800">{Math.round(value || pct)}%</p>
        <p className="text-xs font-semibold uppercase text-slate-400">avg readiness</p>
        <p className="mt-1 text-xs text-slate-500">{ready}/{total} ready</p>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  useEffect(() => { api('/metrics/dashboard').then(setData).catch(console.error); }, []);

  const derived = useMemo(() => {
    if (!data) return null;
    const leaderboard = data.leaderboard || [];
    const active = leaderboard.filter(x => x.is_active !== 0);
    const atRisk = leaderboard.filter(x => !x.is_ready && (x.graded_turns || 0) > 0);
    const noActivity = leaderboard.filter(x => (x.graded_turns || 0) === 0);
    const violations = leaderboard.reduce((sum, x) => sum + Number(x.violations || 0), 0);
    const dims = DIMS.map((d, i) => ({ key: d, label: DIM_LABEL[d] || d, score: data.org_dimensions[d] || 0, fill: BAR_COLORS[i] }));
    const weakest = [...dims].sort((a, b) => a.score - b.score).slice(0, 3);
    const top = leaderboard[0];
    return { leaderboard, active, atRisk, noActivity, violations, dims, weakest, top };
  }, [data]);

  if (!data || !derived) return <Spinner />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-800">Admin Dashboard</h1>
          <p className="text-sm text-slate-500">Training health, readiness, scoring quality, and intern activity in one view.</p>
        </div>
        <div className={`rounded-lg border px-3 py-2 ${scoreClass(data.totals.avg_readiness || 0)}`}>
          <p className="text-xs font-semibold uppercase opacity-70">System status</p>
          <p className="text-sm font-bold">{data.totals.ready} ready · {Math.max(0, data.totals.interns - data.totals.ready)} in training</p>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-3">
        <StatCard label="Interns" value={data.totals.interns} sub={`${derived.active.length} active accounts`} tone="blue" />
        <StatCard label="Ready" value={data.totals.ready} sub={`${Math.max(0, data.totals.interns - data.totals.ready)} not ready`} tone="green" />
        <StatCard label="Avg readiness" value={`${data.totals.avg_readiness}%`} sub="weighted live score" tone={data.totals.avg_readiness >= 85 ? 'green' : data.totals.avg_readiness >= 70 ? 'amber' : 'rose'} />
        <StatCard label="Graded replies" value={data.totals.graded_replies} sub={`${derived.violations} violations flagged`} tone={derived.violations ? 'amber' : 'slate'} />
        <StatCard label="Practice sessions" value={data.totals.sessions} sub={`${derived.noActivity.length} interns need first turn`} />
      </div>

      <div className="grid xl:grid-cols-[0.9fr_1.2fr_0.9fr] gap-4">
        <Card title="Readiness Split">
          <ProgressRing value={data.totals.avg_readiness} ready={data.totals.ready} total={data.totals.interns} />
        </Card>

        <Card title="Score Trend">
          {data.org_trend.length < 2 ? <p className="text-sm text-slate-400 py-14 text-center">Not enough graded activity yet.</p> : (
            <ResponsiveContainer width="100%" height={224}>
              <LineChart data={data.org_trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="score" name="Average score" stroke="#2563eb" strokeWidth={3} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Needs Attention">
          <div className="space-y-3">
            <div className="rounded-lg border border-rose-100 bg-rose-50 p-3">
              <p className="text-2xl font-black text-rose-700">{derived.atRisk.length}</p>
              <p className="text-xs font-semibold text-rose-700">interns graded but not ready</p>
            </div>
            <div className="rounded-lg border border-amber-100 bg-amber-50 p-3">
              <p className="text-2xl font-black text-amber-700">{derived.noActivity.length}</p>
              <p className="text-xs font-semibold text-amber-700">interns with no graded replies</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <p className="text-xs font-semibold uppercase text-slate-400">Weakest dimensions</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {derived.weakest.map(d => <ScoreBadge key={d.key} label={d.label} value={d.score} />)}
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-4">
        <Card title="Dimension Averages">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={derived.dims} margin={{ top: 8, right: 8, bottom: 4, left: -18 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="score" radius={[5, 5, 0, 0]}>
                {derived.dims.map(d => <Cell key={d.key} fill={d.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Top Performer">
          {derived.top ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-black text-slate-800">{derived.top.name}</p>
                    <p className="text-xs text-slate-500">{derived.top.email}</p>
                  </div>
                  <ReadyPill ready={derived.top.is_ready} />
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <span className="text-4xl font-black text-slate-800">{Math.round(derived.top.readiness || 0)}</span>
                  <div>
                    <ScoreBadge value={derived.top.readiness} label="readiness" />
                    <p className="mt-1 text-xs text-slate-500">{derived.top.graded_turns} graded replies · {derived.top.violations} violations</p>
                  </div>
                </div>
              </div>
              <Link className="inline-flex rounded-lg bg-violet-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-800" to={`/admin/interns/${derived.top.id}`}>
                Open intern detail
              </Link>
            </div>
          ) : <p className="text-sm text-slate-400">No interns yet.</p>}
        </Card>
      </div>

      <Card title="Leaderboard">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 uppercase">
                <th className="py-2">Rank</th>
                <th>Intern</th>
                <th>Readiness</th>
                <th className="min-w-44">Progress</th>
                <th>Graded</th>
                <th>Violations</th>
                <th>Verdict</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {derived.leaderboard.map((u, i) => (
                <tr key={u.id} className="border-t border-slate-100">
                  <td className="py-3 font-black text-slate-400">#{i + 1}</td>
                  <td>
                    <p className="font-semibold text-slate-800">{u.name}</p>
                    <p className="text-xs text-slate-400">{u.email}</p>
                  </td>
                  <td><ScoreBadge value={u.readiness} /></td>
                  <td>
                    <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div className={`h-full ${u.readiness >= 85 ? 'bg-emerald-500' : u.readiness >= 70 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${Math.max(0, Math.min(100, u.readiness || 0))}%` }} />
                    </div>
                  </td>
                  <td className="text-slate-600">{u.graded_turns}</td>
                  <td className={u.violations ? 'text-rose-600 font-bold' : 'text-slate-500'}>{u.violations}</td>
                  <td><ReadyPill ready={u.is_ready} /></td>
                  <td><Link className="text-violet-600 text-xs font-medium hover:underline" to={`/admin/interns/${u.id}`}>Detail</Link></td>
                </tr>
              ))}
              {derived.leaderboard.length === 0 && (
                <tr><td colSpan="8" className="py-6 text-center text-sm text-slate-400">No interns yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
