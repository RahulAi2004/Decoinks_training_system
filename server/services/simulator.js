// Customer simulator — role-plays a realistic Decoinks customer from a persona,
// grounded in KB context. Falls back to scripted persona lines in mock mode.
import db from '../db.js';
import { completeText, resolveProvider } from '../llm.js';
import { kbContext } from '../rag.js';

// Scripted fallback lines per persona (mock mode), keyed by persona name substring.
const MOCK_SCRIPTS = {
  default: [
    'Hi, how much for custom shirts?',
    'I don’t have a design yet, can you help with that?',
    'Okay. How long does shipping take?',
    'Sounds good. What’s the minimum I can order?',
    'Alright, I’ll think about it. Anything else I should know?',
    'Thanks, I’ll send my artwork soon.',
  ],
  'Price shopper': ['How much?', 'That seems expensive. Can you do better?', 'What exactly do I get for $25?', 'Hmm okay. And shipping cost?', 'Let me think about it.'],
  'Bulk buyer': ['I run a small clothing brand. Do you do bulk DTF?', 'What’s the deal on 1000 inches?', 'How fast can you turn around a bulk order?', 'What payment methods do you take?', 'Great, I’ll get you the designs this week.'],
  'Rush deadline': ['I need 30 shirts by Friday, can you do it??', 'Friday is the ABSOLUTE latest. Are you sure?', 'How much extra is rush shipping?', 'Fine. What do you need from me right now?'],
  'Spanish': ['Hola, ¿cuánto cuestan las transferencias DTF?', '¿Cuál es el pedido mínimo?', '¿Cuánto tarda el envío a Florida?', 'Perfecto, ¿cómo puedo pagar?', 'Muchas gracias.'],
  'Complaint': ['My order arrived and two shirts have the WRONG design. Not happy.', 'This was for an event this weekend. What are you going to do about it?', 'I don’t want a discount, I want it fixed.', 'Okay. How fast can the replacement ship?'],
  'Comparison': ['Someone else quoted me $4 per foot. Why should I pay more?', 'They also said next-day delivery. Can you match that?', 'What makes your quality better?', 'Alright, send me the details.'],
  'Church': ['Hi! I’m ordering shirts for our church group, about 25 people.', 'We need mixed sizes, is that okay?', 'Can you put names on the back?', 'When would we need to order by to get them in 3 weeks?'],
  'Indecisive': ['Hi, I’m not sure what I want yet...', 'Maybe shirts? Or hoodies? What do most people do?', 'What would you recommend for a family reunion?', 'Hmm, let me ask my sister. What was the price again?'],
  'Artwork': ['I want shirts but my logo is just a photo on my phone. Is that ok?', 'It’s kind of blurry. Does that matter?', 'Can you clean it up? How much extra?', 'Okay, I’ll send the photo now.'],
  'First-time': ['Hi, I’ve never ordered custom shirts before. How does this work?', 'What’s DTF exactly?', 'I only need like 3 shirts, is that too few?', 'Okay great. How do I pay?'],
};

function scriptFor(personaName) {
  const key = Object.keys(MOCK_SCRIPTS).find(k => k !== 'default' && personaName?.toLowerCase().includes(k.toLowerCase()));
  return MOCK_SCRIPTS[key] || MOCK_SCRIPTS.default;
}

export async function customerReply({ session, persona, conversation }) {
  const { provider } = resolveProvider();
  const customerTurns = conversation.filter(m => m.role === 'customer').length;

  if (provider === 'mock') {
    const script = scriptFor(persona?.name);
    return script[Math.min(customerTurns, script.length - 1)];
  }

  const lastIntern = [...conversation].reverse().find(m => m.role === 'intern');
  const kb = await kbContext(lastIntern ? lastIntern.body : (persona?.description || 'custom apparel DTF order'), { k: 4 });
  const convo = conversation.map(m => ({ role: m.role === 'customer' ? 'assistant' : 'user', content: m.body }));
  if (!convo.length) convo.push({ role: 'user', content: '(The customer opens the chat — send your first message.)' });

  const text = await completeText({
    system:
`You are role-playing a CUSTOMER messaging Decoinks (custom apparel + DTF transfer print shop) on Facebook Messenger. Stay in character the entire time.

PERSONA: ${persona?.name || 'Customer'} — ${persona?.description || ''}
${persona?.prompt || ''}

Context about the real business (so your questions/objections are realistic — you are a customer, you do NOT know internal details):
${kb}

Rules:
- Write like a real Messenger customer: short (1-2 sentences), casual, sometimes vague, occasional typos ok.
- You have a concrete goal; pursue it. React to what the agent says. Object, negotiate, or get confused like a real person.
- If the agent handles you well, gradually move toward buying. If they're vague or wrong, push back.
- NEVER break character, never mention being an AI, never evaluate the agent.`,
    messages: convo,
    maxTokens: 150,
  });
  return (text || '').trim() || scriptFor(persona?.name)[Math.min(customerTurns, 5)];
}

export function getPersona(id) {
  return db.prepare('SELECT * FROM personas WHERE id = ?').get(id);
}
