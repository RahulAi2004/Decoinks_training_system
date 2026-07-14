// Translation for Spanish customers. Two uses:
//  • Read a customer's message in English — click "Translate" on any message.
//    The result is CACHED on the message row, so each message is only ever sent
//    to the LLM once no matter how often it is opened.
//  • Write a reply in English and turn it into Spanish before sending
//    (not cached — the text is new every time).
import db from '../db.js';
import { completeText, resolveProvider } from '../llm.js';

const LANG_NAME = { en: 'English', es: 'Spanish' };

function systemFor(to) {
  const target = LANG_NAME[to] || 'English';
  return `You are a translator for a custom-printing shop (Decoinks). Translate the user's message into ${target}.
Keep the meaning, tone and any prices, sizes, quantities and product names exactly. Keep it natural and casual, like real chat.
If the text is already ${target}, return it unchanged.
Return ONLY the translation — no quotes, no notes, no explanation.`;
}

// Raw text translation. Returns '' when no LLM is configured (mock provider).
export async function translateText(text, to = 'en') {
  const clean = String(text || '').trim();
  if (!clean) return '';
  const { provider } = resolveProvider();
  if (provider === 'mock') return '';
  const out = await completeText({
    system: systemFor(to),
    messages: [{ role: 'user', content: clean }],
    maxTokens: 400,
  });
  return String(out || '').trim();
}

// Translate one stored message and cache the result on its row.
// table: 'session_messages' | 'real_chat_messages'
async function translateStored(table, id) {
  const row = db.prepare(`SELECT id, body, translation_en FROM ${table} WHERE id = ?`).get(id);
  if (!row) return null;
  if (row.translation_en) return { translation: row.translation_en, cached: true };

  // Strip the artwork marker so it is not translated as text.
  const body = String(row.body || '').replace(/\n?\[\[artwork:.+?\]\]\s*$/, '').trim();
  const translation = await translateText(body, 'en');
  if (!translation) return { translation: '', cached: false };
  db.prepare(`UPDATE ${table} SET translation_en = ? WHERE id = ?`).run(translation, id);
  return { translation, cached: false };
}

export const translateSessionMessage = (id) => translateStored('session_messages', id);
export const translateRealChatMessage = (id) => translateStored('real_chat_messages', id);
