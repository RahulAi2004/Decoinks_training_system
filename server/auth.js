import 'dotenv/config';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import db, { uuid } from './db.js';

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

export function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role, name: user.name, email: user.email }, SECRET, { expiresIn: '7d' });
}

// Trainers are admin-role accounts with access_level 'trainer': they run the
// training screens and can add trainees, but not the app's configuration.
export const isTrainer = (user) => user?.role === 'admin' && user?.access_level === 'trainer';

export function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, SECRET);
    const user = db.prepare('SELECT id, name, email, role, access_level, is_active FROM users WHERE id = ?').get(payload.id);
    if (!user || !user.is_active) return res.status(401).json({ error: 'Account inactive' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// Owner-only surfaces: Settings, AI Prompts, Content, and creating privileged
// accounts. Trainers are blocked here.
export function fullAdminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  if (isTrainer(req.user)) return res.status(403).json({ error: 'Trainers cannot change this' });
  next();
}

export function login(email, password) {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) return null;
  if (!user.is_active) return { error: 'Account is deactivated' };
  db.prepare(`UPDATE users SET last_login = datetime('now') WHERE id = ?`).run(user.id);
  return { token: signToken(user), user: { id: user.id, name: user.name, email: user.email, role: user.role, access_level: user.access_level } };
}

export function createUser({ name, email, password, role, access_level = 'full' }) {
  const id = uuid();
  db.prepare('INSERT INTO users (id, name, email, password_hash, role, access_level) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, name, String(email).toLowerCase().trim(), bcrypt.hashSync(password, 10), role,
      access_level === 'trainer' ? 'trainer' : 'full');
  return db.prepare('SELECT id, name, email, role, access_level, is_active FROM users WHERE id = ?').get(id);
}
