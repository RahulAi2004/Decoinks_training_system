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
