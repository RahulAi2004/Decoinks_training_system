// Seed: demo admin + intern, the 10 configurable personas, default settings, and a
// starter quiz bank whose facts come from the ingested content (content/qa + knowledge).
import 'dotenv/config';
import db, { uuid, setSetting, DEFAULT_SETTINGS } from './db.js';
import { createUser } from './auth.js';

function upsertUser({ name, email, password, role }) {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return console.log(`  user exists: ${email}`);
  createUser({ name, email, password, role });
  console.log(`  ✓ ${role}: ${email} / ${password}`);
}

console.log('Seeding users…');
// Real admin from .env (ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME). No demo accounts.
// Admins create interns from the Admin → Interns page.
if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  upsertUser({ name: process.env.ADMIN_NAME || 'Admin', email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD, role: 'admin' });
} else {
  console.log('  ⚠ No ADMIN_EMAIL/ADMIN_PASSWORD in .env — skipping admin creation. Add them and re-run.');
}

console.log('Seeding settings…');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
  if (!db.prepare('SELECT 1 FROM settings WHERE key = ?').get(k)) setSetting(k, v);
}

console.log('Seeding personas…');
const PERSONAS = [
  ['Price shopper', 'Opens with "how much?" and pushes on price before giving any details. Goal: get the cheapest possible deal.', 'easy',
   'You refuse to share design/size/quantity until asked clearly. If quoted a price before being qualified, act pleased (this is a trap — the agent should qualify first).'],
  ['Bulk buyer / reseller', 'Runs a small clothing brand; wants bulk DTF gang sheets and the 1000-inch offer. Goal: negotiate the best bulk price and confirm turnaround.', 'medium',
   'Ask about the 1000 inches + 100 free offer, bulk discounts, and payment methods. Push for an extra discount once.'],
  ['Church / team group order', 'Ordering ~25 shirts for a church group, mixed sizes, names on backs, needs them in 3 weeks.', 'medium',
   'Be friendly but ask many logistics questions: mixed sizes, name personalisation, deadline feasibility.'],
  ['Rush deadline', 'Needs 30 shirts by Friday for an event. Stressed and impatient. Goal: confirm the deadline is possible and pay fast.', 'hard',
   'Keep pressing on the deadline. If the agent promises a date the KB doesn\'t support, act relieved (trap). Ask about rush shipping cost.'],
  ['Spanish-speaking customer', 'Writes only in Spanish. Wants DTF transfer prices, minimum order, and shipping to Florida.', 'medium',
   'Write EVERY message in Spanish. If the agent replies in English, say you don\'t understand English well ("No entiendo bien el inglés").'],
  ['Indecisive customer', 'Not sure what they want — shirts? hoodies? Goal: be guided to a concrete order.', 'medium',
   'Give vague answers, change your mind once, and ask for recommendations. Reward agents who ask good discovery questions.'],
  ['Artwork-not-ready', 'Only has a blurry phone photo of a logo. Goal: find out if it can be used or fixed.', 'medium',
   'Worry about quality. Ask if the design help costs extra (KB: custom design services are free with orders).'],
  ['Complaint / wrong item', 'Order arrived with the wrong design on two shirts, needed for an event this weekend. Upset.', 'hard',
   'Start angry. Do not accept a discount — you want it FIXED fast. Calm down only if the agent apologises, takes ownership, and offers a concrete fast resolution.'],
  ['Comparison shopper', 'Says a competitor quoted $4/ft and next-day delivery. Goal: be convinced or leave.', 'hard',
   'Challenge the agent to justify the price. React badly to badmouthing competitors; react well to concrete value (quality, free design, offers).'],
  ['First-time small order', 'Never ordered custom apparel; wants only 3 shirts; doesn\'t know what DTF is.', 'easy',
   'Ask basic questions (what is DTF, minimums, how to pay). You are easily confused by jargon.'],
];
const insPersona = db.prepare('INSERT INTO personas (id, name, description, difficulty, prompt) VALUES (?, ?, ?, ?, ?)');
for (const [name, description, difficulty, prompt] of PERSONAS) {
  if (!db.prepare('SELECT 1 FROM personas WHERE name = ?').get(name)) {
    insPersona.run(uuid(), name, description, difficulty, prompt);
    console.log(`  ✓ persona: ${name}`);
  }
}

console.log('Seeding starter quiz bank…');
// Facts sourced from the uploaded content (content/qa/questions.json + knowledge base) —
// the offline starter set; admins can generate more from the KB via LLM in the app.
const QUIZZES = [
  ['What is the minimum order for DTF transfers?', 'mcq', ['$25 (about 60 inches)', '$50 (about 100 inches)', '$10 (about 20 inches)', 'No minimum at all'], '$25 (about 60 inches)', 'Q&A: "Our minimum order is $25, which is approximately 60 inches of DTF transfers."'],
  ['What is the minimum quantity for custom t-shirts?', 'mcq', ['5 pieces', '1 piece', '12 pieces', '25 pieces'], '5 pieces', 'Q&A: "For custom t-shirts, our minimum order is 5 pieces."'],
  ['What is the gang sheet price?', 'mcq', ['$5 per foot (22" width)', '$5 per inch', '$10 per foot', '$1 per inch'], '$5 per foot (22" width)', 'Q&A: "We charge $5 per feet of the gangsheet (22” width)."'],
  ['What is the current bulk offer on 1000 inches?', 'mcq', ['Buy 1000 inches, get 100 inches free', 'Buy 1000 inches, get 500 inches free', '50% off over 1000 inches', 'Free shipping only'], 'Buy 1000 inches, get 100 inches free', 'Q&A: "Buy 1000 inches & Get 100 inches FREE."'],
  ['How long does production take before shipping?', 'mcq', ['1–2 business days', 'Same day always', '7–10 business days', '2 weeks'], '1–2 business days', 'Q&A: "Production takes 1–2 business days."'],
  ['How long does standard shipping take within the USA?', 'mcq', ['2–5 business days', 'Next day', '10–14 days', '1 month'], '2–5 business days', 'Q&A: "standard shipping taking 2–5 business days within the USA."'],
  ['Are Decoinks DTF transfers hot peel or cold peel?', 'mcq', ['Hot peel', 'Cold peel', 'Both, customer chooses', 'Neither'], 'Hot peel', 'Q&A: "Its hot peel."'],
  ['Where is Decoinks located?', 'mcq', ['Corona, California', 'Denver, Colorado', 'Austin, Texas', 'Miami, Florida'], 'Corona, California', 'Q&A: "Estamos en Corona, California. Hacemos envíos a todo el país."'],
  ['What is the Decoinks website?', 'short', [], 'decoinks.com', 'Q&A: "Our website is decoinks.com"'],
  ['Name three payment methods Decoinks accepts.', 'short', [], 'Zelle, PayPal, Venmo, Stripe, bank transfer, CashApp', 'Q&A: "We offer Zelle, Paypal, Venmo, stripe, bank transfer and cashapp."'],
  ['How much does custom design service cost with an order?', 'mcq', ['Free with the order', '$25 per design', '$10 per revision', '10% of order value'], 'Free with the order', 'Q&A: "Our custom design services are free with the order."'],
  ['Are the DTF transfers machine-wash safe?', 'mcq', ['Yes — durable for 20+ washes', 'No — hand wash only', 'Only in cold water', 'Only for 5 washes'], 'Yes — durable for 20+ washes', 'Q&A: "DTF printing is durable for more than 20 washes."'],
  ['What are the printshop hours and days?', 'short', [], '9 AM to 6 PM, Monday to Saturday; closed Sunday', 'Q&A: "Our printshop timing are 9-6 pm… open saturdays also, however sunday is off."'],
  ['A customer asks for a free physical sample. What do we offer instead?', 'short', [], 'Free digital mockups — no free physical samples', 'Policy: mockups only, no free physical samples.'],
  ['What should you collect BEFORE quoting a price?', 'short', [], 'Design (artwork), size, and quantity — plus shipping address for shipping cost', 'Training: always qualify with design + size + quantity first.'],
  ['Does Decoinks print business cards?', 'mcq', ['No — apparel and DTF transfers only', 'Yes', 'Only for bulk orders', 'Only laminated ones'], 'No — apparel and DTF transfers only', 'Q&A: "We don\'t do business cards, but we can definitely help you with custom apparel and DTF transfers!"'],
];
const insQuiz = db.prepare('INSERT INTO quizzes (id, question, type, options, correct_answer, source) VALUES (?, ?, ?, ?, ?, ?)');
let quizAdded = 0;
for (const [question, type, options, correct, source] of QUIZZES) {
  if (!db.prepare('SELECT 1 FROM quizzes WHERE question = ?').get(question)) {
    insQuiz.run(uuid(), question, type, JSON.stringify(options), correct, source);
    quizAdded++;
  }
}
console.log(`  ✓ ${quizAdded} quiz question(s) added`);

console.log('\nSeed complete. Login: admin@decoinks.com / admin123 · intern@decoinks.com / intern123');
