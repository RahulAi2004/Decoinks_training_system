import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import db, { uuid } from '../db.js';
import adminRoutes from '../routes/admin.js';
import {
  addLiveManualMessage,
  claimLiveManual,
  createLiveManual,
  endLiveManual,
  getLiveManual,
  liveManualMessages,
  updateReplySeconds,
} from './liveManual.js';

function insertUser(role) {
  const id = uuid();
  db.prepare(`INSERT INTO users (id, name, email, password_hash, role)
    VALUES (?, ?, ?, 'unused-in-test', ?)`)
    .run(id, `Test ${role}`, `${id}@example.test`, role);
  return id;
}

test('live manual lifecycle preserves per-turn timers and protects active chats', async () => {
  db.exec('BEGIN');
  let server;
  try {
    const adminId = insertUser('admin');
    const agentId = insertUser('intern');
    const created = createLiveManual(adminId, agentId, 'Regression chat', 30);
    assert.equal(created.status, 'invited');
    assert.equal(created.reply_seconds, 30);

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { id: adminId, role: 'admin' }; next(); });
    app.use('/admin', adminRoutes);
    server = app.listen(0);
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/admin/live-manual/${created.session_id}`;

    let response = await fetch(`${base}/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: 'Too early' }),
    });
    assert.equal(response.status, 409, 'trainer cannot start the timer before invite acceptance');

    assert.equal(claimLiveManual(created.session_id, agentId).status, 'active');
    response = await fetch(base, { method: 'DELETE' });
    assert.equal(response.status, 409, 'active chats must be ended before permanent deletion');

    assert.equal(addLiveManualMessage(created.session_id, 'customer', 'First turn'), true);
    const firstCustomer = db.prepare(`SELECT id FROM session_messages
      WHERE session_id = ? AND role = 'customer' ORDER BY rowid DESC LIMIT 1`).get(created.session_id);
    db.prepare("UPDATE session_messages SET created_at = datetime('now', '-20 seconds') WHERE id = ?").run(firstCustomer.id);

    updateReplySeconds(created.session_id, 5);
    assert.equal(addLiveManualMessage(created.session_id, 'intern', 'First reply'), true);
    const firstReply = db.prepare(`SELECT id FROM session_messages
      WHERE session_id = ? AND role = 'intern' ORDER BY rowid DESC LIMIT 1`).get(created.session_id);
    // Keep the synthetic transcript chronological before aging the next turn.
    db.prepare("UPDATE session_messages SET created_at = datetime('now', '-15 seconds') WHERE id = ?").run(firstReply.id);

    assert.equal(addLiveManualMessage(created.session_id, 'customer', 'Second turn'), true);
    const secondCustomer = db.prepare(`SELECT id FROM session_messages
      WHERE session_id = ? AND role = 'customer' ORDER BY rowid DESC LIMIT 1`).get(created.session_id);
    db.prepare("UPDATE session_messages SET created_at = datetime('now', '-10 seconds') WHERE id = ?").run(secondCustomer.id);
    assert.equal(addLiveManualMessage(created.session_id, 'intern', 'Second reply'), true);

    updateReplySeconds(created.session_id, 60);
    const replies = liveManualMessages(created.session_id, 60).filter(m => m.role === 'intern');
    assert.deepEqual(replies.map(m => m.late), [false, true], 'later timer edits must not rewrite historical results');
    assert.deepEqual(replies.map(m => m.reply_took), [20, 10]);

    endLiveManual(created.session_id);
    assert.equal(getLiveManual(created.session_id).status, 'ended');
    response = await fetch(base, { method: 'DELETE' });
    assert.equal(response.status, 200);
    assert.equal(getLiveManual(created.session_id), undefined);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    db.exec('ROLLBACK');
  }
});
