import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import { completeText, resolveProvider } from '../llm.js';
import { getPrompt } from './prompts.js';

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
      system: getPrompt('order_complete_check'),
      messages: [{ role: 'user', content: `CHAT:\n${convo}\n\nHas the agent confirmed both payment and shipping? Answer YES or NO.` }],
      maxTokens: 3,
    });
    return /\byes\b/i.test(text);
  } catch (e) {
    console.error('order complete check error:', e.message);
    return false;
  }
}

export async function nextCustomerMessage({ style, questions, nextIndex, conversation, flow = null, approvedExamples = [], realExamples = [] }) {
  const sourceMessages = flow?.customer_messages || [];
  const fallback = sourceMessages.length
    ? sourceMessages[nextIndex % sourceMessages.length]
    : questions.length
      ? questions[nextIndex % questions.length]
      : 'How much does it cost?';
  const { provider } = resolveProvider();
  if (provider === 'mock') return fallback;

  const examples = questions.slice(0, 20).map((q, i) => `${i + 1}. ${q}`).join('\n');
  const approved = (approvedExamples || []).slice(0, 15).map((m, i) => `${i + 1}. ${m}`).join('\n');
  const realCustomer = (realExamples || []).slice(0, 8).map((m, i) => `${i + 1}. ${m}`).join('\n');
  const flowMessages = (flow?.customer_messages || []).slice(0, 12).map((m, i) => `${i + 1}. ${m}`).join('\n');
  const flowStages = flow?.stages || [];
  const stage = flowStages[Math.min(nextIndex, flowStages.length - 1)] || flowStages.at?.(-1) || 'continue the customer inquiry';
  const convo = conversation.slice(-10).map(m => `${m.role === 'customer' ? 'CUSTOMER' : 'INTERN'}: ${m.body}`).join('\n');
  const isOpening = conversation.length === 0;
  const lastIntern = [...conversation].reverse().find(m => m.role === 'intern')?.body || '';
  try {
    const text = await completeText({
      system: getPrompt('customer_system', {
        style_name: style.name,
        style_description: style.description,
        style_spotting: style.spotting || '',
      }),
      messages: [{
        role: 'user',
        content:
`${approved ? `ADMIN-APPROVED GOOD CUSTOMER MESSAGES (imitate this quality and phrasing most of all):
${approved}

` : ''}${realCustomer ? `REAL CUSTOMER MESSAGES FROM PAST CHATS (how real customers actually wrote in similar moments):
${realCustomer}

` : ''}REAL CUSTOMER EXAMPLES:
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
Open the way a real customer starts a chat — a short greeting or a clear first question that says WHAT they want, in your style. For example: "hi do you make custom shirts?", "hello, can you print this design?", "hey do you do DTF transfers?", "hi how much for custom hoodies?". NEVER open with a bare "how much" or "what" with no product context. If artwork is attached, a tiny "can you make this?" is fine.` : `THE INTERN JUST SAID:
"${lastIntern}"

Your job now, in your persona style:
1. First, directly answer or react to what the intern just said above.
2. Then, if it makes sense, nudge the order one step forward (current stage: ${stage}).
Only fall back to this scripted idea if the intern did NOT ask you anything specific: "${fallback}"
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
