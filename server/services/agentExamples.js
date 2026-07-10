// Admin-curated "good agent reply" examples and corrections. When the admin
// plays the customer and the AI plays the Decoinks agent, the admin can approve
// a good reply or CORRECT a wrong one. Corrections are treated as hard rules so
// the AI agent does not repeat the same mistake.
import db, { uuid } from '../db.js';

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
