// Create a demo intern and generate realistic activity (practice sessions, scenarios,
// quiz) so every dashboard/chart has something to show. Idempotent-ish: re-running adds
// more activity. Usage: node server/seed-demo-intern.js   (server must be running on :4000)
import 'dotenv/config';
import db from './db.js';
import { createUser } from './auth.js';

const B = 'http://localhost:4000';
const DEMO = { name: 'Demo Intern', email: 'intern@decoinks.com', password: 'intern123' };

// 1. Ensure the intern exists.
if (!db.prepare('SELECT 1 FROM users WHERE email = ?').get(DEMO.email)) {
  createUser({ name: DEMO.name, email: DEMO.email, password: DEMO.password, role: 'intern' });
  console.log(`✓ Created intern: ${DEMO.email} / ${DEMO.password}`);
} else {
  console.log(`intern exists: ${DEMO.email}`);
}

const j = async (u, o = {}) => {
  const r = await fetch(B + u, o);
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { _status: r.status, _raw: t.slice(0, 120) }; }
};

const { token } = await j('/api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: DEMO.email, password: DEMO.password }),
});
if (!token) { console.error('login failed — is the server running on :4000?'); process.exit(1); }
const H = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };

// ---------- practice sessions (varied quality so scores/weak-areas show) ----------
async function runSession(personaMatch, replies) {
  const personas = await j('/api/practice/personas', { headers: H });
  const p = personas.find(x => x.name.toLowerCase().includes(personaMatch)) || personas[0];
  const sess = await j('/api/practice/sessions', { method: 'POST', headers: H, body: JSON.stringify({ persona_id: p.id }) });
  for (const body of replies) {
    await j(`/api/practice/sessions/${sess.session_id}/messages`, { method: 'POST', headers: H, body: JSON.stringify({ body }) });
  }
  const card = await j(`/api/practice/sessions/${sess.session_id}/end`, { method: 'POST', headers: H, body: '{}' });
  console.log(`  practice · ${p.name}: overall ${card.overall} over ${card.turn_count} turns`);
}

console.log('Generating practice sessions…');
await runSession('price', [
  'Hey there! 😊 Happy to help! Our minimum is $25, which is about 60 inches of DTF transfers. Could you send your design, size, and quantity so I can get you an exact price?',
  'It kind of depends on what you need.',
  'Great question! Pricing is based on design size and quantity. If you go bigger, our 1000-inch offer gives you 100 inches free plus 10% off. Want me to help size your artwork?',
  'Awesome — send your artwork and I\'ll prepare a mockup and the best price right away! 🔥',
]);
await runSession('rush', [
  'Hey! 😊 Yes, we can help with a rush order. Production is 1–2 business days and US shipping is 2–5 days, and we also offer rush/overnight. What\'s your deadline and design?',
  'For sure, you\'ll 100% get it by tomorrow, guaranteed!',
  'Send over your design, size, and quantity and I\'ll confirm the exact timeline for your date. 😊',
]);

// ---------- scenarios (graded against the real best reply) ----------
console.log('Generating scenario attempts…');
const scenarioReplies = [
  'Hey there! 😊 Our minimum order is $25, which is roughly 60 inches of DTF transfers. Send your artwork and I\'ll help you size it!',
  'Our minimum order is $30 and shipping is free everywhere.', // intentional wrong fact → shows grading
  'Production takes 1–2 business days, then standard shipping is 2–5 business days in the USA. Need it faster? We offer rush options too!',
  'Absolutely! Custom design help is free with your order 🎉 What did you have in mind?',
  'Yes! Buy 1000 inches and get 100 inches FREE plus an extra 10% off. Want me to size your designs?',
];
for (const reply of scenarioReplies) {
  const s = await j('/api/scenarios/next', { headers: H });
  if (!s?.id) break;
  const r = await j(`/api/scenarios/${s.id}/attempt`, { method: 'POST', headers: H, body: JSON.stringify({ reply }) });
  console.log(`  scenario · ${String(s.question).slice(0, 40)}… → ${r.evaluation?.overall}`);
}

// ---------- quiz round ----------
console.log('Generating a quiz round…');
const round = await j('/api/quizzes/round', { headers: H });
const quizzes = Array.isArray(round) ? round : (round.quizzes || round.questions || []);
let correct = 0;
for (const q of quizzes) {
  let answer;
  if (q.type === 'mcq') {
    const opts = Array.isArray(q.options) ? q.options : JSON.parse(q.options || '[]');
    // pick the option that best matches known canonical facts, else the first
    answer = opts.find(o => /\$25|60 inch|2 piece|5 feet|1[–-]2 business|1000|100 inches free|zelle|paypal|corona|mockup/i.test(o)) || opts[0];
  } else {
    answer = 'Our minimum order is $25, about 60 inches of DTF transfers.';
  }
  const r = await j(`/api/quizzes/${q.id}/attempt`, { method: 'POST', headers: H, body: JSON.stringify({ answer }) });
  if (r.is_correct || (r.score ?? 0) >= 60) correct++;
}
console.log(`  quiz: ${correct}/${quizzes.length} correct-ish`);

// ---------- final readiness ----------
const me = await j('/api/metrics/me', { headers: H }).catch(() => null);
console.log('\nDone. Demo intern is populated.');
if (me?.readiness != null || me?.readiness_score != null) {
  console.log(`Readiness: ${me.readiness ?? me.readiness_score}`);
}
console.log(`Login: ${DEMO.email} / ${DEMO.password}`);
process.exit(0);
