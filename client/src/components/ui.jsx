// Small shared UI primitives
// min-w-0: as a grid/flex item a Card defaults to min-width:auto, so one long
// unbreakable line inside (a truncated name, a wide select) would push the whole
// page sideways on a phone instead of the text simply truncating.
export function Card({ title, action, children, className = '' }) {
  return (
    <div className={`min-w-0 bg-white rounded-xl shadow-sm border border-slate-200 ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-slate-100">
          <h3 className="font-semibold text-slate-700 text-sm">{title}</h3>
          {action}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

export function scoreColor(v) {
  if (v == null) return 'bg-slate-200 text-slate-500';
  if (v >= 85) return 'bg-emerald-100 text-emerald-700';
  if (v >= 70) return 'bg-amber-100 text-amber-700';
  return 'bg-rose-100 text-rose-700';
}

export function ScoreBadge({ value, label }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${scoreColor(value)}`}>
      {label && <span className="font-normal opacity-70">{label}</span>}
      {value == null ? '—' : Math.round(value)}
    </span>
  );
}

export function ScoreBar({ label, value }) {
  const v = Math.round(value ?? 0);
  const color = v >= 85 ? 'bg-emerald-500' : v >= 70 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-28 shrink-0 capitalize text-slate-500">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${v}%` }} />
      </div>
      <span className="w-8 text-right font-semibold text-slate-600">{v}</span>
    </div>
  );
}

export function Spinner({ text = 'Loading…' }) {
  return (
    <div className="flex items-center gap-2 text-slate-400 text-sm py-6 justify-center">
      <span className="h-4 w-4 rounded-full border-2 border-slate-300 border-t-violet-600 animate-spin" />
      {text}
    </div>
  );
}

export function ReadyPill({ ready }) {
  return ready
    ? <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-600 text-white">READY</span>
    : <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-rose-600 text-white">NOT READY</span>;
}

export function Button({ children, variant = 'primary', className = '', ...props }) {
  const styles = {
    primary: 'bg-violet-700 hover:bg-violet-800 text-white',
    secondary: 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-300',
    danger: 'bg-rose-600 hover:bg-rose-700 text-white',
  };
  return (
    <button className={`px-3 py-1.5 rounded-lg text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${styles[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}
