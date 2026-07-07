import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { Button } from '../components/ui';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const user = await login(email, password);
      nav(user.role === 'admin' ? '/admin' : '/');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#10151c] px-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-8 space-y-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800">Decoinks</h1>
          <p className="text-sm text-slate-500">Decoinks_training_system</p>
        </div>
        <div className="space-y-3">
          <input className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" type="email" placeholder="Email"
            value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
          <div className="relative">
            <input className="w-full border border-slate-300 rounded-lg px-3 py-2 pr-16 text-sm" type={showPw ? 'text' : 'password'} placeholder="Password"
              value={password} onChange={e => setPassword(e.target.value)} required />
            <button type="button" onClick={() => setShowPw(v => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-violet-600 hover:text-violet-800 px-1">
              {showPw ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <Button className="w-full py-2" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
      </form>
    </div>
  );
}
