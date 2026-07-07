// Metrics: intern self-progress + admin org-wide dashboard, leaderboard, readiness.
import { Router } from 'express';
import db from '../db.js';
import { adminOnly } from '../auth.js';
import { computeReadiness, weakAreas } from '../services/readiness.js';
import { DIMENSIONS } from '../services/evaluator.js';

const r = Router();

function internStats(internId) {
  const readiness = computeReadiness(internId);
  const volume = {
    sessions: db.prepare('SELECT COUNT(*) n FROM practice_sessions WHERE intern_id = ?').get(internId).n,
    scenarios: db.prepare('SELECT COUNT(*) n FROM scenario_attempts WHERE intern_id = ?').get(internId).n,
    quizzes: db.prepare('SELECT COUNT(*) n FROM quiz_attempts WHERE intern_id = ?').get(internId).n,
    graded_replies: db.prepare('SELECT COUNT(*) n FROM evaluations WHERE intern_id = ?').get(internId).n,
  };
  const quiz = db.prepare('SELECT AVG(score) avg_score, AVG(is_correct)*100 pass_rate FROM quiz_attempts WHERE intern_id = ?').get(internId);
  const trend = db.prepare(
    `SELECT date(created_at) day, AVG(overall) score, COUNT(*) n
     FROM evaluations WHERE intern_id = ? GROUP BY day ORDER BY day`
  ).all(internId).map(x => ({ ...x, score: +(x.score || 0).toFixed(1) }));
  const respStats = db.prepare(
    `SELECT AVG(LENGTH(m.body)) avg_len FROM session_messages m
     JOIN practice_sessions ps ON ps.id = m.session_id
     WHERE ps.intern_id = ? AND m.role = 'intern'`
  ).get(internId);
  const avgTurns = db.prepare(
    `SELECT AVG(c) avg_turns FROM (
       SELECT COUNT(*) c FROM session_messages m
       JOIN practice_sessions ps ON ps.id = m.session_id
       WHERE ps.intern_id = ? AND m.role='intern' AND ps.status='ended' GROUP BY ps.id)`
  ).get(internId);
  const violations = db.prepare('SELECT violations FROM evaluations WHERE intern_id = ?').all(internId)
    .flatMap(x => { try { return JSON.parse(x.violations || '[]'); } catch { return []; } });

  return {
    readiness, volume,
    quiz: { avg_score: +(quiz.avg_score || 0).toFixed(1), pass_rate: +(quiz.pass_rate || 0).toFixed(1) },
    trend,
    weak_areas: weakAreas(internId),
    response_stats: { avg_reply_length: Math.round(respStats.avg_len || 0), avg_turns_per_session: +(avgTurns.avg_turns || 0).toFixed(1) },
    violations: { count: violations.length, recent: violations.slice(-10) },
  };
}

// intern: own progress
r.get('/me', (req, res) => res.json(internStats(req.user.id)));

// admin: per-intern detail
r.get('/interns/:id', adminOnly, (req, res) => {
  const user = db.prepare('SELECT id, name, email, role, is_active, last_login, created_at FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const stats = internStats(req.params.id);
  const sessions = db.prepare(
    `SELECT ps.*, p.name persona_name FROM practice_sessions ps LEFT JOIN personas p ON p.id = ps.persona_id
     WHERE ps.intern_id = ? ORDER BY ps.started_at DESC LIMIT 50`
  ).all(req.params.id);
  const scenarioAttempts = db.prepare(
    `SELECT sa.*, s.question, s.intent FROM scenario_attempts sa JOIN scenarios s ON s.id = sa.scenario_id
     WHERE sa.intern_id = ? ORDER BY sa.created_at DESC LIMIT 50`
  ).all(req.params.id);
  const quizAttempts = db.prepare(
    `SELECT qa.*, q.question, q.type FROM quiz_attempts qa JOIN quizzes q ON q.id = qa.quiz_id
     WHERE qa.intern_id = ? ORDER BY qa.created_at DESC LIMIT 50`
  ).all(req.params.id);
  res.json({ user, stats, sessions, scenario_attempts: scenarioAttempts, quiz_attempts: quizAttempts });
});

// admin: dashboard + leaderboard
r.get('/dashboard', adminOnly, (req, res) => {
  const interns = db.prepare(`SELECT id, name, email, is_active, last_login FROM users WHERE role = 'intern'`).all();
  const rows = interns.map(u => {
    const rd = computeReadiness(u.id);
    return {
      ...u,
      readiness: rd.readiness_score, is_ready: rd.is_ready, graded_turns: rd.graded_turns,
      violations: rd.violation_count, dimensions: rd.dimension_scores,
    };
  }).sort((a, b) => b.readiness - a.readiness);

  const org = {};
  for (const d of DIMENSIONS) {
    const vals = rows.map(x => x.dimensions[d]).filter(v => v > 0);
    org[d] = vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : 0;
  }
  const totals = {
    interns: rows.length,
    ready: rows.filter(x => x.is_ready).length,
    graded_replies: db.prepare('SELECT COUNT(*) n FROM evaluations').get().n,
    sessions: db.prepare('SELECT COUNT(*) n FROM practice_sessions').get().n,
    avg_readiness: rows.length ? +(rows.reduce((a, x) => a + x.readiness, 0) / rows.length).toFixed(1) : 0,
  };
  const orgTrend = db.prepare(
    `SELECT date(created_at) day, AVG(overall) score, COUNT(*) n FROM evaluations GROUP BY day ORDER BY day`
  ).all().map(x => ({ ...x, score: +(x.score || 0).toFixed(1) }));

  res.json({ leaderboard: rows, org_dimensions: org, totals, org_trend: orgTrend });
});

// admin: readiness board
r.get('/readiness', adminOnly, (req, res) => {
  const interns = db.prepare(`SELECT id, name, email FROM users WHERE role = 'intern' AND is_active = 1`).all();
  res.json(interns.map(u => ({ user: u, ...computeReadiness(u.id) })));
});

// admin: full transcript of any session
r.get('/sessions/:id/transcript', adminOnly, (req, res) => {
  const s = db.prepare(
    `SELECT ps.*, p.name persona_name, u.name intern_name FROM practice_sessions ps
     LEFT JOIN personas p ON p.id = ps.persona_id JOIN users u ON u.id = ps.intern_id WHERE ps.id = ?`
  ).get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const messages = db.prepare('SELECT * FROM session_messages WHERE session_id = ? ORDER BY created_at, rowid').all(req.params.id);
  const evals = db.prepare(
    `SELECT e.* FROM evaluations e JOIN session_messages m ON m.id = e.session_message_id WHERE m.session_id = ?`
  ).all(req.params.id).map(e => ({ ...e, rationale: safe(e.rationale, {}), violations: safe(e.violations, []) }));
  res.json({ session: s, messages, evaluations: evals });
});

function safe(s, f) { try { return JSON.parse(s) ?? f; } catch { return f; } }

export default r;
