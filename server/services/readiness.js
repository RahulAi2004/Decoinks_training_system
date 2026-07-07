// Readiness computation (§5): rolling average of overall over the last N graded turns,
// READY when readiness >= threshold AND accuracy >= threshold AND no policy violations
// in the window. All thresholds live in settings and apply immediately.
import db, { uuid, getSetting, DEFAULT_SETTINGS } from '../db.js';
import { DIMENSIONS } from './evaluator.js';

export function computeReadiness(internId, { snapshot = false } = {}) {
  const t = { ...DEFAULT_SETTINGS.thresholds, ...(getSetting('thresholds') || {}) };
  const N = Number(t.window_n) || 20;

  const rows = db.prepare(
    `SELECT accuracy, completeness, tone, policy, language, sales, overall, violations,
            admin_verdict, admin_override_overall
     FROM evaluations WHERE intern_id = ? ORDER BY created_at DESC LIMIT ?`
  ).all(internId, N);

  const effectiveOverall = r =>
    r.admin_verdict === 'override' && r.admin_override_overall != null ? r.admin_override_overall : r.overall;

  const gradedTurns = rows.length;
  const avg = arr => arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : 0;

  const readiness = avg(rows.map(effectiveOverall));
  const dims = {};
  for (const d of DIMENSIONS) dims[d] = avg(rows.map(r => r[d]).filter(x => x != null));
  const violationCount = rows.reduce((n, r) => {
    try { return n + (JSON.parse(r.violations || '[]').length); } catch { return n; }
  }, 0);

  const reasons = [];
  if (gradedTurns < Math.min(10, N)) reasons.push(`Only ${gradedTurns} graded turn(s) — need at least ${Math.min(10, N)} for a reliable verdict.`);
  if (readiness < t.readiness_min) reasons.push(`Readiness ${readiness} is below the required ${t.readiness_min}.`);
  if (dims.accuracy < t.accuracy_min) reasons.push(`Accuracy ${dims.accuracy} is below the required ${t.accuracy_min}.`);
  if (violationCount > t.max_violations) reasons.push(`${violationCount} policy violation(s) in the last ${N} turns (max allowed: ${t.max_violations}).`);
  const isReady = reasons.length === 0 && gradedTurns >= Math.min(10, N);
  if (isReady) reasons.push(`Readiness ${readiness} ≥ ${t.readiness_min}, accuracy ${dims.accuracy} ≥ ${t.accuracy_min}, ${violationCount} violations over the last ${gradedTurns} turns.`);

  const result = {
    intern_id: internId, readiness_score: readiness, dimension_scores: dims,
    graded_turns: gradedTurns, violation_count: violationCount,
    is_ready: isReady, reasons, thresholds: t,
  };

  if (snapshot && gradedTurns > 0) {
    db.prepare(`INSERT INTO readiness_snapshots (id, intern_id, readiness_score, dimension_scores, is_ready, reasons) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(uuid(), internId, readiness, JSON.stringify(dims), isReady ? 1 : 0, JSON.stringify(reasons));
  }
  return result;
}

// Weak areas: lowest-scoring intents/personas for an intern
export function weakAreas(internId) {
  const byIntent = db.prepare(
    `SELECT s.intent AS label, AVG(e.overall) AS avg_score, COUNT(*) AS n
     FROM evaluations e JOIN scenario_attempts sa ON sa.id = e.scenario_attempt_id
     JOIN scenarios s ON s.id = sa.scenario_id
     WHERE e.intern_id = ? GROUP BY s.intent HAVING n >= 1 ORDER BY avg_score ASC LIMIT 5`
  ).all(internId);
  const byPersona = db.prepare(
    `SELECT p.name AS label, AVG(e.overall) AS avg_score, COUNT(*) AS n
     FROM evaluations e JOIN session_messages m ON m.id = e.session_message_id
     JOIN practice_sessions ps ON ps.id = m.session_id
     JOIN personas p ON p.id = ps.persona_id
     WHERE e.intern_id = ? GROUP BY p.id HAVING n >= 1 ORDER BY avg_score ASC LIMIT 5`
  ).all(internId);
  return {
    intents: byIntent.map(r => ({ ...r, avg_score: +r.avg_score.toFixed(1) })),
    personas: byPersona.map(r => ({ ...r, avg_score: +r.avg_score.toFixed(1) })),
  };
}
