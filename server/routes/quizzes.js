import { Router } from 'express';
import db, { uuid, getSetting, DEFAULT_SETTINGS } from '../db.js';
import { generateQuizzes, gradeShortAnswer } from '../services/quizgen.js';
import { adminOnly } from '../auth.js';

const r = Router();

// a quiz round: prefer questions the intern hasn't answered yet
r.get('/round', (req, res) => {
  const size = Number((getSetting('quiz') || DEFAULT_SETTINGS.quiz).batch_size) || 10;
  let rows = db.prepare(
    `SELECT id, question, type, options FROM quizzes WHERE is_active = 1
     AND id NOT IN (SELECT quiz_id FROM quiz_attempts WHERE intern_id = ?)
     ORDER BY RANDOM() LIMIT ?`
  ).all(req.user.id, size);
  if (rows.length < size) {
    const more = db.prepare(
      `SELECT id, question, type, options FROM quizzes WHERE is_active = 1 ORDER BY RANDOM() LIMIT ?`
    ).all(size - rows.length);
    const seen = new Set(rows.map(x => x.id));
    rows = rows.concat(more.filter(m => !seen.has(m.id)));
  }
  res.json(rows.map(q => ({ ...q, options: q.options ? JSON.parse(q.options) : [] })));
});

r.post('/:id/attempt', async (req, res) => {
  const quiz = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
  const answer = String(req.body?.answer ?? '').trim();
  if (!answer) return res.status(400).json({ error: 'Empty answer' });

  let is_correct, score, feedback;
  if (quiz.type === 'mcq') {
    is_correct = answer.trim().toLowerCase() === quiz.correct_answer.trim().toLowerCase();
    score = is_correct ? 100 : 0;
    feedback = is_correct ? 'Correct!' : `Correct answer: ${quiz.correct_answer}`;
  } else {
    ({ is_correct, score, feedback } = await gradeShortAnswer({ question: quiz.question, correct: quiz.correct_answer, answer }));
  }
  db.prepare('INSERT INTO quiz_attempts (id, intern_id, quiz_id, answer, is_correct, score, feedback) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(uuid(), req.user.id, quiz.id, answer, is_correct ? 1 : 0, score, feedback);
  res.json({ is_correct, score, feedback, correct_answer: quiz.correct_answer, source: quiz.source });
});

r.post('/generate', adminOnly, async (req, res) => {
  try {
    const result = await generateQuizzes(Number(req.body?.count) || 10);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

r.get('/', adminOnly, (req, res) => {
  res.json(db.prepare('SELECT * FROM quizzes ORDER BY created_at DESC').all()
    .map(q => ({ ...q, options: q.options ? JSON.parse(q.options) : [] })));
});

export default r;
