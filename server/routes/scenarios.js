// Scenarios: real customer questions from the ingested Q&A; intern writes the best
// reply, graded against the model best-reply + KB.
import { Router } from 'express';
import db, { uuid } from '../db.js';
import { evaluateReply } from '../services/evaluator.js';
import { computeReadiness } from '../services/readiness.js';
import { parseEval } from './practice.js';

const r = Router();

// next scenario for the intern (prefers unattempted, weighted toward frequent real questions)
r.get('/next', (req, res) => {
  const { intent } = req.query;
  const params = intent ? [req.user.id, intent] : [req.user.id];
  const rows = db.prepare(
    `SELECT s.* FROM scenarios s
     WHERE s.id NOT IN (SELECT scenario_id FROM scenario_attempts WHERE intern_id = ?)
     ${intent ? 'AND s.intent = ?' : ''}
     ORDER BY s.frequency DESC, RANDOM() LIMIT 20`
  ).all(...params);
  // pick randomly among top-20 frequent unattempted so it isn't always the same order
  let pick = rows.length ? rows[Math.floor(Math.random() * rows.length)] : null;
  if (!pick) pick = db.prepare('SELECT * FROM scenarios ORDER BY RANDOM() LIMIT 1').get();
  if (!pick) return res.status(404).json({ error: 'No scenarios ingested yet. Run npm run ingest.' });
  const { model_reply, ...visible } = pick;   // don't leak the answer before attempting
  res.json(visible);
});

r.get('/intents', (req, res) => {
  res.json(db.prepare('SELECT intent, COUNT(*) AS n, SUM(frequency) AS freq FROM scenarios GROUP BY intent ORDER BY freq DESC').all());
});

r.post('/:id/attempt', async (req, res) => {
  const scenario = db.prepare('SELECT * FROM scenarios WHERE id = ?').get(req.params.id);
  if (!scenario) return res.status(404).json({ error: 'Scenario not found' });
  const reply = String(req.body?.reply || '').trim();
  if (!reply) return res.status(400).json({ error: 'Empty reply' });

  const attemptId = uuid();
  db.prepare('INSERT INTO scenario_attempts (id, intern_id, scenario_id, reply) VALUES (?, ?, ?, ?)')
    .run(attemptId, req.user.id, scenario.id, reply);

  const evaluation = await evaluateReply({
    internId: req.user.id, scenarioAttemptId: attemptId,
    conversation: [{ role: 'customer', body: scenario.question }],
    customerText: scenario.question, internReply: reply, modelReply: scenario.model_reply,
  });
  db.prepare('UPDATE scenario_attempts SET overall_score = ? WHERE id = ?').run(evaluation.overall, attemptId);
  computeReadiness(req.user.id, { snapshot: true });

  res.json({ attempt_id: attemptId, evaluation, model_reply: scenario.model_reply });
});

r.get('/attempts', (req, res) => {
  const rows = db.prepare(
    `SELECT sa.*, s.question, s.intent, s.model_reply, e.overall AS eval_overall
     FROM scenario_attempts sa JOIN scenarios s ON s.id = sa.scenario_id
     LEFT JOIN evaluations e ON e.scenario_attempt_id = sa.id
     WHERE sa.intern_id = ? ORDER BY sa.created_at DESC LIMIT 100`
  ).all(req.user.id);
  res.json(rows);
});

export default r;
