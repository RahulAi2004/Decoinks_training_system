// SQLite (better-sqlite3) database layer.
// Portability note: the schema below mirrors the Postgres design in PROMPT.md §7
// (UUID PKs, JSONB → TEXT-json, vector → TEXT-json). To move to Postgres+pgvector,
// swap this module for a pg pool, change TEXT json columns to JSONB and
// doc_chunks.embedding to vector(1536); every query in the codebase is plain SQL.
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','intern')),
  is_active INTEGER NOT NULL DEFAULT 1,
  last_login TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('knowledge','training','qa')),
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  parsed_status TEXT NOT NULL DEFAULT 'pending',
  parse_error TEXT,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  uploaded_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS doc_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding TEXT,          -- JSON array of floats
  embedding_model TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS personas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  difficulty TEXT NOT NULL DEFAULT 'medium',
  prompt TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS practice_sessions (
  id TEXT PRIMARY KEY,
  intern_id TEXT NOT NULL REFERENCES users(id),
  persona_id TEXT REFERENCES personas(id),
  status TEXT NOT NULL DEFAULT 'active',   -- active | ended
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  overall_score REAL
);

CREATE TABLE IF NOT EXISTS session_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('customer','intern')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scenarios (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  model_reply TEXT NOT NULL,
  intent TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  frequency INTEGER NOT NULL DEFAULT 1,
  source_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS real_chats (
  id TEXT PRIMARY KEY,
  source_number INTEGER NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  outcome TEXT NOT NULL,
  order_value TEXT,
  products_discussed TEXT,
  stage_reached TEXT,
  intent TEXT,
  message_count INTEGER,
  artwork_count INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  source_filename TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS real_chat_messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES real_chats(id) ON DELETE CASCADE,
  message_index INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('customer','agent')),
  body TEXT NOT NULL,
  sent_at TEXT,
  is_artwork INTEGER NOT NULL DEFAULT 0,
  attachment_path TEXT,
  original_marker TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(chat_id, message_index)
);

CREATE TABLE IF NOT EXISTS real_chat_sessions (
  session_id TEXT PRIMARY KEY REFERENCES practice_sessions(id) ON DELETE CASCADE,
  real_chat_id TEXT NOT NULL REFERENCES real_chats(id) ON DELETE CASCADE,
  next_index INTEGER NOT NULL DEFAULT 0,
  current_reference TEXT,
  current_customer_count INTEGER NOT NULL DEFAULT 0,
  replies_in_block INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS talk_customer_sessions (
  session_id TEXT PRIMARY KEY REFERENCES practice_sessions(id) ON DELETE CASCADE,
  style_name TEXT NOT NULL,
  style_description TEXT,
  agent_tip TEXT,
  questions TEXT NOT NULL,
  next_index INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS company_products (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  youtube_url TEXT,
  document_filename TEXT,
  document_path TEXT,
  document_text TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scenario_attempts (
  id TEXT PRIMARY KEY,
  intern_id TEXT NOT NULL REFERENCES users(id),
  scenario_id TEXT NOT NULL REFERENCES scenarios(id),
  reply TEXT NOT NULL,
  overall_score REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS evaluations (
  id TEXT PRIMARY KEY,
  session_message_id TEXT REFERENCES session_messages(id) ON DELETE CASCADE,
  scenario_attempt_id TEXT REFERENCES scenario_attempts(id) ON DELETE CASCADE,
  intern_id TEXT NOT NULL REFERENCES users(id),
  accuracy REAL, completeness REAL, tone REAL, policy REAL, language REAL, sales REAL,
  overall REAL,
  rationale TEXT,          -- JSON {dimension: rationale}
  violations TEXT,         -- JSON array of strings
  ideal_reply TEXT,
  evaluator_model TEXT,
  admin_verdict TEXT,      -- NULL | 'agree' | 'override'
  admin_override_overall REAL,
  admin_note TEXT,
  context TEXT,            -- JSON: customer message / conversation snapshot for review feed
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quizzes (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('mcq','short')),
  options TEXT,            -- JSON array (mcq)
  correct_answer TEXT NOT NULL,
  source TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id TEXT PRIMARY KEY,
  intern_id TEXT NOT NULL REFERENCES users(id),
  quiz_id TEXT NOT NULL REFERENCES quizzes(id),
  answer TEXT NOT NULL,
  is_correct INTEGER,
  score REAL,
  feedback TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS readiness_snapshots (
  id TEXT PRIMARY KEY,
  intern_id TEXT NOT NULL REFERENCES users(id),
  readiness_score REAL NOT NULL,
  dimension_scores TEXT NOT NULL,   -- JSON
  is_ready INTEGER NOT NULL,
  reasons TEXT,                     -- JSON array
  computed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chunks_doc ON doc_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_msgs_session ON session_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_evals_intern ON evaluations(intern_id, created_at);
CREATE INDEX IF NOT EXISTS idx_attempts_intern ON scenario_attempts(intern_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_intern ON quiz_attempts(intern_id);
CREATE INDEX IF NOT EXISTS idx_real_chat_messages ON real_chat_messages(chat_id, message_index);
CREATE INDEX IF NOT EXISTS idx_company_products_created ON company_products(created_at);
`);

for (const [column, ddl] of [
  ['current_customer_count', 'ALTER TABLE real_chat_sessions ADD COLUMN current_customer_count INTEGER NOT NULL DEFAULT 0'],
  ['replies_in_block', 'ALTER TABLE real_chat_sessions ADD COLUMN replies_in_block INTEGER NOT NULL DEFAULT 0'],
]) {
  const exists = db.prepare('PRAGMA table_info(real_chat_sessions)').all().some(c => c.name === column);
  if (!exists) db.prepare(ddl).run();
}

for (const [column, ddl] of [
  ['flow_blueprint', 'ALTER TABLE talk_customer_sessions ADD COLUMN flow_blueprint TEXT'],
]) {
  const exists = db.prepare('PRAGMA table_info(talk_customer_sessions)').all().some(c => c.name === column);
  if (!exists) db.prepare(ddl).run();
}

export const uuid = () => crypto.randomUUID();

// ---- settings helpers ----
export const DEFAULT_SETTINGS = {
  weights: { accuracy: 30, completeness: 20, tone: 15, policy: 15, language: 10, sales: 10 },
  thresholds: { readiness_min: 85, accuracy_min: 90, max_violations: 0, window_n: 20 },
  llm: { provider: 'auto', model: '' },   // provider: auto | anthropic | openai | mock
  quiz: { batch_size: 10 },
};

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (row) { try { return JSON.parse(row.value); } catch { return row.value; } }
  return DEFAULT_SETTINGS[key];
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

export function getWeights() {
  const w = { ...DEFAULT_SETTINGS.weights, ...(getSetting('weights') || {}) };
  const sum = Object.values(w).reduce((a, b) => a + Number(b || 0), 0) || 1;
  const norm = {};
  for (const k of Object.keys(w)) norm[k] = Number(w[k] || 0) / sum;  // re-normalise to 1
  return norm;
}

export default db;
