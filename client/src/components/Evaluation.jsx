// Renders one evaluation scorecard: per-dimension bars, rationale, violations, ideal reply.
import { ScoreBar, ScoreBadge } from './ui';

export const DIMS = ['accuracy', 'completeness', 'tone', 'policy', 'language', 'sales'];

export default function Evaluation({ e, showContext = false }) {
  if (!e) return null;
  return (
    <div className="space-y-3">
      {showContext && e.context?.customerText && (
        <div className="text-xs space-y-1">
          <p><span className="font-semibold text-slate-500">Customer:</span> {e.context.customerText}</p>
          <p><span className="font-semibold text-slate-500">Intern:</span> {e.context.internReply}</p>
        </div>
      )}
      <div className="flex items-center gap-2">
        <ScoreBadge value={e.overall} label="overall" />
        <span className="text-[11px] text-slate-400">evaluated by {e.evaluator_model}</span>
      </div>
      <div className="space-y-1.5">
        {DIMS.map(d => <ScoreBar key={d} label={d} value={e[d]} />)}
      </div>
      {e.rationale && (
        <details className="text-xs text-slate-600">
          <summary className="cursor-pointer font-medium text-slate-500">Rationale per dimension</summary>
          <ul className="mt-1 space-y-1 list-disc pl-4">
            {DIMS.map(d => e.rationale[d] && <li key={d}><span className="capitalize font-semibold">{d}:</span> {e.rationale[d]}</li>)}
          </ul>
        </details>
      )}
      {e.violations?.length > 0 && (
        <div className="text-xs bg-rose-50 border border-rose-200 rounded-lg p-2 text-rose-700">
          <p className="font-bold mb-1">⚠ Policy violations</p>
          <ul className="list-disc pl-4">{e.violations.map((v, i) => <li key={i}>{v}</li>)}</ul>
        </div>
      )}
      {e.ideal_reply && (
        <div className="text-xs bg-emerald-50 border border-emerald-200 rounded-lg p-2">
          <p className="font-bold text-emerald-700 mb-1">✓ Ideal reply</p>
          <p className="text-emerald-900 whitespace-pre-wrap">{e.ideal_reply}</p>
        </div>
      )}
    </div>
  );
}
