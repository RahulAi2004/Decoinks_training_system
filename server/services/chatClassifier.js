// One-time classification of the real customer chat library. Each chat is
// tagged with a product_type (dtf | tshirt | other) and chat_language
// (en | es | other) and the result is STORED on the row, so the admin filters
// never hit the LLM again. An LLM batch does the tagging; if the LLM is
// unavailable or errors, a keyword heuristic fills in so a run always completes.
//
// The library rows have no products_discussed/summary, so the product is only
// visible inside the conversation — and usually a few messages in, not in the
// opener ("what is the minimum order quantity?").
//
// We classify from the CUSTOMER's messages only. The agent's replies are canned
// shop boilerplate that name DTF in almost every chat ("Fast shipping 🚚 DTF
// transfers…"), so feeding them in tags the whole library "dtf". What the
// customer types is both the real product intent and the real language signal.
import db from '../db.js';
import { completeJSON } from '../llm.js';

const SUB_BATCH = 12;          // chats per LLM call
const DEFAULT_LIMIT = 60;      // chats classified per run() request (frontend loops)
const CONTEXT_CHARS = 700;     // per-chat cap on the customer's text

// Platform/boilerplate lines that arrive as "customer" rows but are not the
// customer speaking — they carry no product or language signal.
const NOISE = /^(customer shared (their )?(design|artwork)\.?|your ai agent will respond\.?|get started|.+ replied to (a|your) post\.?|hi .+! (please let us know|we wanted to follow up).*)$/i;

const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          i: { type: 'integer' },
          product_type: { type: 'string', enum: ['dtf', 'tshirt', 'other'] },
          language: { type: 'string', enum: ['en', 'es', 'other'] },
        },
        required: ['i', 'product_type', 'language'],
      },
    },
  },
  required: ['items'],
};

const SYSTEM = `You classify customer chats for Decoinks (a shop selling DTF heat transfers and custom-printed apparel).

You are shown ONLY what the CUSTOMER wrote (the shop's replies are hidden because they advertise DTF in every chat and would mislead you).

For each numbered chat return:
- product_type:
  "dtf"    = the chat actually mentions DTF / direct-to-film / heat transfers / gang sheet / sold by the inch / white underbase / pressing a transfer onto a garment.
  "tshirt" = the chat actually mentions custom printed apparel: t-shirts, tees, shirts, hoodies, sweatshirts, jerseys, polos, tank tops.
  "other"  = the customer never names a product (generic questions like minimum order quantity, shipping/delivery time, price, samples), or an unrelated product.
- language: the language the CUSTOMER writes in — "en", "es", or "other".

CRITICAL RULES:
- Do NOT guess or infer a product from the shop's catalogue. If the customer never names a product, you MUST return "other".
- Only return "dtf" or "tshirt" when the customer's own words really say it.
- "1000 inches", "gang sheet", "by the inch" = dtf (DTF is sold by the inch).
- If the customer asks for both, pick the one the order is actually for.
- Language: judge only from the customer's own words. English words = "en" even if the shop replies in Spanish.
Return exactly one item per input index.`;

export function classificationStatus() {
  const total = db.prepare('SELECT COUNT(*) AS n FROM real_chats').get().n;
  const classified = db.prepare('SELECT COUNT(*) AS n FROM real_chats WHERE product_type IS NOT NULL').get().n;
  return { total, classified, remaining: total - classified };
}

// Clear every tag so the next runs re-classify the whole library from scratch.
export function resetClassification() {
  db.prepare('UPDATE real_chats SET product_type = NULL, chat_language = NULL').run();
  return classificationStatus();
}

function chatMessages(chatId) {
  return db.prepare('SELECT role, body FROM real_chat_messages WHERE chat_id = ? ORDER BY message_index').all(chatId);
}

// Everything the customer actually typed (boilerplate stripped) — used both as
// the model's input and by the keyword fallback.
function chatContext(chat) {
  const said = chatMessages(chat.id)
    .filter(m => m.role === 'customer')
    .map(m => String(m.body || '').replace(/\s+/g, ' ').trim())
    .filter(t => t && !NOISE.test(t));
  const customerText = said.join(' | ').slice(0, CONTEXT_CHARS);
  const notes = chat.products_discussed ? `Order notes: ${chat.products_discussed}\n` : '';
  return {
    text: `${notes}Customer wrote: ${customerText || '(nothing specific — only greetings/boilerplate)'}`,
    customerText,
  };
}

function keywordProduct(text) {
  const t = text.toLowerCase();
  if (/\bdtf\b|direct[- ]to[- ]film|gang sheet|\btransfers?\b|white underbase|by the inch/.test(t)) return 'dtf';
  if (/\bt[- ]?shirts?\b|\btees?\b|\bshirts?\b|hoodie|sweatshirt|apparel|garment|jersey|polo|tank top/.test(t)) return 'tshirt';
  return 'other';   // no product named → do not guess
}

function keywordLanguage(customerText) {
  const t = customerText.toLowerCase();
  if (/[ñáéíóú¿¡]/.test(t) || /\b(hola|gracias|buenas|cu[aá]nto|cuesta|env[ií]o|camisetas?|playeras?|precio|pedido|quiero|necesito|tama[ñn]o|d[oó]nde|puedo)\b/.test(t)) return 'es';
  return 'en';
}

async function llmClassifySubBatch(contexts) {
  const lines = contexts.map((c, i) => `### Chat ${i}\n${c.text}`).join('\n\n');
  const result = await completeJSON({
    system: SYSTEM,
    messages: [{ role: 'user', content: `Classify these chats:\n\n${lines}` }],
    schema: CLASSIFY_SCHEMA,
    schemaName: 'chat_classification',
    maxTokens: 900,
  });
  return result?.items || null;   // null when provider is mock
}

// Classify up to `limit` still-unclassified chats. Returns progress so the caller
// can loop until remaining === 0.
export async function classifyBatch({ limit = DEFAULT_LIMIT } = {}) {
  const pending = db.prepare('SELECT * FROM real_chats WHERE product_type IS NULL ORDER BY source_number LIMIT ?').all(limit);
  const update = db.prepare('UPDATE real_chats SET product_type = ?, chat_language = ? WHERE id = ?');

  for (let start = 0; start < pending.length; start += SUB_BATCH) {
    const group = pending.slice(start, start + SUB_BATCH);
    const contexts = group.map(chatContext);
    let items = null;
    try { items = await llmClassifySubBatch(contexts); }
    catch (e) { console.error('classify LLM error, falling back to keywords:', e.message); }

    group.forEach((chat, i) => {
      const fromLlm = items?.find(x => x.i === i);
      const ctx = contexts[i];
      const tag = fromLlm
        ? { product_type: fromLlm.product_type, language: fromLlm.language }
        : { product_type: keywordProduct(ctx.customerText), language: keywordLanguage(ctx.customerText) };
      update.run(tag.product_type, tag.language, chat.id);
    });
  }

  // classified_now = this run; classified/total/remaining = library-wide progress.
  return { classified_now: pending.length, ...classificationStatus() };
}
