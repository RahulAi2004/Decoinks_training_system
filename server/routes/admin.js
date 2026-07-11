// Admin: content upload/re-ingest, interns management, reply-review feed, settings, personas.
import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import mammoth from 'mammoth';
import db, { uuid, getSetting, setSetting, DEFAULT_SETTINGS } from '../db.js';
import { createUser } from '../auth.js';
import { ingestAll, CONTENT_DIR } from '../ingest.js';
import { activeModelLabel } from '../llm.js';
import { parseEval } from './practice.js';
import { addCustomerExample, listCustomerExamples, deleteCustomerExample } from '../services/customerExamples.js';
import { realChatList } from '../services/realChats.js';
import { createSupervised, getSupervised, pendingInfo, editPending, releasePending, autoReleaseIfDue,
  suggestCustomerMessage, setAutoSend, updateHoldSeconds, visibleMessages as supervisedVisible } from '../services/supervised.js';
import { addAgentExample, listAgentExamples, deleteAgentExample } from '../services/agentExamples.js';
import { agentReply } from '../services/agentReplies.js';
import { listPrompts, setPrompt, resetPrompt } from '../services/prompts.js';

const r = Router();

const PRODUCT_DIR = path.join(process.cwd(), 'content', 'company-products');
fs.mkdirSync(PRODUCT_DIR, { recursive: true });

// ---------- Content ----------
const ALLOWED_EXT = new Set(['.pdf', '.docx', '.xlsx', '.xls', '.csv', '.txt', '.md', '.json']);
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const kind = ['knowledge', 'training', 'qa'].includes(req.params.kind) ? req.params.kind : null;
      if (!kind) return cb(new Error('kind must be knowledge|training|qa'));
      const dir = path.join(CONTENT_DIR, kind);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, path.basename(file.originalname)),
  }),
  fileFilter: (req, file, cb) => cb(null, ALLOWED_EXT.has(path.extname(file.originalname).toLowerCase())),
  limits: { fileSize: 25 * 1024 * 1024 },
});

r.get('/documents', (req, res) => {
  res.json(db.prepare('SELECT * FROM documents ORDER BY kind, filename').all());
});

// ---------- AI customer training: approved example messages ----------
r.get('/customer-examples', (req, res) => {
  res.json(listCustomerExamples());
});

r.post('/customer-examples', (req, res) => {
  const saved = addCustomerExample(req.body?.body, req.user.id);
  if (!saved) return res.status(400).json({ error: 'Empty message' });
  res.json(saved);
});

r.delete('/customer-examples/:id', (req, res) => {
  deleteCustomerExample(req.params.id);
  res.json({ ok: true });
});

// ---------- Conversation review: see every agent chat, fix customer messages ----------
r.get('/conversations', (req, res) => {
  const rows = db.prepare(`
    SELECT ps.id, ps.status, ps.started_at, ps.overall_score,
      u.name AS agent_name,
      (SELECT COUNT(*) FROM session_messages m WHERE m.session_id = ps.id) AS msg_count,
      CASE WHEN rcs.session_id IS NOT NULL THEN 'real_chat'
           WHEN tcs.session_id IS NOT NULL THEN 'talk_customer'
           ELSE 'persona' END AS mode,
      rc.customer_name AS real_name, tcs.style_name AS style_name
    FROM practice_sessions ps
    JOIN users u ON u.id = ps.intern_id
    LEFT JOIN real_chat_sessions rcs ON rcs.session_id = ps.id
    LEFT JOIN real_chats rc ON rc.id = rcs.real_chat_id
    LEFT JOIN talk_customer_sessions tcs ON tcs.session_id = ps.id
    WHERE (SELECT COUNT(*) FROM session_messages m WHERE m.session_id = ps.id) > 0
    ORDER BY ps.started_at DESC LIMIT 300`).all();
  res.json(rows);
});

r.get('/conversations/:id', (req, res) => {
  const s = db.prepare(`SELECT ps.*, u.name AS agent_name FROM practice_sessions ps JOIN users u ON u.id = ps.intern_id WHERE ps.id = ?`).get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Conversation not found' });
  const messages = db.prepare('SELECT id, role, body, created_at FROM session_messages WHERE session_id = ? ORDER BY created_at, rowid').all(req.params.id)
    .map(m => {
      const match = m.body.match(/\n?\[\[artwork:(.+?)\]\]\s*$/);
      return match ? { ...m, body: m.body.replace(match[0], '').trim(), attachment_url: match[1] } : m;
    });
  res.json({ session: s, messages });
});

// Admin fixes a wrong CUSTOMER message; the correction also becomes a training example.
r.put('/conversations/messages/:msgId', (req, res) => {
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Empty message' });
  const m = db.prepare('SELECT * FROM session_messages WHERE id = ?').get(req.params.msgId);
  if (!m) return res.status(404).json({ error: 'Message not found' });
  if (m.role !== 'customer') return res.status(400).json({ error: 'Only customer messages can be edited' });
  const artMatch = m.body.match(/\n?\[\[artwork:.+?\]\]\s*$/);
  db.prepare('UPDATE session_messages SET body = ? WHERE id = ?').run(body + (artMatch ? artMatch[0] : ''), req.params.msgId);
  addCustomerExample(body, req.user.id);   // corrected message trains the AI customer
  res.json({ ok: true });
});

// ---------- Supervised live training (admin monitors, edits customer msgs) ----------
r.get('/supervised/options', (req, res) => {
  const agents = db.prepare("SELECT id, name, email FROM users WHERE role = 'intern' AND is_active = 1 ORDER BY name").all();
  const customers = realChatList()
    .map(c => ({ id: c.id, name: c.customer_name, intent: c.intent }))
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json({ agents, customers });
});

r.get('/customer-library', (req, res) => {
  const query = String(req.query.q || '').trim().toLowerCase();
  const requestedLetter = String(req.query.letter || '').trim().toUpperCase();
  const letter = /^[A-Z]$/.test(requestedLetter) ? requestedLetter : '';
  const limit = Math.min(100, Math.max(10, Number(req.query.limit) || 50));
  const rows = db.prepare(`
    SELECT rc.id, rc.customer_name AS name, rc.intent, rc.outcome, rc.summary,
      rc.message_count, rc.artwork_count, rc.is_available,
      (SELECT attachment_path FROM real_chat_messages m
       WHERE m.chat_id = rc.id AND m.role = 'customer' AND m.attachment_path IS NOT NULL
       ORDER BY m.message_index LIMIT 1) AS thumbnail
    FROM real_chats rc
    WHERE (? = '' OR lower(rc.customer_name) LIKE ?)
      AND (? = '' OR upper(substr(trim(rc.customer_name), 1, 1)) = ?)
    ORDER BY rc.customer_name COLLATE NOCASE, rc.source_number
    LIMIT ?`).all(query, `%${query}%`, letter, letter, limit);
  const counts = db.prepare(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN is_available = 1 THEN 1 ELSE 0 END) AS active FROM real_chats`).get();
  res.json({
    customers: rows.map(row => ({
      ...row,
      is_available: !!row.is_available,
      thumbnail_url: row.thumbnail ? `/real-chat-artwork/${row.thumbnail}` : null,
    })),
    total: counts.total,
    active: Number(counts.active || 0),
  });
});

r.post('/customer-library/:id/activate', (req, res) => {
  const chat = db.prepare('SELECT id, customer_name FROM real_chats WHERE id = ?').get(req.params.id);
  if (!chat) return res.status(404).json({ error: 'Customer not found' });
  db.prepare('UPDATE real_chats SET is_available = 1 WHERE id = ?').run(chat.id);
  res.json({ ok: true, customer: chat });
});

r.get('/supervised', (req, res) => {
  const rows = db.prepare(`
    SELECT ps.id, ps.status, ps.started_at, u.name AS agent_name, rc.customer_name,
      (CASE WHEN rcs.pending_body IS NOT NULL OR rcs.pending_attachment IS NOT NULL THEN 1 ELSE 0 END) AS has_pending
    FROM real_chat_sessions rcs
    JOIN practice_sessions ps ON ps.id = rcs.session_id
    JOIN users u ON u.id = ps.intern_id
    JOIN real_chats rc ON rc.id = rcs.real_chat_id
    WHERE rcs.supervised = 1 AND ps.status = 'active'
    ORDER BY ps.started_at DESC`).all();
  res.json(rows);
});

r.post('/supervised', (req, res) => {
  const { agent_id, real_chat_id, hold_seconds } = req.body || {};
  if (!agent_id || !real_chat_id) return res.status(400).json({ error: 'Pick an agent and a customer' });
  try { res.json({ session_id: createSupervised(agent_id, real_chat_id, hold_seconds) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

r.get('/supervised/:id', (req, res) => {
  autoReleaseIfDue(req.params.id);
  const st = getSupervised(req.params.id);
  if (!st) return res.status(404).json({ error: 'Session not found' });
  const ps = db.prepare(`SELECT ps.id, ps.status, u.name AS agent_name, rc.customer_name,
      rcs.hold_seconds, rcs.auto_send_enabled
    FROM practice_sessions ps JOIN users u ON u.id = ps.intern_id
    JOIN real_chat_sessions rcs ON rcs.session_id = ps.id JOIN real_chats rc ON rc.id = rcs.real_chat_id
    WHERE ps.id = ?`).get(req.params.id);
  res.json({ session: ps, messages: supervisedVisible(req.params.id), pending: pendingInfo(st) });
});

r.put('/supervised/:id/auto-send', (req, res) => {
  const st = setAutoSend(req.params.id, !!req.body?.enabled);
  if (!st) return res.status(404).json({ error: 'Session not found' });
  res.json({ ok: true, pending: pendingInfo(st) });
});

r.put('/supervised/:id/timer', (req, res) => {
  const st = updateHoldSeconds(req.params.id, req.body?.hold_seconds);
  if (!st) return res.status(404).json({ error: 'Session not found' });
  res.json({ ok: true, hold_seconds: st.hold_seconds, pending: pendingInfo(st) });
});

r.put('/supervised/:id/pending', (req, res) => {
  editPending(req.params.id, req.body?.body);
  res.json({ ok: true });
});

r.post('/supervised/:id/release', (req, res) => {
  releasePending(req.params.id, true);
  res.json({ ok: true });
});

r.post('/supervised/:id/suggest', async (req, res) => {
  res.json({ suggestion: await suggestCustomerMessage(req.params.id) });
});

// ---------- AI agent training: approved replies + corrections ----------
r.get('/agent-examples', (req, res) => {
  res.json(listAgentExamples());
});

r.post('/agent-examples', (req, res) => {
  const saved = addAgentExample({
    customerText: req.body?.customer_text,
    reply: req.body?.reply,
    isCorrection: !!req.body?.is_correction,
    userId: req.user.id,
  });
  if (!saved) return res.status(400).json({ error: 'Empty reply' });
  res.json(saved);
});

r.delete('/agent-examples/:id', (req, res) => {
  deleteAgentExample(req.params.id);
  res.json({ ok: true });
});

// ---------- Editable AI prompts ----------
r.get('/prompts', (req, res) => {
  res.json(listPrompts());
});

r.put('/prompts/:key', (req, res) => {
  const ok = setPrompt(req.params.key, req.body?.text);
  if (!ok) return res.status(404).json({ error: 'Unknown prompt' });
  res.json(listPrompts().find(p => p.key === req.params.key));
});

r.post('/prompts/:key/reset', (req, res) => {
  const ok = resetPrompt(req.params.key);
  if (!ok) return res.status(404).json({ error: 'Unknown prompt' });
  res.json(listPrompts().find(p => p.key === req.params.key));
});

// Admin plays the customer; the AI answers as the Decoinks agent (KB-grounded).
r.post('/agent-chat', async (req, res) => {
  const customerText = String(req.body?.customer_text || '').trim();
  if (!customerText) return res.status(400).json({ error: 'Empty customer message' });
  const conversation = Array.isArray(req.body?.conversation) ? req.body.conversation : [];
  const reply = await agentReply({ conversation, customerText });
  res.json({ reply });
});

r.post('/documents/:kind', upload.array('files', 10), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No accepted files (pdf/docx/xlsx/txt/md/json).' });
  try {
    const summary = await ingestAll();
    res.json({ uploaded: req.files.map(f => f.originalname), ingest: summary });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

r.delete('/documents/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Document not found' });
  if (row.storage_path && fs.existsSync(row.storage_path)) {
    try { fs.unlinkSync(row.storage_path); } catch { /* DB delete still removes it from the app */ }
  }
  db.prepare('DELETE FROM documents WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

r.post('/ingest', async (req, res) => {
  try { res.json({ ingest: await ingestAll() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- Company Products ----------
const productUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(PRODUCT_DIR, { recursive: true });
      cb(null, PRODUCT_DIR);
    },
    filename: (req, file, cb) => cb(null, `${Date.now()}-${path.basename(file.originalname)}`),
  }),
  fileFilter: (req, file, cb) => cb(null, ['.docx', '.doc', '.txt', '.md'].includes(path.extname(file.originalname).toLowerCase())),
  limits: { fileSize: 25 * 1024 * 1024 },
});

async function extractProductText(file) {
  if (!file) return '';
  const ext = path.extname(file.path).toLowerCase();
  if (ext === '.docx') {
    const { value } = await mammoth.extractRawText({ path: file.path });
    return value.trim();
  }
  if (['.txt', '.md'].includes(ext)) return fs.readFileSync(file.path, 'utf8').trim();
  return '';
}

r.get('/company-products', (req, res) => {
  res.json(db.prepare(`
    SELECT id, topic, youtube_url, document_filename,
      CASE WHEN document_text IS NOT NULL AND length(document_text) > 0 THEN 1 ELSE 0 END AS has_text,
      created_at, updated_at
    FROM company_products ORDER BY created_at DESC
  `).all());
});

r.post('/company-products', productUpload.single('document'), async (req, res) => {
  const topic = String(req.body?.topic || '').trim();
  const youtubeUrl = String(req.body?.youtube_url || '').trim();
  if (!topic) return res.status(400).json({ error: 'Topic name required' });
  if (!req.file) return res.status(400).json({ error: 'Word document required' });

  try {
    const id = uuid();
    const text = await extractProductText(req.file);
    db.prepare(`INSERT INTO company_products
      (id, topic, youtube_url, document_filename, document_path, document_text, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, topic, youtubeUrl || null, req.file.originalname, req.file.path, text, req.user.id);
    res.json(db.prepare('SELECT id, topic, youtube_url, document_filename, created_at FROM company_products WHERE id = ?').get(id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

r.delete('/company-products/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM company_products WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.document_path && fs.existsSync(row.document_path)) {
    try { fs.unlinkSync(row.document_path); } catch { /* keep DB delete moving */ }
  }
  db.prepare('DELETE FROM company_products WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

// ---------- Interns ----------
r.get('/interns', (req, res) => {
  res.json(db.prepare(`SELECT id, name, email, is_active, last_login, created_at FROM users WHERE role = 'intern' ORDER BY created_at DESC`).all());
});

r.post('/interns', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email, password required' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(String(email).toLowerCase().trim()))
    return res.status(409).json({ error: 'Email already exists' });
  res.json(createUser({ name, email, password, role: 'intern' }));
});

r.patch('/interns/:id', (req, res) => {
  const u = db.prepare(`SELECT * FROM users WHERE id = ? AND role = 'intern'`).get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  if (typeof req.body?.is_active === 'boolean')
    db.prepare(`UPDATE users SET is_active = ?, updated_at = datetime('now') WHERE id = ?`).run(req.body.is_active ? 1 : 0, u.id);
  res.json(db.prepare('SELECT id, name, email, is_active FROM users WHERE id = ?').get(u.id));
});

// ---------- Reply review feed ----------
r.get('/review', (req, res) => {
  const { intern_id, min_overall, max_overall } = req.query;
  const conds = [], params = [];
  if (intern_id) { conds.push('e.intern_id = ?'); params.push(intern_id); }
  if (min_overall) { conds.push('e.overall >= ?'); params.push(Number(min_overall)); }
  if (max_overall) { conds.push('e.overall <= ?'); params.push(Number(max_overall)); }
  const rows = db.prepare(
    `SELECT e.*, u.name intern_name FROM evaluations e JOIN users u ON u.id = e.intern_id
     ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
     ORDER BY e.created_at DESC LIMIT 100`
  ).all(...params);
  res.json(rows.map(parseEval));
});

r.post('/review/:evalId/verdict', (req, res) => {
  const e = db.prepare('SELECT * FROM evaluations WHERE id = ?').get(req.params.evalId);
  if (!e) return res.status(404).json({ error: 'Not found' });
  const { verdict, override_overall, note } = req.body || {};
  if (!['agree', 'override'].includes(verdict)) return res.status(400).json({ error: 'verdict must be agree|override' });
  db.prepare('UPDATE evaluations SET admin_verdict = ?, admin_override_overall = ?, admin_note = ? WHERE id = ?')
    .run(verdict, verdict === 'override' ? Number(override_overall) : null, note || null, e.id);
  res.json({ ok: true });
});

// ---------- Settings ----------
r.get('/settings', (req, res) => {
  res.json({
    weights: { ...DEFAULT_SETTINGS.weights, ...(getSetting('weights') || {}) },
    thresholds: { ...DEFAULT_SETTINGS.thresholds, ...(getSetting('thresholds') || {}) },
    llm: { ...DEFAULT_SETTINGS.llm, ...(getSetting('llm') || {}) },
    quiz: { ...DEFAULT_SETTINGS.quiz, ...(getSetting('quiz') || {}) },
    active_model: activeModelLabel(),
    keys: { anthropic: !!process.env.ANTHROPIC_API_KEY, groq: !!process.env.GROQ_API_KEY, openai: !!process.env.OPENAI_API_KEY },
  });
});

r.put('/settings', (req, res) => {
  for (const key of ['weights', 'thresholds', 'llm', 'quiz']) {
    if (req.body?.[key] && typeof req.body[key] === 'object') setSetting(key, req.body[key]);
  }
  res.json({ ok: true, active_model: activeModelLabel() });
});

// ---------- Personas ----------
r.get('/personas', (req, res) => res.json(db.prepare('SELECT * FROM personas ORDER BY name').all()));

r.post('/personas', (req, res) => {
  const { name, description, difficulty = 'medium', prompt = '' } = req.body || {};
  if (!name || !description) return res.status(400).json({ error: 'name and description required' });
  const id = uuid();
  db.prepare('INSERT INTO personas (id, name, description, difficulty, prompt) VALUES (?, ?, ?, ?, ?)')
    .run(id, name, description, difficulty, prompt);
  res.json(db.prepare('SELECT * FROM personas WHERE id = ?').get(id));
});

r.patch('/personas/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM personas WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const next = { ...p, ...req.body };
  db.prepare(`UPDATE personas SET name = ?, description = ?, difficulty = ?, prompt = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(next.name, next.description, next.difficulty, next.prompt, next.is_active ? 1 : 0, p.id);
  res.json(db.prepare('SELECT * FROM personas WHERE id = ?').get(p.id));
});

export default r;
