import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import db, { DATA_DIR, uuid } from '../db.js';

const SOURCE_FILE = 'Decoinks-25-Real-Chats-v2.docx';
const ARTWORK_DIR = path.join(DATA_DIR, 'real-chat-artwork');

function compact(lines) {
  return lines.map(l => String(l || '').trim()).filter(Boolean);
}

function decodeXml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

async function artworkTargetsByChat(sourcePath) {
  const zip = await JSZip.loadAsync(fs.readFileSync(sourcePath));
  const documentXml = await zip.file('word/document.xml')?.async('string');
  const relsXml = await zip.file('word/_rels/document.xml.rels')?.async('string');
  if (!documentXml || !relsXml) return {};

  const relMap = Object.fromEntries([...relsXml.matchAll(/<Relationship[^>]+Id="([^"]+)"[^>]+Target="([^"]+)"/g)]
    .map(m => [m[1], m[2]]));
  const byChat = {};
  let current = null;
  let pendingArtwork = false;

  for (const match of documentXml.matchAll(/<w:p[\s\S]*?<\/w:p>/g)) {
    const para = match[0];
    const text = decodeXml([...para.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map(m => m[1]).join('')).trim();
    const header = text.match(/^(\d+)\.\s+.+?\s+—/);
    if (header) {
      current = Number(header[1]);
      byChat[current] ||= [];
      pendingArtwork = false;
    }

    if (/^Customer shared (?:their artwork|artwork\/image):/i.test(text)) {
      pendingArtwork = true;
      byChat[current] ||= [];
      continue;
    }

    const embeds = [...para.matchAll(/r:embed="([^"]+)"/g)].map(m => relMap[m[1]]).filter(Boolean);
    if (pendingArtwork && current && embeds.length) {
      byChat[current].push(path.basename(embeds[0]));
      pendingArtwork = false;
    } else if (text && pendingArtwork && /^(Agent|Customer|Customer shared|Agent shared|\d+\.|Outcome|Order value|Products discussed|Stage reached|Messages|What happened|Complete conversation:)/i.test(text)) {
      byChat[current]?.push(null);
      pendingArtwork = false;
    }
  }

  if (pendingArtwork && current) byChat[current]?.push(null);
  return byChat;
}

function nextValue(lines, label) {
  const i = lines.findIndex(l => l === label);
  return i >= 0 ? (lines[i + 1] || '') : '';
}

function inferIntent(chat) {
  const text = `${chat.products_discussed} ${chat.summary} ${chat.stage_reached}`.toLowerCase();
  if (/\b(spanish|español|cu[aá]nto|env[ií]o|camisetas?)\b/.test(text)) return 'Spanish inquiry';
  if (/\brush|deadline|friday|today|urgent|fast\b/.test(text)) return 'Rush deadline';
  if (/\bbulk|1000|team|50|25|church|group\b/.test(text)) return 'Bulk / group order';
  if (/\bartwork|design|logo|mockup|image|picture\b/.test(text)) return 'Artwork / design help';
  if (/\bshipping|delivery|address|zip\b/.test(text)) return 'Shipping / delivery';
  if (/\bprice|quote|cost|\$\d|minimum\b/.test(text)) return 'Pricing / quote';
  if (chat.outcome === 'ABANDONED') return 'Abandoned lead';
  return 'General order inquiry';
}

function parseMessages(lines) {
  const start = lines.findIndex(l => l === 'Complete conversation:');
  if (start < 0) return [];
  const body = lines.slice(start + 1);
  const messages = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    let text = compact(current.parts).join('\n').trim();
    const marker = current.suffix || '';
    const artworkMarker = /\[customer artwork shared|mockup|design back/i.test(`${marker}\n${text}`);
    text = text.replace(/\[(FIRST|LAST)\]/gi, '').replace(/\[customer artwork shared[^\]]*\]/gi, '').trim();
    text = text.replace(/\[sent a mockup \/ design back\]/gi, 'Sent a mockup / design back.').trim();
    if (!text && current.is_artwork) text = 'Customer shared artwork.';
    if (!text && artworkMarker) text = current.role === 'agent' ? 'Sent a mockup / design back.' : 'Customer shared artwork.';
    if (text) {
      messages.push({
        role: current.role,
        sent_at: current.sent_at || '',
        body: text,
        is_artwork: current.is_artwork || artworkMarker ? 1 : 0,
        original_marker: marker,
      });
    }
    current = null;
  };

  for (const raw of body) {
    const line = String(raw || '').trim();
    if (!line) continue;
    const artwork = line.match(/^Customer shared (?:their artwork|artwork\/image):\s*(?:\(([^)]+)\))?\s*(.*)$/);
    const role = line.match(/^(Agent|Customer):\s*(?:\(([^)]+)\))?\s*(.*)$/);
    if (artwork || role) {
      flush();
      current = {
        role: artwork ? 'customer' : role[1].toLowerCase(),
        sent_at: artwork ? (artwork[1] || '') : (role[2] || ''),
        suffix: artwork ? (artwork[2] || '') : (role[3] || ''),
        parts: [],
        is_artwork: !!artwork,
      };
      if (current.suffix && !/^\[(FIRST|LAST)\]$/i.test(current.suffix)) current.parts.push(current.suffix);
    } else if (current) {
      current.parts.push(line);
    }
  }
  flush();
  return messages;
}

export async function extractArtworkImages(sourcePath) {
  fs.mkdirSync(ARTWORK_DIR, { recursive: true });
  for (const file of fs.readdirSync(ARTWORK_DIR)) {
    if (/^(artwork-\d+|image\d+)\./.test(file)) fs.unlinkSync(path.join(ARTWORK_DIR, file));
  }
  const zip = await JSZip.loadAsync(fs.readFileSync(sourcePath));
  const media = Object.values(zip.files)
    .filter(file => !file.dir && /^word\/media\//i.test(file.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  for (const file of media) {
    const filename = path.basename(file.name);
    const buffer = await file.async('nodebuffer');
    fs.writeFileSync(path.join(ARTWORK_DIR, filename), buffer);
  }
  return fs.readdirSync(ARTWORK_DIR)
    .filter(f => /^(artwork-\d+|image\d+)\./.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export async function parseRealChats(sourcePath) {
  const { value } = await mammoth.extractRawText({ path: sourcePath });
  const artworkTargets = await artworkTargetsByChat(sourcePath);
  const rawLines = value.split(/\r?\n/);
  const headers = [];
  rawLines.forEach((line, i) => {
    const m = String(line || '').trim().match(/^(\d+)\.\s+(.+?)\s+—\s+.*\b(ORDERED|ABANDONED|LEFT WITHOUT ORDERING)\b/i);
    if (m) headers.push({
      index: i,
      number: Number(m[1]),
      customer_name: m[2].trim(),
      outcome: /ORDERED/i.test(m[3]) && !/WITHOUT/i.test(m[3]) ? 'ORDERED' : 'ABANDONED',
    });
  });

  return headers.map((h, pos) => {
    const end = headers[pos + 1]?.index ?? rawLines.length;
    const lines = compact(rawLines.slice(h.index + 1, end));
    const messagesText = nextValue(lines, 'Messages');
    const messages = parseMessages(lines);
    const targets = [...(artworkTargets[h.number] || [])];
    for (const m of messages) {
      if (m.is_artwork && m.role === 'customer') m.attachment_path = targets.shift() || null;
    }
    const chat = {
      ...h,
      order_value: nextValue(lines, 'Order value'),
      products_discussed: nextValue(lines, 'Products discussed'),
      stage_reached: nextValue(lines, 'Stage reached'),
      message_count: Number((messagesText.match(/\d+/) || [0])[0]) || null,
      artwork_count: Number((messagesText.match(/artworks shared:\s*(\d+)/i) || [0, 0])[1]) || 0,
      summary: nextValue(lines, 'What happened'),
      source_filename: path.basename(sourcePath),
      messages,
    };
    chat.intent = inferIntent(chat);
    return chat;
  });
}

export async function importRealChats(sourcePath = path.join(process.cwd(), SOURCE_FILE)) {
  if (!fs.existsSync(sourcePath)) throw new Error(`Real chat source not found: ${sourcePath}`);
  const chats = await parseRealChats(sourcePath);
  const images = await extractArtworkImages(sourcePath);

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM real_chat_sessions').run();
    db.prepare('DELETE FROM real_chat_messages').run();
    db.prepare('DELETE FROM real_chats').run();

    for (const chat of chats) {
      const chatId = uuid();
      db.prepare(`INSERT INTO real_chats
        (id, source_number, customer_name, outcome, order_value, products_discussed, stage_reached,
         intent, message_count, artwork_count, summary, source_filename)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(chatId, chat.number, chat.customer_name, chat.outcome, chat.order_value, chat.products_discussed,
          chat.stage_reached, chat.intent, chat.message_count, chat.artwork_count, chat.summary, chat.source_filename);

      chat.messages.forEach((m, idx) => {
        const attachment = m.is_artwork && m.role === 'customer' ? m.attachment_path || null : null;
        db.prepare(`INSERT INTO real_chat_messages
          (id, chat_id, message_index, role, body, sent_at, is_artwork, attachment_path, original_marker)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(uuid(), chatId, idx, m.role, m.body, m.sent_at, m.is_artwork, attachment, m.original_marker || '');
      });
    }
  });
  tx();
  return { chats: chats.length, images: images.length };
}

export function realChatList() {
  return db.prepare(`
    SELECT rc.*,
      (SELECT COUNT(*) FROM real_chat_messages m WHERE m.chat_id = rc.id AND m.role = 'customer') AS customer_messages,
      (SELECT COUNT(*) FROM real_chat_messages m WHERE m.chat_id = rc.id AND m.role = 'agent') AS agent_messages
    FROM real_chats rc
    ORDER BY rc.source_number
  `).all();
}

export function realChatMessages(chatId) {
  return db.prepare('SELECT * FROM real_chat_messages WHERE chat_id = ? ORDER BY message_index').all(chatId);
}

export function artworkPath(filename) {
  if (!filename || filename.includes('..') || /[\\/]/.test(filename)) return null;
  const full = path.join(ARTWORK_DIR, filename);
  return fs.existsSync(full) ? full : null;
}
