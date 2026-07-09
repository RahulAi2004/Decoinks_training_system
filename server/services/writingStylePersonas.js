import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import { completeText, resolveProvider } from '../llm.js';

const CANDIDATES = [
  path.join(process.cwd(), 'Decoinks-Writing-Style-Personas.docx'),
  path.join(process.cwd(), 'content', 'training', 'Decoinks-Writing-Style-Personas.docx'),
  path.join(process.cwd(), 'decoinks-writting-style-personas.docx'),
];

let cache = null;

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function sourcePath() {
  return CANDIDATES.find(f => fs.existsSync(f)) || CANDIDATES[0];
}

function afterLabel(lines, label) {
  const i = lines.findIndex(x => x.toLowerCase() === label.toLowerCase());
  return i >= 0 ? (lines[i + 1] || '').trim() : '';
}

function parseQuestions(section) {
  const lines = section.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const start = lines.findIndex(x => /^20 real questions/i.test(x));
  if (start < 0) return [];
  return lines.slice(start + 1)
    .map(x => x.match(/^\d+\.\s*(.+)$/)?.[1]?.trim())
    .filter(Boolean);
}

export async function writingStyles() {
  if (cache) return cache;
  const file = sourcePath();
  if (!fs.existsSync(file)) {
    cache = [];
    return cache;
  }
  const { value } = await mammoth.extractRawText({ path: file });
  const matches = [...value.matchAll(/(?:^|\n)(\d{1,2})\.\s+(.+?)\n\s*How they write/g)];
  const sections = matches.map((m, idx) => {
    const start = m.index + (m[0].startsWith('\n') ? 1 : 0);
    const end = matches[idx + 1]?.index ?? value.length;
    return { number: Number(m[1]), name: m[2].trim(), text: value.slice(start, end) };
  }).filter(x => x.number >= 1 && x.number <= 10);

  cache = sections.map(s => {
    const lines = s.text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const description = afterLabel(lines, 'How they write');
    const spotting = afterLabel(lines, 'How to spot them');
    const agent_tip = afterLabel(lines, 'Agent tip');
    const questions = parseQuestions(s.text);
    return {
      id: slug(s.name),
      number: s.number,
      name: s.name,
      description,
      spotting,
      agent_tip,
      questions,
      source_file: path.basename(file),
    };
  });
  return cache;
}

export async function getWritingStyle(id) {
  const styles = await writingStyles();
  return styles.find(s => s.id === id) || styles[0] || null;
}

// Match an order-flow customer to the matching persona (rich description),
// so the flow AND the writing style describe the SAME customer. Falls back to
// a style built straight from the flow's own label + real messages.
export async function styleForFlow(flow) {
  const target = String(flow?.writing_style || '').toLowerCase();
  if (target) {
    const styles = await writingStyles();
    const pairs = [
      ['spanish', 'spanish'], ['one-liner', 'one-liner'], ['emoji', 'emoji'],
      ['slang', 'texter'], ['texter', 'texter'], ['rambler', 'rambler'],
      ['no-punctuation', 'rambler'], ['polite', 'polite'], ['impatient', 'impatient'],
      ['bulk', 'bulk'], ['business', 'bulk'], ['multi-question', 'multi-question'],
      ['all-caps', 'all-caps'], ['shouter', 'all-caps'],
    ];
    for (const [needle, personaKey] of pairs) {
      if (target.includes(needle)) {
        const found = styles.find(s => s.name.toLowerCase().includes(personaKey));
        if (found) return { ...found, agent_tip: flow.agent_tip || found.agent_tip, questions: flow.customer_messages?.length ? flow.customer_messages : found.questions };
      }
    }
  }
  return {
    id: 'flow',
    name: flow?.writing_style || 'Customer',
    description: flow?.writing_style || 'real customer writing style',
    spotting: '',
    agent_tip: flow?.agent_tip || '',
    questions: flow?.customer_messages || [],
  };
}

export async function randomWritingStyle() {
  const styles = await writingStyles();
  if (!styles.length) return null;
  const normalChatStyles = styles.filter(s => !/multi-question|polite|detailed|bulk|business/i.test(`${s.name} ${s.description}`));
  const pool = normalChatStyles.length ? normalChatStyles : styles;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function randomArtworkUrl() {
  const dir = path.join(process.cwd(), 'data', 'real-chat-artwork');
  if (!fs.existsSync(dir)) return '';
  const files = fs.readdirSync(dir)
    .filter(name => /\.(png|jpe?g|webp|gif)$/i.test(name))
    .sort();
  if (!files.length) return '';
  const file = files[Math.floor(Math.random() * files.length)];
  return `/real-chat-artwork/${file}`;
}

export function withPossibleArtwork(text, { force = false, artworkUrl = '' } = {}) {
  const shouldAttach = force || /\b(art|artwork|design|logo|picture|pic|image|mock ?up|file|photo|shirt)\b/i.test(text);
  if (!shouldAttach) return text;
  const url = artworkUrl || randomArtworkUrl();
  if (!url) return text;
  return `${text}\n[[artwork:${url}]]`;
}

// Cheap yes/no check: has the intern actually closed the whole order?
// Used to auto-end a talk-to-customer session once the deal is done, instead
// of relying on the in-character customer to gracefully sign off.
export async function isOrderComplete({ conversation }) {
  const { provider } = resolveProvider();
  if (provider === 'mock') return false;
  const convo = conversation.slice(-16).map(m => `${m.role === 'customer' ? 'CUSTOMER' : 'AGENT'}: ${m.body}`).join('\n');
  try {
    const text = await completeText({
      system:
`You judge whether a Decoinks sales chat has reached a COMPLETED order.
An order is COMPLETE only when ALL of these have happened in the chat:
1) a price was given, 2) the design/mockup was handled, 3) quantity was confirmed,
4) payment was made or clearly arranged, AND 5) shipping/delivery was arranged.
If any step is still open, it is NOT complete.
Answer with exactly one word: YES or NO.`,
      messages: [{ role: 'user', content: `CHAT:\n${convo}\n\nIs the order fully completed? Answer YES or NO.` }],
      maxTokens: 3,
    });
    return /\byes\b/i.test(text);
  } catch (e) {
    console.error('order complete check error:', e.message);
    return false;
  }
}

export async function nextCustomerMessage({ style, questions, nextIndex, conversation, flow = null }) {
  const sourceMessages = flow?.customer_messages || [];
  const fallback = sourceMessages.length
    ? sourceMessages[nextIndex % sourceMessages.length]
    : questions.length
      ? questions[nextIndex % questions.length]
      : 'How much does it cost?';
  const { provider } = resolveProvider();
  if (provider === 'mock') return fallback;

  const examples = questions.slice(0, 20).map((q, i) => `${i + 1}. ${q}`).join('\n');
  const flowMessages = (flow?.customer_messages || []).slice(0, 12).map((m, i) => `${i + 1}. ${m}`).join('\n');
  const flowStages = flow?.stages || [];
  const stage = flowStages[Math.min(nextIndex, flowStages.length - 1)] || flowStages.at?.(-1) || 'continue the customer inquiry';
  const convo = conversation.slice(-10).map(m => `${m.role === 'customer' ? 'CUSTOMER' : 'INTERN'}: ${m.body}`).join('\n');
  const isOpening = conversation.length === 0;
  try {
    const text = await completeText({
      system:
`You are a real Decoinks customer chatting in Messenger.

CUSTOMER WRITING STYLE: ${style.name}
HOW THEY WRITE: ${style.description}
HOW TO SPOT THEM: ${style.spotting || ''}

Write ONLY the next customer message. Do not evaluate the intern. Do not explain yourself.

Rules:
- Stay in this customer's writing style exactly: typos, slang, caps, emojis, broken wording, Spanish, urgency, or multi-question format as appropriate.
- Use the examples as the writing pattern, not as a checklist.
- Follow the real chat flow. Move only one stage forward at a time.
- Ask about ONE thing only. Never bundle price + examples + shipping + order details in the same message unless the real source message did.
- Keep it like a real customer chat: short, incomplete, casual, sometimes unclear.
- Maximum 12 words unless the selected writing style genuinely requires a longer broken sentence.
- Do not sound professional, scripted, or like a lead form.
- React naturally to the intern's last reply.
- Send exactly 1 chat bubble.
- If a design/artwork is relevant, describe it like a customer would: broken file, blurry picture, unclear design, old laptop files, image not clear, needs mockup.
- Keep the conversation going in your style until the ORDER is actually done. Do NOT stop just because there were only a few example messages — keep asking naturally until every step is handled.
- The order is DONE only after the intern has: given a price, handled your design/mockup, confirmed quantity, AND arranged payment + shipping/delivery. When (and only when) all of that is done and you are satisfied, send a short happy closing in your style (e.g. "ok paid, thanks!", "gracias, listo", "perfect see you") and end the message with the exact tag [[DONE]].
- If the order is NOT fully done yet, keep chatting and NEVER write [[DONE]].
- Do not say you are an AI, persona, trainee, or practice scenario. You are just the customer.`,
      messages: [{
        role: 'user',
        content:
`REAL CUSTOMER EXAMPLES:
${examples}

REAL CHAT FLOW TO IMITATE:
Intent: ${flow?.intent || 'custom shirts / DTF inquiry'}
Products: ${flow?.products_discussed || ''}
Stage reached in source chat: ${flow?.stage_reached || ''}
Summary: ${flow?.summary || ''}
Actual customer message sequence:
${flowMessages || '(No source sequence available.)'}

CONVERSATION SO FAR:
${convo || '(Start the chat.)'}

${isOpening ? `Opening message instruction:
Start like the source customer starts. If artwork is attached, keep text tiny: "can you make this", "how much for this", "you can do this?", or similar.` : `Current flow stage:
${stage}

Suggested source message to adapt:
${fallback}
`}

Return the next customer message only.`,
      }],
      maxTokens: 55,
    });
    return text.trim() || fallback;
  } catch (e) {
    console.error('writing style customer error:', e.message);
    return fallback;
  }
}
