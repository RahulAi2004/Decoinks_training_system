// Quiz generation + grading. LLM-generated MCQ/short-answer from random KB chunks;
// short answers are LLM-graded against the correct answer (heuristic in mock mode).
import db, { uuid } from '../db.js';
import { completeJSON, resolveProvider } from '../llm.js';
import { localEmbed, cosine } from '../embeddings.js';

const GEN_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          type: { type: 'string', enum: ['mcq', 'short'] },
          options: { type: 'array', items: { type: 'string' } },
          correct_answer: { type: 'string' },
          source_fact: { type: 'string' },
        },
        required: ['question', 'type', 'correct_answer', 'source_fact'],
      },
    },
  },
  required: ['questions'],
};

export async function generateQuizzes(count = 10) {
  const { provider } = resolveProvider();
  if (provider === 'mock') return { created: 0, error: 'Quiz generation needs an LLM API key. Seeded quizzes are still available.' };

  const chunks = db.prepare(`SELECT content FROM doc_chunks WHERE kind IN ('knowledge','training') ORDER BY RANDOM() LIMIT 12`).all();
  if (!chunks.length) return { created: 0, error: 'No knowledge base ingested yet.' };

  const result = await completeJSON({
    system: `You create training-quiz questions for Decoinks sales interns. Every question must test a concrete fact that appears VERBATIM-verifiable in the provided knowledge-base excerpts (MOQ, pricing, turnaround, shipping, payment methods, policies, what we don't offer). Never invent facts. For mcq include exactly 4 options with one correct. Quote the exact source fact in source_fact.`,
    schemaName: 'quiz_batch',
    schema: GEN_SCHEMA,
    messages: [{ role: 'user', content: `KNOWLEDGE BASE EXCERPTS:\n\n${chunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n')}\n\nGenerate ${count} questions (mix of mcq and short).` }],
    maxTokens: 3000,
  });

  const ins = db.prepare('INSERT INTO quizzes (id, question, type, options, correct_answer, source) VALUES (?, ?, ?, ?, ?, ?)');
  let created = 0;
  for (const q of result?.questions || []) {
    if (!q.question || !q.correct_answer) continue;
    ins.run(uuid(), q.question, q.type === 'short' ? 'short' : 'mcq',
      JSON.stringify(q.options || []), q.correct_answer, q.source_fact || 'knowledge base');
    created++;
  }
  return { created };
}

const GRADE_SCHEMA = {
  type: 'object',
  properties: { score: { type: 'number' }, is_correct: { type: 'boolean' }, feedback: { type: 'string' } },
  required: ['score', 'is_correct', 'feedback'],
};

export async function gradeShortAnswer({ question, correct, answer }) {
  const { provider } = resolveProvider();
  if (provider !== 'mock') {
    try {
      const r = await completeJSON({
        system: 'Grade a sales-intern quiz answer against the correct answer. score 0-100 (fact fully correct=90+, partially=40-70, wrong=0-30). is_correct = score >= 70. One-sentence feedback stating the correct fact.',
        schemaName: 'grade', schema: GRADE_SCHEMA,
        messages: [{ role: 'user', content: `QUESTION: ${question}\nCORRECT ANSWER: ${correct}\nINTERN ANSWER: ${answer}` }],
        maxTokens: 300,
      });
      if (r) return { score: Math.max(0, Math.min(100, r.score)), is_correct: !!r.is_correct, feedback: r.feedback || '' };
    } catch (e) { console.error('grade LLM error:', e.message); }
  }
  const sim = Math.round(cosine(localEmbed(answer), localEmbed(correct)) * 100);
  return { score: sim, is_correct: sim >= 60, feedback: `Similarity to the correct answer: ${sim}%. Correct answer: ${correct}` };
}
