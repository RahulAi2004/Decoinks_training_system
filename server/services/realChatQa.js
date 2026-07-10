// Real customer↔agent chat pairs mined from "Decoinks-All-Customers". Used to make
// the AI more accurate: the AI AGENT sees how real Decoinks agents replied to
// similar messages, and the AI CUSTOMER sees how real customers actually wrote.
// Pairs are embedded (offline local model) and retrieved by relevance, so this
// scales to thousands of examples.
import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import db, { uuid } from '../db.js';
import { embedBatch, cosine, LOCAL_MODEL } from '../embeddings.js';

const DOCX = path.join(process.cwd(), 'Decoinks-All-Customers.docx');
const JSON_FILE = path.join(process.cwd(), 'decoinks-all-customers-qa.json');

const MARKER = /^(Customer shared|Agent:\s*\[sent|\[customer shared|\[.*could not embed)/i;
// Messenger system lines that get mis-parsed as messages — drop these pairs.
const JUNK = /(replied to an ad|reacted to|sent an attachment|liked a message|is typing|missed (a )?call|started a call|joined the (call|group)|changed the|added .* to the group|\bunsent\b|reacted with)/i;

// Parse the transcript into ordered {role, text} messages, then customer→agent pairs.
export async function parseAllCustomers(docxPath = DOCX) {
  const { value } = await mammoth.extractRawText({ path: docxPath });
  const lines = value.split(/\r?\n/).map(l => l.trim());
  const msgs = [];
  let role = null, buf = [];
  const flush = () => { if (role && buf.length) { const t = buf.join(' ').trim(); if (t) msgs.push({ role, t }); } buf = []; };
  for (const line of lines) {
    if (!line) continue;
    if (/^Conversation$/i.test(line)) { flush(); role = null; continue; }
    const m = line.match(/^(Customer|Agent):\s*(?:\(([^)]+)\))?\s*(.*)$/);
    if (m) { flush(); role = m[1].toLowerCase(); const inline = (m[3] || '').replace(/^\[.*\]$/, '').trim(); if (inline) buf.push(inline); continue; }
    if (MARKER.test(line)) continue;
    if (role) buf.push(line);
  }
  flush();

  const pairs = [];
  const seen = new Set();
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].role !== 'customer') continue;
    const c = msgs[i].t;
    if (msgs[i + 1] && msgs[i + 1].role === 'agent') {
      const a = msgs[i + 1].t;
      if (c.length < 2 || c.length > 400 || a.length < 2 || a.length > 600) continue;
      if (JUNK.test(c) || JUNK.test(a)) continue;
      const key = `${c}${a}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ c, a });
    }
  }
  return pairs;
}

export async function buildQaJson(docxPath = DOCX, outPath = JSON_FILE) {
  const pairs = await parseAllCustomers(docxPath);
  fs.writeFileSync(outPath, JSON.stringify({ pairs }));
  return pairs.length;
}

// Read the compact JSON (shipped in the repo), embed, and load into the DB.
export async function importQaFromJson(jsonPath = JSON_FILE) {
  if (!fs.existsSync(jsonPath)) throw new Error(`QA JSON not found: ${jsonPath}`);
  const { pairs } = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const vecs = await embedBatch(pairs.map(p => p.c), LOCAL_MODEL);
  const insert = db.prepare('INSERT INTO real_chat_qa (id, customer_text, agent_reply, embedding) VALUES (?, ?, ?, ?)');
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM real_chat_qa').run();
    pairs.forEach((p, i) => insert.run(uuid(), p.c, p.a, JSON.stringify(vecs[i])));
  });
  tx();
  cache = null;
  return pairs.length;
}

export function realChatQaCount() {
  return db.prepare('SELECT COUNT(*) c FROM real_chat_qa').get().c;
}

// ---- cached relevance retrieval ----
let cache = null;
function loadCache() {
  if (cache) return cache;
  cache = db.prepare('SELECT customer_text, agent_reply, embedding FROM real_chat_qa')
    .all()
    .map(r => ({ c: r.customer_text, a: r.agent_reply, e: JSON.parse(r.embedding) }));
  return cache;
}
export function invalidateQaCache() { cache = null; }

async function rank(query, k, minScore = 0.12) {
  const rows = loadCache();
  if (!rows.length || !query || !String(query).trim()) return [];
  const [qv] = await embedBatch([String(query)], LOCAL_MODEL);
  return rows.map(r => ({ r, s: cosine(qv, r.e) }))
    .filter(x => x.s >= minScore)
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map(({ r }) => r);
}

// How real agents replied to similar customer messages — for AI agent accuracy.
export async function relevantRealAgentReplies(query, k = 6) {
  try { return (await rank(query, k)).map(r => ({ customer_text: r.c, agent_reply: r.a })); }
  catch (e) { console.error('relevantRealAgentReplies error:', e.message); return []; }
}

// How real customers wrote in similar situations — for AI customer realism.
export async function relevantRealCustomerMsgs(query, k = 6) {
  try { return (await rank(query, k)).map(r => r.c); }
  catch (e) { console.error('relevantRealCustomerMsgs error:', e.message); return []; }
}
