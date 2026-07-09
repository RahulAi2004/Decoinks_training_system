// Parses "Decoinks — 10 Complete Order Flows" into customer-conversation
// blueprints used to drive the Talk-to-customer AI. These are 10 COMPLETE
// sales flows (inquiry → price → design → mockup → confirm → invoice → paid →
// shipping), each in a different broken/real writing style. The AI customer
// walks the intern through this flow using the exact customer message style.
import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';

const CANDIDATES = [
  path.join(process.cwd(), 'Decoinks-10-Complete-Order-Flows.docx'),
  path.join(process.cwd(), 'content', 'training', 'Decoinks-10-Complete-Order-Flows.docx'),
];

// Canonical flow every chat follows (from the document's own checklist).
export const ORDER_FLOW_STAGES = [
  'opening: customer greets or shows interest',
  'price: customer asks the cost / price per unit',
  'design: customer shares or describes their design and size',
  'mockup: customer reacts to the mockup / options we sent',
  'confirm: customer confirms or approves quantity / design',
  'invoice: customer asks how to pay or place the order',
  'payment: customer says paid or asks about payment method',
  'shipping: customer asks when / how it ships or arrives',
];

let cache = null;

function sourcePath() {
  return CANDIDATES.find(f => fs.existsSync(f)) || CANDIDATES[0];
}

function clean(text) {
  return String(text || '')
    .replace(/\*\*/g, '')                 // mammoth bold markers
    .replace(/\[(FIRST|LAST)\]/gi, '')    // position markers
    .replace(/\s+/g, ' ')
    .trim();
}

function afterLabel(lines, label) {
  const i = lines.findIndex(l => l.toLowerCase() === label.toLowerCase());
  return i >= 0 ? clean(lines[i + 1] || '') : '';
}

// Extract the ordered list of CUSTOMER messages from one flow's conversation.
function parseCustomerMessages(lines) {
  const start = lines.findIndex(l => /^Full conversation/i.test(l));
  if (start < 0) return { messages: [], artworkShares: 0 };
  const body = lines.slice(start + 1);

  const messages = [];
  let artworkShares = 0;
  let mode = null;      // 'customer' | 'agent' | null
  let buffer = [];

  const flush = () => {
    if (mode === 'customer') {
      const text = clean(buffer.join(' '));
      if (text) messages.push(text);
    }
    buffer = [];
  };

  for (const raw of body) {
    const line = String(raw || '').trim();
    if (!line) continue;

    // Speaker / marker lines
    if (/^Customer shared/i.test(line)) {   // customer sent a design image
      flush();
      mode = null;
      artworkShares += 1;
      continue;
    }
    if (/^\[?Agent sent/i.test(line)) {     // "[Agent sent a mockup/design]"
      flush();
      mode = null;
      continue;
    }
    const speaker = line.match(/^(Customer|Agent):\s*(?:\(([^)]+)\))?\s*(.*)$/i);
    if (speaker) {
      flush();
      mode = speaker[1].toLowerCase();
      const inline = clean(speaker[3] || '');
      if (mode === 'customer' && inline) buffer.push(inline);
      continue;
    }

    if (mode === 'customer') buffer.push(line);
  }
  flush();
  return { messages, artworkShares };
}

export async function orderFlowBlueprints() {
  if (cache) return cache;
  const file = sourcePath();
  if (!fs.existsSync(file)) {
    cache = [];
    return cache;
  }

  const { value } = await mammoth.extractRawText({ path: file });
  const rawLines = value.split(/\r?\n/);

  // Section headers look like: "1. Franklin Cruz  —  Spanish speaker".
  // The intro summary table lists names on separate lines, so we only accept a
  // header whose section actually contains a "Full conversation" block.
  const headers = [];
  rawLines.forEach((line, i) => {
    const m = String(line || '').trim().match(/^(\d{1,2})\.\s+(.+?)\s+[—–-]\s+(.+)$/);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 10) {
      headers.push({ index: i, number: Number(m[1]), customer_name: clean(m[2]), writing_style: clean(m[3]) });
    }
  });

  const blueprints = [];
  headers.forEach((h, pos) => {
    const end = headers[pos + 1]?.index ?? rawLines.length;
    const lines = rawLines.slice(h.index + 1, end).map(l => String(l || '').trim()).filter(Boolean);
    if (!lines.some(l => /^Full conversation/i.test(l))) return;

    const { messages } = parseCustomerMessages(lines);
    if (!messages.length) return;

    blueprints.push({
      number: h.number,
      customer_name: h.customer_name,
      writing_style: h.writing_style,
      intent: `${h.writing_style} — complete order flow`,
      products_discussed: afterLabel(lines, 'Products'),
      stage_reached: 'Shipping / delivery',
      summary: afterLabel(lines, 'What happened'),
      agent_tip: (lines.find(l => /^Agent tip:/i.test(l)) || '').replace(/^Agent tip:\s*/i, '').trim(),
      customer_messages: messages,
      artwork_urls: [],           // falls back to the shared real-chat artwork pool
      stages: ORDER_FLOW_STAGES,
      source: 'order_flow',
    });
  });

  cache = blueprints;
  return cache;
}

export async function randomOrderFlowBlueprint() {
  const flows = await orderFlowBlueprints();
  if (!flows.length) return null;
  return flows[Math.floor(Math.random() * flows.length)];
}
