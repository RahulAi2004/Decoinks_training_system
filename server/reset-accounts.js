// One-off: create the real admin (from ADMIN_* env vars) and remove the demo accounts
// (admin@decoinks.com / intern@decoinks.com) along with all their data.
// Idempotent — safe to re-run. Usage: node server/reset-accounts.js
import 'dotenv/config';
import db from './db.js';
import { createUser } from './auth.js';

const DEMO_EMAILS = ['admin@decoinks.com', 'intern@decoinks.com'];

// 1. Ensure the real admin exists.
const email = String(process.env.ADMIN_EMAIL || '').toLowerCase().trim();
const password = process.env.ADMIN_PASSWORD || '';
const name = process.env.ADMIN_NAME || 'Admin';
if (!email || !password) { console.error('ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env'); process.exit(1); }

const existing = db.prepare('SELECT id, role FROM users WHERE email = ?').get(email);
if (existing) {
  console.log(`Real admin already exists: ${email} (role: ${existing.role})`);
} else {
  createUser({ name, email, password, role: 'admin' });
  console.log(`✓ Created real admin: ${email}`);
}

// 2. Remove demo accounts + all their data (respecting foreign keys).
const wipeUser = db.transaction((userId) => {
  db.prepare('DELETE FROM evaluations WHERE intern_id = ?').run(userId);
  db.prepare('DELETE FROM quiz_attempts WHERE intern_id = ?').run(userId);
  db.prepare('DELETE FROM scenario_attempts WHERE intern_id = ?').run(userId);
  db.prepare('DELETE FROM readiness_snapshots WHERE intern_id = ?').run(userId);
  db.prepare('DELETE FROM practice_sessions WHERE intern_id = ?').run(userId); // cascades session_messages
  db.prepare('UPDATE documents SET uploaded_by = NULL WHERE uploaded_by = ?').run(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
});

for (const demo of DEMO_EMAILS) {
  const u = db.prepare('SELECT id FROM users WHERE email = ?').get(demo);
  if (!u) { console.log(`· demo not present: ${demo}`); continue; }
  if (u.id === existing?.id) { console.log(`· skipped (is the real admin): ${demo}`); continue; }
  wipeUser(u.id);
  console.log(`✓ Removed demo account + data: ${demo}`);
}

console.log('\nUsers now:');
for (const u of db.prepare('SELECT name, email, role FROM users ORDER BY role').all()) console.log(`  ${u.role}: ${u.name} <${u.email}>`);
