import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { Card, Spinner, Button } from '../../components/ui';

export default function Interns() {
  const [list, setList] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [err, setErr] = useState('');

  const load = () => api('/admin/interns').then(setList).catch(console.error);
  useEffect(() => { load(); }, []);

  const invite = async (e) => {
    e.preventDefault(); setErr('');
    try {
      await api('/admin/interns', { method: 'POST', body: form });
      setForm({ name: '', email: '', password: '' });
      load();
    } catch (e2) { setErr(e2.message); }
  };

  const toggle = async (u) => {
    await api(`/admin/interns/${u.id}`, { method: 'PATCH', body: { is_active: !u.is_active } });
    load();
  };

  if (!list) return <Spinner />;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black text-slate-800">Interns</h1>

      <Card title="Invite an intern">
        <form onSubmit={invite} className="flex flex-wrap gap-2 items-center">
          <input required placeholder="Full name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
          <input required type="email" placeholder="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
          <input required placeholder="Temp password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
          <Button>Invite</Button>
          {err && <span className="text-sm text-rose-600">{err}</span>}
        </form>
      </Card>

      <Card title={`All interns (${list.length})`}>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-400 uppercase"><th className="py-1">Intern</th><th>Last active</th><th>Status</th><th></th><th></th></tr></thead>
          <tbody>
            {list.map(u => (
              <tr key={u.id} className="border-t border-slate-100">
                <td className="py-2"><p className="font-medium">{u.name}</p><p className="text-xs text-slate-400">{u.email}</p></td>
                <td className="text-xs text-slate-500">{u.last_login ? new Date(u.last_login + 'Z').toLocaleString() : 'never'}</td>
                <td>{u.is_active ? <span className="text-emerald-600 text-xs font-bold">active</span> : <span className="text-slate-400 text-xs font-bold">deactivated</span>}</td>
                <td><Button variant="secondary" onClick={() => toggle(u)}>{u.is_active ? 'Deactivate' : 'Activate'}</Button></td>
                <td><Link className="text-violet-600 text-xs font-medium hover:underline" to={`/admin/interns/${u.id}`}>Detail →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
