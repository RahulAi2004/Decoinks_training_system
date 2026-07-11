// Extracts the best SUCCESSFUL (ordered/paid) customer conversations from the raw
// "Decoinks-All-Customers" export, with their REAL shared images, and loads them
// into the real_chats replay so interns practice against actual buying customers.
// The 87MB docx is not shipped; a compact JSON + the selected images are.
import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import db, { DATA_DIR, uuid } from '../db.js';

const DOCX = path.join(process.cwd(), 'Decoinks-All-Customers.docx');
const JSON_FILE = path.join(process.cwd(), 'decoinks-successful-chats.json');
const ART_DIR = path.join(DATA_DIR, 'real-chat-artwork');

const TARGET = 50;
const MAX_IMG_PER_CHAT = 3;   // keep the committed image set reasonable
const PAID = /(payment received|received your payment|got your payment|thank you for (your )?(the )?payment|payment confirmed|just paid|i paid|paid you|sent (the )?(payment|receipt)|payment sent|receipt|transferred|order placed|order confirmed)/i;
const PRICE = /\$\d/;
const ADDRESS = /\b\d{3,}\s+\w+.*(st|street|ave|avenue|road|rd|dr|drive|lane|ln|blvd|way|court|ct)\b|\b\d{5}\b/i;
const JUNK = /(replied to an ad|reacted to|sent an attachment|liked a message|is typing|missed (a )?call|started a call|joined the|changed the|added .* to the|unsent|reacted with|you sent an attachment)/i;
const CUST_ART = /^Customer shared their design:/i;
const CUST_ART_NOEMBED = /could not embed/i;
const AGENT_ART = /^(Agent:\s*)?\[.*(mockup|sent a|design).*\]$/i;

function decodeXml(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

// Ordered embedded-image filenames per conversation index (0-based, by "Conversation" order).
async function imagesByConversation(zip) {
  const doc = await zip.file('word/document.xml')?.async('string');
  const rels = await zip.file('word/_rels/document.xml.rels')?.async('string');
  if (!doc || !rels) return {};
  const relMap = Object.fromEntries([...rels.matchAll(/<Relationship[^>]+Id="([^"]+)"[^>]+Target="([^"]+)"/g)].map(m => [m[1], m[2]]));
  const byConv = {};
  let conv = -1;
  for (const pm of doc.matchAll(/<w:p[\s\S]*?<\/w:p>/g)) {
    const para = pm[0];
    const text = decodeXml([...para.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map(m => m[1]).join('')).trim();
    if (text === 'Conversation') { conv += 1; byConv[conv] = byConv[conv] || []; continue; }
    if (conv < 0) continue;
    const embeds = [...para.matchAll(/r:embed="([^"]+)"/g)].map(m => relMap[m[1]]).filter(Boolean);
    for (const e of embeds) byConv[conv].push(path.basename(e));
  }
  return byConv;
}

function parseConversations(value) {
  const raw = value.split(/\r?\n/);
  const isMsg = t => /^(Customer|Agent):/i.test(t);
  const starts = [];
  for (let i = 0; i < raw.length; i++) if (raw[i].trim() === 'Conversation') starts.push(i);

  return starts.map((idx, s) => {
    let name = '';
    for (let j = idx - 1; j >= Math.max(0, idx - 6); j--) {
      const t = raw[j].trim();
      if (t && !isMsg(t) && t !== 'Conversation') { name = t; break; }
    }
    const end = s + 1 < starts.length ? starts[s + 1] - 1 : raw.length;
    const lines = raw.slice(idx + 1, end).map(l => l.trim()).filter(Boolean);

    // Build ordered messages.
    const messages = [];
    let cur = null;
    const flush = () => { if (cur) { cur.body = cur.parts.join(' ').replace(/\*\*/g, '').trim(); if ((cur.body && !JUNK.test(cur.body)) || cur.is_artwork) messages.push(cur); } cur = null; };
    for (const line of lines) {
      if (CUST_ART.test(line) || CUST_ART_NOEMBED.test(line)) {
        flush();
        messages.push({ role: 'customer', sent_at: '', body: 'Customer shared their design.', is_artwork: 1, needs_image: !CUST_ART_NOEMBED.test(line), parts: [] });
        continue;
      }
      if (AGENT_ART.test(line)) { flush(); continue; }
      const m = line.match(/^(Customer|Agent):\s*(?:\(([^)]+)\))?\s*(.*)$/i);
      if (m) { flush(); cur = { role: m[1].toLowerCase(), sent_at: m[2] || '', body: '', is_artwork: 0, needs_image: false, parts: [] }; const inline = (m[3] || '').replace(/^\[.*\]$/, '').trim(); if (inline) cur.parts.push(inline); continue; }
      if (cur) cur.parts.push(line);
    }
    flush();
    return { index: s, name, messages };
  });
}

function summarize(messages) {
  const firstCust = messages.find(m => m.role === 'customer' && !m.is_artwork)?.body || '';
  return firstCust.slice(0, 160);
}
function inferIntent(text) {
  if (/\bbulk|team|group|church|[5-9]\d\b|100|1000\b/.test(text)) return 'Bulk / group order';
  if (/\bspanish|hola|cu[aá]nto|camiseta|env[ií]o\b/i.test(text)) return 'Spanish inquiry';
  if (/\brush|asap|today|friday|urgent|deadline\b/i.test(text)) return 'Rush deadline';
  if (/\bshirt|hoodie|dtf|transfer|print\b/i.test(text)) return 'Custom apparel / DTF';
  return 'General order';
}

export async function buildSuccessfulJson(docxPath = DOCX, outPath = JSON_FILE) {
  const { value } = await mammoth.extractRawText({ path: docxPath });
  const zip = await JSZip.loadAsync(fs.readFileSync(docxPath));
  const convImages = await imagesByConversation(zip);
  const convos = parseConversations(value);

  // Score and keep only clean, named, successful conversations.
  const candidates = convos.map(c => {
    const text = c.messages.map(m => m.body).join(' ');
    const custMsgs = c.messages.filter(m => m.role === 'customer' && !m.is_artwork).length;
    const artMsgs = c.messages.filter(m => m.is_artwork && m.needs_image).length;
    const success = PAID.test(text) || (ADDRESS.test(text) && PRICE.test(text));
    const named = c.name && !/^customer$/i.test(c.name) && /^[A-Za-z]/.test(c.name) && c.name.length <= 40;
    const imagesAvail = (convImages[c.index] || []).length;
    return { ...c, text, custMsgs, artMsgs, success, named, imagesAvail };
  }).filter(c => c.named && c.success && c.custMsgs >= 3 && c.messages.length >= 6 && c.messages.length <= 220);

  // Prefer chats that actually have images to share, then richer conversations.
  candidates.sort((a, b) => (Math.min(b.imagesAvail, 1) - Math.min(a.imagesAvail, 1)) || (b.custMsgs - a.custMsgs));
  const chosen = candidates.slice(0, TARGET);

  // Extract the images for the chosen chats and attach to their artwork messages.
  fs.mkdirSync(ART_DIR, { recursive: true });
  for (const f of fs.readdirSync(ART_DIR)) if (/^ac-\d+-\d+\./.test(f)) fs.unlinkSync(path.join(ART_DIR, f));
  const chats = [];
  for (let n = 0; n < chosen.length; n++) {
    const c = chosen[n];
    const imgs = [...(convImages[c.index] || [])];
    let usedImgs = 0;
    const messages = [];
    for (const m of c.messages) {
      let attachment_path = null;
      if (m.is_artwork && m.needs_image && imgs.length && usedImgs < MAX_IMG_PER_CHAT) {
        const src = imgs.shift();
        const ext = path.extname(src) || '.jpg';
        const outName = `ac-${n + 1}-${messages.filter(x => x.attachment_path).length + 1}${ext}`;
        const buf = await zip.file(`word/media/${src}`)?.async('nodebuffer');
        if (buf) { fs.writeFileSync(path.join(ART_DIR, outName), buf); attachment_path = outName; usedImgs += 1; }
      }
      messages.push({ role: m.role, body: m.body, sent_at: m.sent_at, is_artwork: m.is_artwork, attachment_path });
    }
    chats.push({
      customer_name: c.name,
      outcome: 'ORDERED',
      intent: inferIntent(c.text),
      products_discussed: '',
      stage_reached: 'Ordered / paid',
      summary: summarize(c.messages),
      messages,
    });
  }

  fs.writeFileSync(outPath, JSON.stringify({ chats }));
  return { chats: chats.length, withImages: chats.filter(c => c.messages.some(m => m.attachment_path)).length };
}

export function importSuccessfulFromJson(jsonPath = JSON_FILE) {
  if (!fs.existsSync(jsonPath)) throw new Error(`Successful-chats JSON not found: ${jsonPath}`);
  const { chats } = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM real_chat_sessions').run();
    db.prepare('DELETE FROM real_chat_messages').run();
    db.prepare('DELETE FROM real_chats').run();
    chats.forEach((chat, i) => {
      const chatId = uuid();
      const artworkCount = chat.messages.filter(m => m.attachment_path).length;
      db.prepare(`INSERT INTO real_chats
        (id, source_number, customer_name, outcome, order_value, products_discussed, stage_reached,
         intent, message_count, artwork_count, summary, source_filename)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(chatId, i + 1, chat.customer_name, chat.outcome, null, chat.products_discussed || '',
          chat.stage_reached, chat.intent, chat.messages.length, artworkCount, chat.summary, 'Decoinks-All-Customers');
      chat.messages.forEach((m, idx) => {
        db.prepare(`INSERT INTO real_chat_messages
          (id, chat_id, message_index, role, body, sent_at, is_artwork, attachment_path, original_marker)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(uuid(), chatId, idx, m.role, m.body, m.sent_at || '', m.is_artwork ? 1 : 0,
            m.role === 'customer' ? m.attachment_path || null : null, '');
      });
    });
  });
  tx();
  return chats.length;
}
