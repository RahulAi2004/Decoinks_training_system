// Filter the classified real-chat library and assign a chosen set to a trainee.
// Assignments show up in the trainee's "Assigned" tab; each one is a real chat
// they can practise on. Filtering is pure SQL over the pre-stored classification
// columns — no LLM calls at request time.
import db, { uuid } from '../db.js';

// completed = the customer actually ordered (outcome ORDERED); everything else
// (abandoned / left without ordering) counts as not completed.
const COMPLETED_SQL = "rc.outcome = 'ORDERED'";

export function filterChats({ product = '', language = '', completed = '', limit = 25 } = {}) {
  const where = [];
  const params = {};
  if (product) { where.push('rc.product_type = @product'); params.product = product; }
  if (language) { where.push('rc.chat_language = @language'); params.language = language; }
  if (completed === 'yes') where.push(COMPLETED_SQL);
  else if (completed === 'no') where.push(`NOT (${COMPLETED_SQL})`);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = db.prepare(`SELECT COUNT(*) AS n FROM real_chats rc ${whereSql}`).get(params).n;
  const cap = Math.min(500, Math.max(1, Number(limit) || 25));
  const chats = db.prepare(`
    SELECT rc.id, rc.source_number, rc.customer_name, rc.intent, rc.product_type, rc.chat_language,
      rc.outcome, rc.message_count, rc.artwork_count,
      CASE WHEN ${COMPLETED_SQL} THEN 1 ELSE 0 END AS is_completed,
      (SELECT COUNT(*) FROM real_chat_messages m WHERE m.chat_id = rc.id AND m.role='customer') AS customer_messages
    FROM real_chats rc ${whereSql}
    ORDER BY rc.source_number
    LIMIT ${cap}`).all(params);
  return { total, chats };
}

export function assignChats(traineeId, realChatIds, adminId) {
  const trainee = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'intern' AND is_active = 1").get(traineeId);
  if (!trainee) throw new Error('Pick a valid trainee');
  const ids = [...new Set((realChatIds || []).filter(Boolean))];
  if (!ids.length) throw new Error('No chats selected');
  const insert = db.prepare(`INSERT OR IGNORE INTO chat_assignments (id, trainee_id, real_chat_id, assigned_by)
    VALUES (?, ?, ?, ?)`);
  let assigned = 0;
  const tx = db.transaction(() => {
    for (const chatId of ids) {
      const exists = db.prepare('SELECT id FROM real_chats WHERE id = ?').get(chatId);
      if (exists) assigned += insert.run(uuid(), traineeId, chatId, adminId).changes;
    }
  });
  tx();
  return { assigned, requested: ids.length };
}

export function assignedChatsForTrainee(traineeId) {
  return db.prepare(`
    SELECT ca.id AS assignment_id, ca.status, ca.assigned_at,
      rc.id AS chat_id, rc.source_number, rc.customer_name, rc.intent, rc.product_type, rc.chat_language,
      rc.artwork_count, CASE WHEN ${COMPLETED_SQL} THEN 1 ELSE 0 END AS is_completed,
      (SELECT COUNT(*) FROM real_chat_messages m WHERE m.chat_id = rc.id AND m.role='customer') AS customer_messages
    FROM chat_assignments ca JOIN real_chats rc ON rc.id = ca.real_chat_id
    WHERE ca.trainee_id = ?
    ORDER BY (ca.status = 'done'), ca.assigned_at DESC`).all(traineeId);
}

// When a trainee starts practising an assigned chat, mark that assignment done.
export function markAssignmentDone(traineeId, realChatId) {
  db.prepare("UPDATE chat_assignments SET status = 'done' WHERE trainee_id = ? AND real_chat_id = ?")
    .run(traineeId, realChatId);
}

export function unassign(traineeId, realChatId) {
  db.prepare('DELETE FROM chat_assignments WHERE trainee_id = ? AND real_chat_id = ?').run(traineeId, realChatId);
}
