// Supervised live training. An admin assigns a real customer to an agent. Each
// real customer message becomes a PENDING message the admin can edit (or accept
// an AI-suggested rewrite) within an admin-configurable window before it is
// released to the agent. Auto-send can be paused without losing the message.
// Edits also become training examples. Both screens poll for state.
import db, { uuid } from '../db.js';
import { realChatMessages } from './realChats.js';
import { addCustomerExample } from './customerExamples.js';
import { completeText, resolveProvider } from '../llm.js';

const DEFAULT_HOLD_SECONDS = 15;

function clampHoldSeconds(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(300, Math.max(3, n)) : DEFAULT_HOLD_SECONDS;
}

function get(sessionId) {
  return db.prepare('SELECT * FROM real_chat_sessions WHERE session_id = ? AND supervised = 1').get(sessionId);
}

export function visibleMessages(sessionId) {
  return db.prepare('SELECT id, role, body, created_at FROM session_messages WHERE session_id = ? ORDER BY created_at, rowid').all(sessionId)
    .map(m => {
      const match = m.body.match(/\n?\[\[artwork:(.+?)\]\]\s*$/);
      return match ? { ...m, body: m.body.replace(match[0], '').trim(), attachment_url: match[1] } : m;
    });
}

function cleanBody(b) {
  return String(b || '').replace(/\[\[artwork:.+?\]\]/g, '').replace(/^Customer shared (their )?(design|artwork)\.?$/i, 'Customer shared their design.').trim();
}

// Queue the next customer message as pending. skipAgent: skip the original agent
// replies (used after the human agent has replied). Returns 'pending' | 'done'.
function setPending(sessionId, { skipAgent }) {
  const st = get(sessionId);
  const msgs = realChatMessages(st.real_chat_id);
  let i = st.next_index;
  if (skipAgent) while (i < msgs.length && msgs[i].role === 'agent') i += 1;
  if (i < msgs.length && msgs[i].role === 'customer') {
    const m = msgs[i];
    const pendingSince = st.auto_send_enabled ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null;
    const pausedLeft = st.auto_send_enabled ? null : clampHoldSeconds(st.hold_seconds);
    db.prepare(`UPDATE real_chat_sessions
      SET pending_body = ?, pending_original = ?, pending_attachment = ?, pending_since = ?,
          paused_seconds_left = ?, next_index = ? WHERE session_id = ?`)
      .run(cleanBody(m.body), cleanBody(m.body), m.attachment_path || null, pendingSince,
        pausedLeft, i + 1, sessionId);
    return 'pending';
  }
  db.prepare(`UPDATE real_chat_sessions SET pending_body = NULL, pending_original = NULL,
    pending_attachment = NULL, pending_since = NULL, paused_seconds_left = NULL WHERE session_id = ?`).run(sessionId);
  return 'done';
}

export function createSupervised(agentId, realChatId, holdSeconds = DEFAULT_HOLD_SECONDS) {
  const chat = db.prepare('SELECT * FROM real_chats WHERE id = ?').get(realChatId);
  if (!chat) throw new Error('Real customer not found');
  const id = uuid();
  db.prepare('INSERT INTO practice_sessions (id, intern_id, persona_id) VALUES (?, ?, NULL)').run(id, agentId);
  db.prepare(`INSERT INTO real_chat_sessions
    (session_id, real_chat_id, next_index, supervised, hold_seconds, auto_send_enabled)
    VALUES (?, ?, 0, 1, ?, 1)`).run(id, chat.id, clampHoldSeconds(holdSeconds));
  setPending(id, { skipAgent: true });   // first customer message → pending review
  return id;
}

export function pendingInfo(st) {
  if (!st?.pending_body && !st?.pending_attachment) return null;
  const holdSeconds = clampHoldSeconds(st.hold_seconds);
  const elapsed = st.pending_since ? (Date.now() - new Date(st.pending_since + 'Z').getTime()) : 0;
  const secondsLeft = st.auto_send_enabled
    ? Math.max(0, Math.ceil(holdSeconds - (elapsed / 1000)))
    : Math.max(0, Number(st.paused_seconds_left ?? holdSeconds));
  return {
    body: st.pending_body || '',
    original: st.pending_original || '',
    attachment_url: st.pending_attachment ? `/real-chat-artwork/${st.pending_attachment}` : null,
    edited: (st.pending_body || '') !== (st.pending_original || ''),
    seconds_left: secondsLeft,
    hold_seconds: holdSeconds,
    auto_send_enabled: !!st.auto_send_enabled,
  };
}

export function setAutoSend(sessionId, enabled) {
  let st = get(sessionId);
  if (!st) return null;
  const nextEnabled = enabled ? 1 : 0;
  if (Number(st.auto_send_enabled) === nextEnabled) return st;

  const hasPending = !!(st.pending_body || st.pending_attachment);
  const holdSeconds = clampHoldSeconds(st.hold_seconds);
  if (!nextEnabled) {
    const remaining = hasPending ? pendingInfo(st).seconds_left : holdSeconds;
    db.prepare(`UPDATE real_chat_sessions SET auto_send_enabled = 0, pending_since = NULL,
      paused_seconds_left = ? WHERE session_id = ?`).run(remaining, sessionId);
  } else {
    const remaining = Math.min(holdSeconds, Math.max(0, Number(st.paused_seconds_left ?? holdSeconds)));
    const elapsed = Math.max(0, holdSeconds - remaining);
    const pendingSince = hasPending
      ? new Date(Date.now() - elapsed * 1000).toISOString().slice(0, 19).replace('T', ' ')
      : null;
    db.prepare(`UPDATE real_chat_sessions SET auto_send_enabled = 1, pending_since = ?,
      paused_seconds_left = NULL WHERE session_id = ?`).run(pendingSince, sessionId);
  }
  st = get(sessionId);
  autoReleaseIfDue(sessionId);
  return get(sessionId) || st;
}

export function updateHoldSeconds(sessionId, value) {
  const st = get(sessionId);
  if (!st) return null;
  const holdSeconds = clampHoldSeconds(value);
  const hasPending = !!(st.pending_body || st.pending_attachment);
  const pendingSince = hasPending && st.auto_send_enabled
    ? new Date().toISOString().slice(0, 19).replace('T', ' ')
    : st.pending_since;
  const pausedLeft = hasPending && !st.auto_send_enabled ? holdSeconds : null;
  db.prepare(`UPDATE real_chat_sessions SET hold_seconds = ?, pending_since = ?,
    paused_seconds_left = ? WHERE session_id = ?`).run(holdSeconds, pendingSince, pausedLeft, sessionId);
  return get(sessionId);
}

// Insert the (possibly edited) pending message so the agent sees it; queue the
// next one if the customer's burst continues, else hand the turn to the agent.
export function releasePending(sessionId, byAdminEdit = false) {
  const st = get(sessionId);
  if (!st?.pending_body && !st?.pending_attachment) return false;
  const body = (st.pending_body || 'Customer shared their design.') + (st.pending_attachment ? `\n[[artwork:/real-chat-artwork/${st.pending_attachment}]]` : '');
  db.prepare('INSERT INTO session_messages (id, session_id, role, body) VALUES (?, ?, ?, ?)').run(uuid(), sessionId, 'customer', body);
  if (byAdminEdit && st.pending_body && st.pending_body !== st.pending_original) addCustomerExample(st.pending_body, null);
  setPending(sessionId, { skipAgent: false });   // continue burst, or wait for agent
  return true;
}

export function editPending(sessionId, body) {
  const st = get(sessionId);
  if (!st) return false;
  db.prepare('UPDATE real_chat_sessions SET pending_body = ? WHERE session_id = ?').run(String(body || '').trim(), sessionId);
  return true;
}

// Auto-release once the configured hold elapses (checked whenever either side polls).
export function autoReleaseIfDue(sessionId) {
  const st = get(sessionId);
  if (!st?.auto_send_enabled || !st?.pending_since) return;
  const elapsed = Date.now() - new Date(st.pending_since + 'Z').getTime();
  if (elapsed >= clampHoldSeconds(st.hold_seconds) * 1000) {
    // an admin edit already in pending_body is kept; treat as an accepted message
    releasePending(sessionId, st.pending_body !== st.pending_original);
  }
}

// After the human agent replies, queue the next customer message for review.
export function afterAgentReply(sessionId) {
  return setPending(sessionId, { skipAgent: true });   // 'pending' | 'done'
}

export async function suggestCustomerMessage(sessionId) {
  const st = get(sessionId);
  if (!st?.pending_original) return '';
  const { provider } = resolveProvider();
  if (provider === 'mock') return st.pending_original;
  const convo = visibleMessages(sessionId).slice(-6).map(m => `${m.role === 'intern' ? 'AGENT' : 'CUSTOMER'}: ${m.body}`).join('\n');
  try {
    const text = await completeText({
      system: 'You clean up a real customer\'s chat message into a clear, natural training example. Keep the SAME intent and a casual real-customer tone (short, informal). Do not answer as the agent. Return ONLY the rewritten customer message.',
      messages: [{ role: 'user', content: `CONVERSATION:\n${convo || '(start)'}\n\nOriginal customer message: "${st.pending_original}"\n\nRewrite it as a clear, natural customer message.` }],
      maxTokens: 60,
    });
    return (text || '').trim() || st.pending_original;
  } catch (e) { console.error('suggest error:', e.message); return st.pending_original; }
}

export { get as getSupervised };
