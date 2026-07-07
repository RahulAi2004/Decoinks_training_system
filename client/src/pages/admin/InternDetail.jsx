import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { api } from '../../api';
import { Card, Spinner, ReadyPill, ScoreBadge, ScoreBar } from '../../components/ui';
import { DIMS } from '../../components/Evaluation';

export default function InternDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [transcript, setTranscript] = useState(null);

  useEffect(() => { api(`/metrics/interns/${id}`).then(setData).catch(console.error); }, [id]);

  const openTranscript = async (sessionId) => {
    setTranscript(await api(`/metrics/sessions/${sessionId}/transcript`));
  };

  if (!data) return <Spinner />;
  const { user, stats } = data;
  const r = stats.readiness;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-800">{user.name}</h1>
          <p className="text-sm text-slate-500">{user.email} · joined {new Date(user.created_at + 'Z').toLocaleDateString()}</p>
        </div>
        <div className="flex items-center gap-3">
          <ScoreBadge value={r.readiness_score} label="readiness" />
          <ReadyPill ready={r.is_ready} />
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Score trend">
          {stats.trend.length < 2 ? <p className="text-sm text-slate-400">Not enough data.</p> : (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={stats.trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} /><YAxis domain={[0, 100]} tick={{ fontSize: 11 }} /><Tooltip />
                <Line type="monotone" dataKey="score" stroke="#6d28d9" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>
        <Card title="Dimensions">
          <div className="space-y-2">{DIMS.map(d => <ScoreBar key={d} label={d} value={r.dimension_scores[d]} />)}</div>
        </Card>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card><p className="text-xl font-black">{stats.volume.sessions}</p><p className="text-xs text-slate-500">Practice sessions</p></Card>
        <Card><p className="text-xl font-black">{stats.volume.scenarios}</p><p className="text-xs text-slate-500">Scenarios</p></Card>
        <Card><p className="text-xl font-black">{stats.quiz.pass_rate}%</p><p className="text-xs text-slate-500">Quiz pass rate</p></Card>
        <Card><p className="text-xl font-black text-rose-600">{stats.violations.count}</p><p className="text-xs text-slate-500">Policy violations (all time)</p></Card>
      </div>

      {stats.violations.recent.length > 0 && (
        <Card title="Policy-violation log (recent)">
          <ul className="text-xs text-rose-700 list-disc pl-4 space-y-1">{stats.violations.recent.map((v, i) => <li key={i}>{v}</li>)}</ul>
        </Card>
      )}

      <Card title="Practice sessions">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-400 uppercase"><th className="py-1">Started</th><th>Persona</th><th>Status</th><th>Score</th><th></th></tr></thead>
          <tbody>
            {data.sessions.map(s => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="py-1.5 text-xs text-slate-500">{new Date(s.started_at + 'Z').toLocaleString()}</td>
                <td>{s.persona_name || '—'}</td>
                <td className="text-xs">{s.status}</td>
                <td><ScoreBadge value={s.overall_score} /></td>
                <td><button onClick={() => openTranscript(s.id)} className="text-violet-600 text-xs font-medium hover:underline">Transcript</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {transcript && (
        <Card title={`Transcript — ${transcript.session.persona_name || 'session'}`}
          action={<button onClick={() => setTranscript(null)} className="text-xs text-slate-400 hover:text-slate-600">✕ close</button>}>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {transcript.messages.map(m => {
              const ev = transcript.evaluations.find(e => e.session_message_id === m.id);
              return (
                <div key={m.id} className={`flex ${m.role === 'intern' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] rounded-xl px-3 py-1.5 text-sm ${m.role === 'intern' ? 'bg-violet-100' : 'bg-slate-100'}`}>
                    <p className="whitespace-pre-wrap">{m.body}</p>
                    {ev && <p className="mt-1"><ScoreBadge value={ev.overall} label="turn" /> {ev.violations.length > 0 && <span className="text-[10px] text-rose-600 font-bold">⚠ {ev.violations.length} violation(s)</span>}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card title="Scenario attempts">
        <table className="w-full text-sm">
          <tbody>
            {data.scenario_attempts.map(a => (
              <tr key={a.id} className="border-t border-slate-100">
                <td className="py-1.5 text-xs text-slate-500 w-32">{new Date(a.created_at + 'Z').toLocaleDateString()}</td>
                <td><p className="text-xs text-slate-400">{a.intent}</p><p>{a.question}</p><p className="text-xs text-slate-500 italic">→ {a.reply}</p></td>
                <td><ScoreBadge value={a.overall_score} /></td>
              </tr>
            ))}
            {data.scenario_attempts.length === 0 && <tr><td className="text-sm text-slate-400 py-2">None yet.</td></tr>}
          </tbody>
        </table>
      </Card>

      <Card title="Quiz attempts">
        <table className="w-full text-sm">
          <tbody>
            {data.quiz_attempts.map(a => (
              <tr key={a.id} className="border-t border-slate-100">
                <td className="py-1.5 w-6">{a.is_correct ? '✅' : '❌'}</td>
                <td>{a.question}<p className="text-xs text-slate-500 italic">answered: {a.answer}</p></td>
                <td><ScoreBadge value={a.score} /></td>
              </tr>
            ))}
            {data.quiz_attempts.length === 0 && <tr><td className="text-sm text-slate-400 py-2">None yet.</td></tr>}
          </tbody>
        </table>
      </Card>

      <p><Link to="/admin/review" className="text-violet-600 text-sm font-medium hover:underline">Review this intern's replies with full rationale →</Link></p>
    </div>
  );
}
