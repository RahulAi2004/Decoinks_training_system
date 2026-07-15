import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
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
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // On phones the sidebar is a drawer — close it once you have navigated.
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  const isTrainer = user?.role === 'admin' && user?.access_level === 'trainer';
  const nav = user?.role !== 'admin'
    ? internNav
    : isTrainer ? adminNav.filter(([to]) => !OWNER_ONLY_PATHS.includes(to)) : adminNav;
  const roleLabel = user?.role === 'intern' ? 'Decoinks Agent' : isTrainer ? 'Trainer' : user?.role;

  return (
    <div className="min-h-screen lg:flex">
      {/* Phone top bar — the only way to reach the menu on a small screen. */}
      <header className="lg:hidden sticky top-0 z-30 flex items-center gap-3 bg-[#10151c] px-4 py-3 text-white">
        <button onClick={() => setMenuOpen(true)} aria-label="Open menu"
          className="-ml-1 rounded-lg px-2 py-1 text-2xl leading-none hover:bg-white/10">☰</button>
        <div className="min-w-0">
          <p className="truncate font-black leading-tight">Decoinks</p>
          <p className="text-[10px] uppercase tracking-wider text-violet-300">Training System</p>
        </div>
      </header>

      {menuOpen && (
        <div onClick={() => setMenuOpen(false)} aria-hidden="true"
          className="fixed inset-0 z-40 bg-black/50 lg:hidden" />
      )}

      {/* Drawer on phones, fixed column on desktop. */}
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-[#10151c] text-slate-300 transition-transform duration-200
        lg:static lg:z-auto lg:w-56 lg:shrink-0 lg:translate-x-0
        ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-start justify-between border-b border-white/10 px-4 py-5">
          <div>
            <p className="text-lg font-black leading-tight text-white">Decoinks</p>
            <p className="text-[11px] uppercase tracking-wider text-violet-300">Training System</p>
          </div>
          <button onClick={() => setMenuOpen(false)} aria-label="Close menu"
            className="rounded-lg px-2 text-xl leading-none text-slate-400 hover:bg-white/10 hover:text-white lg:hidden">✕</button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto py-3">
          {nav.map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={to === '/' || to === '/admin'}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-4 py-2.5 text-sm transition lg:py-2 ${isActive ? 'bg-violet-700 font-semibold text-white' : 'hover:bg-white/5'}`}>
              <span>{icon}</span>{label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/10 px-4 py-4 text-xs">
          <p className="truncate font-semibold text-white">{user?.name}</p>
          <p className="capitalize text-slate-400">{roleLabel}</p>
          <button onClick={logout} className="mt-2 text-violet-300 hover:text-white">Sign out</button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 max-w-6xl p-4 sm:p-6">
        <Outlet />
      </main>
    </div>
  );
}
