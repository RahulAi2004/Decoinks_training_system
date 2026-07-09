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

export function withPossibleArtwork(text, { force = false } = {}) {
  const shouldAttach = force || /\b(art|artwork|design|logo|picture|pic|image|mock ?up|file|photo|shirt)\b/i.test(text);
  if (!shouldAttach) return text;
  const url = randomArtworkUrl();
  if (!url) return text;
  return `${text}\n[[artwork:${url}]]`;
}

export async function nextCustomerMessage({ style, questions, nextIndex, conversation }) {
  const fallback = questions.length ? questions[nextIndex % questions.length] : 'How much does it cost?';
  const { provider } = resolveProvider();
  if (provider === 'mock') return fallback;

  const examples = questions.slice(0, 20).map((q, i) => `${i + 1}. ${q}`).join('\n');
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
- Ask about ONE thing only. Never bundle price + examples + shipping + order details in the same message.
- Keep it like a real customer chat: short, incomplete, casual, sometimes unclear.
- Maximum 12 words unless the selected writing style genuinely requires a longer broken sentence.
- Do not sound professional, scripted, or like a lead form.
- React naturally to the intern's last reply.
- Send exactly 1 chat bubble.
- If a design/artwork is relevant, describe it like a customer would: broken file, blurry picture, unclear design, old laptop files, image not clear, needs mockup.
- Do not say you are an AI, persona, trainee, or practice scenario. You are just the customer.`,
      messages: [{
        role: 'user',
        content:
`REAL CUSTOMER EXAMPLES:
${examples}

CONVERSATION SO FAR:
${convo || '(Start the chat.)'}

${isOpening ? `Opening message instruction:
Start with a very short design/artwork message, for example "can you make this", "how much for this", "you can do this?", or similar in the chosen style.` : `Suggested next source question if useful:
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
