// Admin-curated "good agent reply" examples and corrections. When the admin
// plays the customer and the AI plays the Decoinks agent, the admin can approve
// a good reply or CORRECT a wrong one. Corrections are treated as hard rules so
// the AI agent does not repeat the same mistake.
import db, { uuid } from '../db.js';
import { embedBatch, cosine, LOCAL_MODEL } from '../embeddings.js';

export function addAgentExample({ customerText = '', reply, isCorrection = false, userId = null }) {
  const text = String(reply || '').trim();
  if (!text) return null;
  const id = uuid();
  db.prepare('INSERT INTO agent_examples (id, customer_text, reply, is_correction, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(id, String(customerText || '').trim(), text, isCorrection ? 1 : 0, userId);
  return db.prepare('SELECT * FROM agent_examples WHERE id = ?').get(id);
}

export function listAgentExamples(limit = 200) {
  return db.prepare('SELECT * FROM agent_examples ORDER BY is_correction DESC, created_at DESC LIMIT ?').all(limit);
}

export function deleteAgentExample(id) {
  db.prepare('DELETE FROM agent_examples WHERE id = ?').run(id);
}

// Corrections first (hard rules), then good examples — newest first.
export function approvedAgentExamples(limit = 20) {
  return db.prepare('SELECT customer_text, reply, is_correction FROM agent_examples ORDER BY is_correction DESC, created_at DESC LIMIT ?').all(limit);
}

// Each example is embedded on the customer message that triggered it, so we can
// retrieve the correction/example most relevant to what the customer just said.
async function backfillEmbeddings(rows) {
  const missing = rows.filter(r => !r.embedding);
  if (!missing.length) return;
  const vecs = await embedBatch(missing.map(r => (r.customer_text || r.reply)), LOCAL_MODEL);
  const upd = db.prepare('UPDATE agent_examples SET embedding = ? WHERE id = ?');
  missing.forEach((r, i) => { r.embedding = JSON.stringify(vecs[i]); upd.run(r.embedding, r.id); });
}

// Option A: return the corrections/examples MOST RELEVANT to the current customer
// message. Corrections that match well surface reliably, even among hundreds.
export async function relevantAgentExamples(query, limit = 10) {
  try {
    const rows = db.prepare('SELECT id, customer_text, reply, is_correction, embedding FROM agent_examples ORDER BY is_correction DESC, created_at DESC LIMIT 400').all();
    if (!rows.length) return [];
    if (!query || !String(query).trim()) return rows.slice(0, limit).map(({ customer_text, reply, is_correction }) => ({ customer_text, reply, is_correction }));
    await backfillEmbeddings(rows);
    const [qv] = await embedBatch([String(query)], LOCAL_MODEL);
    return rows
      .map(r => ({ r, score: cosine(qv, JSON.parse(r.embedding)) }))
      .sort((a, b) => (b.r.is_correction - a.r.is_correction) || (b.score - a.score))
      .slice(0, limit)
      .map(({ r }) => ({ customer_text: r.customer_text, reply: r.reply, is_correction: r.is_correction }));
  } catch (e) {
    console.error('relevantAgentExamples error:', e.message);
    return approvedAgentExamples(limit);   // safe fallback to recency
  }
}
