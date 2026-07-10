// Admin-approved "good customer message" examples. These are curated by an admin
// in the Chat with AI portal and fed to the AI customer as few-shot examples so
// it learns to message like a real customer.
import db, { uuid } from '../db.js';
import { embedBatch, cosine, LOCAL_MODEL } from '../embeddings.js';

export function addCustomerExample(body, userId = null) {
  const text = String(body || '').trim();
  if (!text) return null;
  const id = uuid();
  db.prepare('INSERT INTO customer_examples (id, body, created_by) VALUES (?, ?, ?)').run(id, text, userId);
  return db.prepare('SELECT * FROM customer_examples WHERE id = ?').get(id);
}

export function listCustomerExamples(limit = 200) {
  return db.prepare('SELECT * FROM customer_examples ORDER BY created_at DESC LIMIT ?').all(limit);
}

export function deleteCustomerExample(id) {
  db.prepare('DELETE FROM customer_examples WHERE id = ?').run(id);
}

// Most recent approved examples, newest first — injected into AI customer prompts.
export function approvedExampleTexts(limit = 15) {
  return db.prepare('SELECT body FROM customer_examples ORDER BY created_at DESC LIMIT ?').all(limit).map(r => r.body);
}

// Fill in any missing embeddings once. Always the LOCAL model — offline, free,
// and never dependent on an OpenAI quota.
async function backfillEmbeddings(rows) {
  const missing = rows.filter(r => !r.embedding);
  if (!missing.length) return;
  const vecs = await embedBatch(missing.map(r => r.body), LOCAL_MODEL);
  const upd = db.prepare('UPDATE customer_examples SET embedding = ? WHERE id = ?');
  missing.forEach((r, i) => { r.embedding = JSON.stringify(vecs[i]); upd.run(r.embedding, r.id); });
}

// Option A: return the approved examples MOST RELEVANT to the current situation,
// not just the newest ones — so guidance scales past a handful of examples.
export async function relevantExampleTexts(query, limit = 10) {
  try {
    const rows = db.prepare('SELECT id, body, embedding FROM customer_examples ORDER BY created_at DESC LIMIT 400').all();
    if (!rows.length) return [];
    if (!query || !String(query).trim()) return rows.slice(0, limit).map(r => r.body);
    await backfillEmbeddings(rows);
    const [qv] = await embedBatch([String(query)], LOCAL_MODEL);
    return rows
      .map(r => ({ body: r.body, score: cosine(qv, JSON.parse(r.embedding)) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(r => r.body);
  } catch (e) {
    console.error('relevantExampleTexts error:', e.message);
    return approvedExampleTexts(limit);   // safe fallback to recency
  }
}
