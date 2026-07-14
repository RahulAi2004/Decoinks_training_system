import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth';

const internNav = [
  ['/', 'Home', '🏠'],
  ['/study', 'Study', '📚'],
  ['/practice', 'Practice Chat', '💬'],
  ['/scenarios', 'Scenarios', '🎯'],
  ['/quiz', 'Quiz', '📝'],
  ['/progress', 'My Progress', '📈'],
];
const adminNav = [
  ['/admin', 'Dashboard', '📊'],
  ['/admin/ai-chat', 'Chat with AI', '💬'],
  ['/admin/manual', 'Trainer Chat', '✍️'],
  ['/admin/live', 'Live Training', '🎧'],
  ['/admin/conversations', 'Conversations', '🗂️'],
  ['/admin/prompts', 'AI Prompts', '🧩'],
  ['/admin/content', 'Content', '📂'],
  ['/admin/interns', 'Decoinks Agents', '👥'],
  ['/admin/review', 'Reply Review', '🔍'],
  ['/admin/readiness', 'Readiness', '✅'],
  ['/admin/settings', 'Settings', '⚙️'],
];

// A trainer (sub-admin) runs the training screens but not the app's config.
export const OWNER_ONLY_PATHS = ['/admin/prompts', '/admin/content', '/admin/settings'];

export default function Layout() {
  const { user, logout } = useAuth();
  const isTrainer = user?.role === 'admin' && user?.access_level === 'trainer';
  const nav = user?.role !== 'admin'
    ? internNav
    : isTrainer ? adminNav.filter(([to]) => !OWNER_ONLY_PATHS.includes(to)) : adminNav;
  const roleLabel = user?.role === 'intern' ? 'Decoinks Agent' : isTrainer ? 'Trainer' : user?.role;
  return (
    <div className="min-h-screen flex">
      <aside className="w-56 shrink-0 bg-[#10151c] text-slate-300 flex flex-col">
        <div className="px-4 py-5 border-b border-white/10">
          <p className="font-black text-white text-lg leading-tight">Decoinks</p>
          <p className="text-[11px] uppercase tracking-wider text-violet-300">Training System</p>
        </div>
        <nav className="flex-1 py-3 space-y-0.5">
          {nav.map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={to === '/' || to === '/admin'}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-4 py-2 text-sm transition ${isActive ? 'bg-violet-700 text-white font-semibold' : 'hover:bg-white/5'}`}>
              <span>{icon}</span>{label}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-4 border-t border-white/10 text-xs">
          <p className="font-semibold text-white truncate">{user?.name}</p>
          <p className="text-slate-400 capitalize">{roleLabel}</p>
          <button onClick={logout} className="mt-2 text-violet-300 hover:text-white">Sign out</button>
        </div>
      </aside>
      <main className="flex-1 min-w-0 p-6 max-w-6xl">
        <Outlet />
      </main>
    </div>
  );
}
