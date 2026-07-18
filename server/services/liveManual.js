// Live manual training chat: a trainer (admin) and a real trainee (Decoinks
// agent) message each other in real time — fully manual, no AI, no replay. The
// admin invites a trainee, the trainee claims it (says yes), then both type
// their own messages. The admin's messages are the 'customer' side; the
// trainee replies as the 'intern' (agent). Both screens poll for real-time sync.
//
// A reply timer (reply_seconds, set by the admin) puts the trainee under
// pressure: after the admin sends a message it is the trainee's turn, and they
// must reply before the countdown runs out. Replies that miss the window are
// flagged "late" in the transcript. The timer is enforced only for display /
// coaching — a late reply is still accepted.
import db, { uuid } from '../db.js';

const DEFAULT_REPLY_SECONDS = 60;

export function clampReplySeconds(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(600, Math.max(5, n)) : DEFAULT_REPLY_SECONDS;
}

export function getLiveManual(sessionId) {
  return db.prepare('SELECT * FROM live_manual_sessions WHERE session_id = ?').get(sessionId);
}

// Lock legacy turns to the timer that was active when we first see them. New
// turns store this metadata as they are written, so later timer edits cannot
// rewrite historical coaching results.
function snapshotLegacyMetrics(sessionId, fallbackReplySeconds) {
  const rows = db.prepare(`SELECT id, role, created_at, reply_limit_seconds,
    reply_took_seconds, reply_late FROM session_messages
    WHERE session_id = ? ORDER BY created_at, rowid`).all(sessionId);
  let lastCustomer = null;
  const saveCustomerLimit = db.prepare('UPDATE session_messages SET reply_limit_seconds = ? WHERE id = ?');
  const saveReply = db.prepare('UPDATE session_messages SET reply_took_seconds = ?, reply_late = ? WHERE id = ?');

  db.transaction(() => {
    for (const m of rows) {
      if (m.role === 'customer') {
        const limit = m.reply_limit_seconds ?? fallbackReplySeconds;
        if (m.reply_limit_seconds == null) saveCustomerLimit.run(limit, m.id);
        lastCustomer = { ...m, reply_limit_seconds: limit };
      } else if (m.role === 'intern' && lastCustomer) {
        const gap = Math.max(0, Math.round((new Date(m.created_at + 'Z').getTime() - new Date(lastCustomer.created_at + 'Z').getTime()) / 1000));
        if (m.reply_took_seconds == null || m.reply_late == null) {
          saveReply.run(gap, gap > lastCustomer.reply_limit_seconds ? 1 : 0, m.id);
        }
        lastCustomer = null;
      }
    }
  })();
}

// Parse the trailing [[artwork:url]] marker and expose the reply metrics that
// were captured for each individual turn.
export function liveManualMessages(sessionId, replySeconds = DEFAULT_REPLY_SECONDS) {
  snapshotLegacyMetrics(sessionId, replySeconds);
  const rows = db.prepare(`SELECT id, role, body, created_at, reply_limit_seconds,
    reply_took_seconds, reply_late, attachment_url, attachment_name, attachment_mime
    FROM session_messages
    WHERE session_id = ? ORDER BY created_at, rowid`).all(sessionId);
  let lastCustomerAt = null;
  return rows.map(m => {
    const match = m.body.match(/\n?\[\[artwork:(.+?)\]\]\s*$/);
    const out = match ? { ...m, body: m.body.replace(match[0], '').trim(), attachment_url: match[1] } : { ...m };
    if (m.role === 'customer') {
      lastCustomerAt = m.created_at;
    } else if (m.role === 'intern' && lastCustomerAt) {
      const gap = (new Date(m.created_at + 'Z').getTime() - new Date(lastCustomerAt + 'Z').getTime()) / 1000;
      out.reply_took = m.reply_took_seconds ?? Math.max(0, Math.round(gap));
      out.late = m.reply_late == null ? gap > replySeconds : !!m.reply_late;
      lastCustomerAt = null;
    }
    delete out.reply_limit_seconds;
    delete out.reply_took_seconds;
    delete out.reply_late;
    return out;
  });
}

// Whose turn it is and how long the trainee has left to reply.
export function liveManualTurn(sessionId, replySeconds = DEFAULT_REPLY_SECONDS) {
  const last = db.prepare(`SELECT role, created_at, reply_limit_seconds FROM session_messages
    WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(sessionId);
  if (!last || last.role !== 'customer') {
    return { waiting_for_trainee: false, seconds_left: null, expired: false, reply_seconds: replySeconds };
  }
  const turnLimit = last.reply_limit_seconds ?? replySeconds;
  const deadline = new Date(last.created_at + 'Z').getTime() + turnLimit * 1000;
  const secondsLeft = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  return { waiting_for_trainee: true, seconds_left: secondsLeft, expired: secondsLeft <= 0, reply_seconds: turnLimit };
}

// Common response shape used by both the admin and trainee endpoints.
export function liveManualPayload(st, extra = {}) {
  const rs = st.reply_seconds || DEFAULT_REPLY_SECONDS;
  return {
    session_id: st.session_id, name: st.name, status: st.status, reply_seconds: rs,
    messages: liveManualMessages(st.session_id, rs),
    turn: liveManualTurn(st.session_id, rs),
    ...extra,
  };
}

export function createLiveManual(adminId, agentId, name, replySeconds = DEFAULT_REPLY_SECONDS) {
  const agent = db.prepare("SELECT id, name FROM users WHERE id = ? AND role = 'intern' AND is_active = 1").get(agentId);
  if (!agent) throw new Error('Pick a valid trainee');
  const id = uuid();
  db.transaction(() => {
    db.prepare('INSERT INTO practice_sessions (id, intern_id, persona_id) VALUES (?, ?, NULL)').run(id, agentId);
    db.prepare(`INSERT INTO live_manual_sessions (session_id, admin_id, agent_id, name, status, reply_seconds)
      VALUES (?, ?, ?, ?, 'invited', ?)`).run(id, adminId, agentId, String(name || '').trim() || `Live chat with ${agent.name}`, clampReplySeconds(replySeconds));
  })();
  return getLiveManual(id);
}

export function updateReplySeconds(sessionId, value) {
  const st = getLiveManual(sessionId);
  if (!st) return null;
  snapshotLegacyMetrics(sessionId, st.reply_seconds || DEFAULT_REPLY_SECONDS);
  db.prepare('UPDATE live_manual_sessions SET reply_seconds = ? WHERE session_id = ?').run(clampReplySeconds(value), sessionId);
  return getLiveManual(sessionId);
}

// attachment: optional { url, name, mime } — a message may be a file on its own.
export function addLiveManualMessage(sessionId, role, body, attachment = null) {
  const clean = String(body || '').trim();
  if (!clean && !attachment) return false;
  const st = getLiveManual(sessionId);
  if (!st) return false;
  const normalizedRole = role === 'customer' ? 'customer' : 'intern';
  const messageId = uuid();
  const [aUrl, aName, aMime] = attachment
    ? [attachment.url, attachment.name, attachment.mime] : [null, null, null];
  db.transaction(() => {
    if (normalizedRole === 'customer') {
      db.prepare(`INSERT INTO session_messages
        (id, session_id, role, body, reply_limit_seconds, attachment_url, attachment_name, attachment_mime)
        VALUES (?, ?, 'customer', ?, ?, ?, ?, ?)`)
        .run(messageId, sessionId, clean, st.reply_seconds || DEFAULT_REPLY_SECONDS, aUrl, aName, aMime);
      return;
    }

    const last = db.prepare(`SELECT role, created_at, reply_limit_seconds FROM session_messages
      WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(sessionId);
    db.prepare(`INSERT INTO session_messages
      (id, session_id, role, body, attachment_url, attachment_name, attachment_mime)
      VALUES (?, ?, 'intern', ?, ?, ?, ?)`)
      .run(messageId, sessionId, clean, aUrl, aName, aMime);
    if (last?.role === 'customer') {
      const inserted = db.prepare('SELECT created_at FROM session_messages WHERE id = ?').get(messageId);
      const gap = Math.max(0, Math.round((new Date(inserted.created_at + 'Z').getTime() - new Date(last.created_at + 'Z').getTime()) / 1000));
      const limit = last.reply_limit_seconds ?? st.reply_seconds ?? DEFAULT_REPLY_SECONDS;
      db.prepare('UPDATE session_messages SET reply_took_seconds = ?, reply_late = ? WHERE id = ?')
        .run(gap, gap > limit ? 1 : 0, messageId);
    }
  })();
  return true;
}

// Trainee accepts the invite → the session goes live.
export function claimLiveManual(sessionId, agentId) {
  const st = getLiveManual(sessionId);
  if (!st || st.agent_id !== agentId || st.status === 'ended') return null;
  if (st.status === 'invited') db.prepare("UPDATE live_manual_sessions SET status = 'active' WHERE session_id = ?").run(sessionId);
  return getLiveManual(sessionId);
}

export function endLiveManual(sessionId) {
  db.prepare("UPDATE live_manual_sessions SET status = 'ended' WHERE session_id = ?").run(sessionId);
  db.prepare("UPDATE practice_sessions SET status = 'ended', ended_at = datetime('now') WHERE id = ?").run(sessionId);
  return getLiveManual(sessionId);
}

// Permanently remove a trainer chat and all its messages (order matters so the
// FK rows go before the practice_sessions row, regardless of cascade settings).
export function deleteLiveManual(sessionId) {
  db.transaction(() => {
    db.prepare('DELETE FROM live_manual_sessions WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM session_messages WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM practice_sessions WHERE id = ?').run(sessionId);
  })();
}
