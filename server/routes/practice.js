// Practice chat: sessions with an AI customer; every intern reply is evaluated silently.
import { Router } from 'express';
import db, { uuid } from '../db.js';
import { customerReply, getPersona } from '../services/simulator.js';
import { evaluateReply } from '../services/evaluator.js';
import { computeReadiness } from '../services/readiness.js';
import { realChatList, realChatMessages, randomCustomerDesignUrl } from '../services/realChats.js';
import { getWritingStyle, isOrderComplete, nextCustomerMessage, randomArtworkUrl, randomWritingStyle, styleForFlow, writingStyles } from '../services/writingStylePersonas.js';
import { randomOrderFlowBlueprint } from '../services/orderFlows.js';
import { relevantExampleTexts } from '../services/customerExamples.js';
import { relevantRealCustomerMsgs } from '../services/realChatQa.js';
import { visibleMessages as supervisedVisible, autoReleaseIfDue, getSupervised, afterAgentReply } from '../services/supervised.js';
import { getLiveManual, liveManualPayload, addLiveManualMessage, claimLiveManual } from '../services/liveManual.js';
import { assignedChatsForTrainee, markAssignmentDone } from '../services/chatAssignments.js';

const r = Router();

function sessionMessages(sessionId) {
  return db.prepare('SELECT * FROM session_messages WHERE session_id = ? ORDER BY created_at, rowid').all(sessionId);
}

function visibleMessages(sessionId) {
  return sessionMessages(sessionId).map(m => {
    const match = m.body.match(/\n?\[\[artwork:(.+?)\]\]\s*$/);
    return match
      ? { ...m, body: m.body.replace(match[0], '').trim(), is_artwork: 1, attachment_url: match[1] }
      : m;
  });
}

function ownSession(req, res) {
  const s = db.prepare('SELECT * FROM practice_sessions WHERE id = ?').get(req.params.id);
  if (!s) { res.status(404).json({ error: 'Session not found' }); return null; }
  if (req.user.role !== 'admin' && s.intern_id !== req.user.id) { res.status(403).json({ error: 'Forbidden' }); return null; }
  return s;
}

r.get('/personas', (req, res) => {
  res.json(db.prepare('SELECT id, name, description, difficulty FROM personas WHERE is_active = 1 ORDER BY name').all());
});

r.get('/real-chats', (req, res) => {
  res.json(realChatList());
});

// Chats an admin assigned to this trainee (their "Assigned" tab).
r.get('/assigned-chats', (req, res) => {
  res.json(assignedChatsForTrainee(req.user.id));
});

r.get('/talk-styles', async (req, res) => {
  res.json(await writingStyles());
});

// start a session (persona_id optional → random)
r.post('/sessions', async (req, res) => {
  let { persona_id } = req.body || {};
  if (!persona_id) {
    const p = db.prepare('SELECT id FROM personas WHERE is_active = 1 ORDER BY RANDOM() LIMIT 1').get();
    persona_id = p?.id;
  }
  const persona = persona_id ? getPersona(persona_id) : null;
  const id = uuid();
  db.prepare('INSERT INTO practice_sessions (id, intern_id, persona_id) VALUES (?, ?, ?)').run(id, req.user.id, persona_id || null);

  // the customer opens the conversation
  let opener;
  try { opener = await customerReply({ session: { id }, persona, conversation: [] }); }
  catch (e) { opener = 'Hi! I saw your ad about custom shirts — can you tell me more?'; }
  db.prepare('INSERT INTO session_messages (id, session_id, role, body) VALUES (?, ?, ?, ?)').run(uuid(), id, 'customer', opener);

  res.json({ session_id: id, persona: persona ? { id: persona.id, name: persona.name, description: persona.description, difficulty: persona.difficulty } : null, messages: visibleMessages(id) });
});

r.get('/sessions/:id', (req, res) => {
  const s = ownSession(req, res); if (!s) return;
  const persona = s.persona_id ? getPersona(s.persona_id) : null;
  const messages = visibleMessages(s.id);
  const evals = db.prepare(
    `SELECT e.* FROM evaluations e JOIN session_messages m ON m.id = e.session_message_id WHERE m.session_id = ?`
  ).all(s.id).map(parseEval);
  const real = db.prepare(
    `SELECT rcs.*, rc.customer_name, rc.intent, rc.outcome, rc.summary
     FROM real_chat_sessions rcs JOIN real_chats rc ON rc.id = rcs.real_chat_id
     WHERE rcs.session_id = ?`
  ).get(s.id);
  res.json({ session: s, persona, real_chat: real || null, messages, evaluations: evals });
});

// intern sends a reply → store, evaluate silently, get next customer message
r.post('/sessions/:id/messages', async (req, res) => {
  const s = ownSession(req, res); if (!s) return;
  if (s.status !== 'active') return res.status(400).json({ error: 'Session has ended' });
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Empty message' });

  const before = sessionMessages(s.id);
  const lastCustomer = [...before].reverse().find(m => m.role === 'customer');
  const msgId = uuid();
  db.prepare('INSERT INTO session_messages (id, session_id, role, body) VALUES (?, ?, ?, ?)').run(msgId, s.id, 'intern', body);

  const persona = s.persona_id ? getPersona(s.persona_id) : null;
  const conversation = [...before, { role: 'intern', body }];

  // evaluate + simulate concurrently; neither failing should kill the turn
  const [evalResult, custText] = await Promise.all([
    evaluateReply({
      internId: s.intern_id, sessionMessageId: msgId,
      conversation, customerText: lastCustomer?.body || '', internReply: body,
    }).catch(e => { console.error('eval error:', e.message); return null; }),
    customerReply({ session: s, persona, conversation })
      .catch(e => { console.error('simulator error:', e.message); return 'Sorry, could you say that again?'; }),
  ]);

  db.prepare('INSERT INTO session_messages (id, session_id, role, body) VALUES (?, ?, ?, ?)').run(uuid(), s.id, 'customer', custText);
  res.json({ messages: visibleMessages(s.id), evaluation_recorded: !!evalResult });
});

function customerBody(m) {
  const url = m.attachment_path ? `/real-chat-artwork/${m.attachment_path}` : '';
  return url ? `${m.body}\n[[artwork:${url}]]` : m.body;
}

const TALK_FLOW_STAGES = [
  'opening: customer shows interest or shares artwork',
  'need: customer asks if Decoinks can make it / what product they need',
  'artwork: customer clarifies design, image quality, mockup, or file issue',
  'quantity and size: customer gives or asks about size, color, shirts, or transfers',
  'price: customer asks cost, quote, or minimum',
  'turnaround or shipping: customer asks when/how they can get it',
  'payment/order: customer asks how to pay or how to place order',
  'follow-up: customer hesitates, repeats, or asks one final practical question',
];

function compactCustomerText(m) {
  return String(m.body || '')
    .replace(/\[\[artwork:.+?\]\]/g, '')
    .replace(/^Customer shared artwork\.?$/i, '')
    .trim();
}

const DESIGN_HINT = /\b(design|logo|picture|pic|image|mock ?up|artwork|art|photo|attach|sample|example)\b/i;
// Attach the customer's single design image only once per session — either when
// the message clearly talks about a design, or at the design stage of the flow.
function customerBodyWithDesign(text, url, alreadyShared, forceDesignStage = false) {
  if (alreadyShared || !url) return text;
  if (forceDesignStage || DESIGN_HINT.test(text)) return `${text}\n[[artwork:${url}]]`;
  return text;
}

// Prefer the 10 complete order flows (full inquiry → paid → shipped, one per
// writing style). Fall back to the 25 real chats if the flows doc is missing.
async function pickTalkBlueprint() {
  const orderFlow = await randomOrderFlowBlueprint();
  if (orderFlow && orderFlow.customer_messages?.length) return orderFlow;

  const chats = realChatList().filter(c => Number(c.customer_messages || 0) > 0);
  const pool = chats.filter(c => Number(c.artwork_count || 0) > 0) || chats;
  const chat = (pool.length ? pool : chats)[Math.floor(Math.random() * (pool.length ? pool : chats).length)];
  if (!chat) return null;
  const messages = realChatMessages(chat.id).filter(m => m.role === 'customer');
  const customerMessages = messages.map(compactCustomerText).filter(Boolean);
  const artworkUrls = messages.map(m => m.attachment_path ? `/real-chat-artwork/${m.attachment_path}` : '').filter(Boolean);
  return {
    intent: chat.intent,
    products_discussed: chat.products_discussed,
    stage_reached: chat.stage_reached,
    summary: chat.summary,
    customer_messages: customerMessages,
    artwork_urls: artworkUrls,
    stages: TALK_FLOW_STAGES,
  };
}

function revealNextRealCustomerBlock(sessionId, chatId, fromIndex) {
  const originals = realChatMessages(chatId);
  let index = Number(fromIndex || 0);

  while (index < originals.length && originals[index].role === 'agent') index += 1;

  let revealed = 0;
  let actionable = 0;
  while (index < originals.length && originals[index].role === 'customer') {
    const m = originals[index];
    db.prepare('INSERT INTO session_messages (id, session_id, role, body, created_at) VALUES (?, ?, ?, ?, datetime(?, ?))')
      .run(uuid(), sessionId, 'customer', customerBody(m), 'now', `+${index} seconds`);
    if (!m.is_artwork || !/^customer shared artwork\.?$/i.test(String(m.body || '').trim())) actionable += 1;
    index += 1;
    revealed += 1;
  }

  const reference = [];
  while (index < originals.length && originals[index].role === 'agent') {
    reference.push(originals[index].body);
    index += 1;
  }

  db.prepare(`UPDATE real_chat_sessions
    SET next_index = ?, current_reference = ?, current_customer_count = ?, replies_in_block = 0, updated_at = datetime('now')
    WHERE session_id = ?`)
    .run(index, reference.join('\n\n') || null, Math.max(1, actionable), sessionId);

  return { revealed, done: index >= originals.length && revealed === 0, reference: reference.join('\n\n') || null };
}

r.post('/real-chats/:chatId/sessions', (req, res) => {
  const chat = db.prepare('SELECT * FROM real_chats WHERE id = ?').get(req.params.chatId);
  if (!chat) return res.status(404).json({ error: 'Real chat not found' });

  const id = uuid();
  db.prepare('INSERT INTO practice_sessions (id, intern_id, persona_id) VALUES (?, ?, NULL)').run(id, req.user.id);
  db.prepare('INSERT INTO real_chat_sessions (session_id, real_chat_id, next_index) VALUES (?, ?, 0)').run(id, chat.id);
  revealNextRealCustomerBlock(id, chat.id, 0);
  markAssignmentDone(req.user.id, chat.id);   // if this was an assigned chat, mark it done

  res.json({ session_id: id, mode: 'real_chat', real_chat: chat, messages: visibleMessages(id) });
});

r.post('/talk-sessions', async (req, res) => {
  const flow = await pickTalkBlueprint();
  // If a persona was explicitly chosen (admin "Chat with AI"), that persona
  // drives the voice. Otherwise the flow decides the customer and the style is
  // matched to it (interns get a random, hidden persona).
  const chosen = req.body?.style_id ? await getWritingStyle(req.body.style_id) : null;
  const style = chosen || (flow ? await styleForFlow(flow) : await randomWritingStyle());
  if (!style) return res.status(404).json({ error: 'Writing style document not found' });
  const id = uuid();
  const questions = chosen?.questions?.length
    ? chosen.questions
    : (flow?.customer_messages?.length ? flow.customer_messages : (style.questions || []));
  // Pick ONE design image for this customer and reuse it whenever they share
  // their artwork, so it looks like one real customer, not a new image each time.
  // Use only a real customer-shared DESIGN image (never an agent PayPal QR / mockup).
  if (flow) flow.session_artwork = flow.artwork_urls?.[0] || randomCustomerDesignUrl() || randomArtworkUrl();

  db.prepare('INSERT INTO practice_sessions (id, intern_id, persona_id) VALUES (?, ?, NULL)').run(id, req.user.id);
  db.prepare(`INSERT INTO talk_customer_sessions
    (session_id, style_name, style_description, agent_tip, questions, next_index, flow_blueprint)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, style.name, style.description, style.agent_tip, JSON.stringify(questions), 1, flow ? JSON.stringify(flow) : null);
  const openerQuery = `${flow?.intent || ''} ${flow?.products_discussed || ''}`;
  const openerExamples = await relevantExampleTexts(openerQuery);
  const openerReal = await relevantRealCustomerMsgs(openerQuery, 6);
  const openerText = (await nextCustomerMessage({ style, questions, nextIndex: 0, conversation: [], flow, approvedExamples: openerExamples, realExamples: openerReal })).replace(/\[\[\s*DONE\s*\]\]/gi, '').trim();
  const opener = customerBodyWithDesign(openerText, flow?.session_artwork, false);
  db.prepare('INSERT INTO session_messages (id, session_id, role, body) VALUES (?, ?, ?, ?)').run(uuid(), id, 'customer', opener);
  // Reveal the real persona name only when one was explicitly chosen (admin);
  // interns keep a generic "Customer" so the persona stays hidden.
  const styleOut = chosen
    ? { name: style.name, description: style.description, agent_tip: style.agent_tip }
    : { name: 'Customer', description: 'Live AI customer', agent_tip: 'Reply naturally and handle the customer like a real Decoinks chat.' };
  res.json({ session_id: id, mode: 'talk_customer', style: styleOut, messages: visibleMessages(id) });
});

r.post('/talk-sessions/:id/messages', async (req, res) => {
  const s = ownSession(req, res); if (!s) return;
  if (s.status !== 'active') return res.status(400).json({ error: 'Session has ended' });
  const state = db.prepare('SELECT * FROM talk_customer_sessions WHERE session_id = ?').get(s.id);
  if (!state) return res.status(404).json({ error: 'Talk-to-customer session not found' });
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Empty message' });

  const before = visibleMessages(s.id);
  const lastCustomer = [...before].reverse().find(m => m.role === 'customer');
  const msgId = uuid();
  db.prepare('INSERT INTO session_messages (id, session_id, role, body) VALUES (?, ?, ?, ?)').run(msgId, s.id, 'intern', body);

  const questions = safeParse(state.questions, []);
  const style = {
    name: state.style_name,
    description: state.style_description,
    spotting: '',
    agent_tip: state.agent_tip,
  };
  const conversation = [...before, { role: 'intern', body }];
  const nextIndex = Number(state.next_index || 0);
  const flow = safeParse(state.flow_blueprint, null);

  // The customer keeps chatting in-style until the order is actually closed.
  // A dedicated completion check (only after the order could realistically be
  // done) decides when to end; a hard cap prevents an endless session.
  const stagesLen = flow?.stages?.length || 8;
  const hardCap = stagesLen + 6;
  const canBeDone = nextIndex >= 3;

  const isAdmin = req.user.role === 'admin';
  const [evalResult, customerText, orderComplete] = await Promise.all([
    isAdmin ? Promise.resolve(null) : evaluateReply({
      internId: s.intern_id,
      sessionMessageId: msgId,
      conversation,
      customerText: lastCustomer?.body || '',
      internReply: body,
      modelReply: state.agent_tip || null,
    }).catch(e => { console.error('talk eval error:', e.message); return null; }),
    Promise.all([
      relevantExampleTexts(`${lastCustomer?.body || ''} ${body}`),
      relevantRealCustomerMsgs(`${lastCustomer?.body || ''} ${body}`, 6),
    ])
      .then(([approvedExamples, realExamples]) => nextCustomerMessage({ style, questions, nextIndex, conversation, flow, approvedExamples, realExamples }))
      .catch(e => { console.error('talk customer error:', e.message); return questions[Math.min(nextIndex, questions.length - 1)] || 'How much?'; }),
    canBeDone
      ? isOrderComplete({ conversation }).catch(e => { console.error('talk done check error:', e.message); return false; })
      : Promise.resolve(false),
  ]);

  // Deterministic backstop: if the agent has clearly confirmed BOTH payment and
  // shipping, the order is closed regardless of the LLM yes/no check.
  const agentText = conversation.filter(m => m.role === 'intern').map(m => m.body).join(' ').toLowerCase();
  const paymentConfirmed = /(payment received|payment went through|got your payment|received your payment|you(?:'re| are) paid|order (?:is )?(?:paid|confirmed))/.test(agentText);
  const shippingConfirmed = /(ship(?:s|ping|ped|ping out)?\b|tracking|deliver|arrives|usps|fedex|\bups\b)/.test(agentText);
  const agentClosedOrder = paymentConfirmed && shippingConfirmed;

  let done = /\[\[DONE\]\]/i.test(customerText) || orderComplete || agentClosedOrder;
  if (nextIndex < 3) done = false;               // never end before the order can realistically be handled
  if (nextIndex >= hardCap) done = true;         // safety net so a session can't run forever
  const cleanCustomer = customerText.replace(/\[\[\s*DONE\s*\]\]/gi, '').trim() || 'ok thanks!';

  // Share the customer's ONE design image only once, at a natural moment, and
  // reuse the same image — never a new random picture on every message.
  const alreadyShared = db.prepare("SELECT COUNT(*) c FROM session_messages WHERE session_id = ? AND body LIKE '%[[artwork:%'").get(s.id).c > 0;
  const isDesignStage = nextIndex === 2 || nextIndex === 3;
  const sessionArtwork = flow?.session_artwork || '';
  const customerBubble = customerBodyWithDesign(cleanCustomer, sessionArtwork, alreadyShared, isDesignStage);
  db.prepare('INSERT INTO session_messages (id, session_id, role, body) VALUES (?, ?, ?, ?)').run(uuid(), s.id, 'customer', customerBubble);
  db.prepare(`UPDATE talk_customer_sessions SET next_index = ?, updated_at = datetime('now') WHERE session_id = ?`)
    .run(nextIndex + 1, s.id);

  if (done) {
    const scorecard = finishSession(s.id, s.intern_id);
    return res.json({ messages: visibleMessages(s.id), evaluation_recorded: !!evalResult, complete: true, scorecard });
  }

  res.json({ messages: visibleMessages(s.id), evaluation_recorded: !!evalResult });
});

// ---- Supervised live sessions (agent side; admin gates each customer message) ----
r.get('/supervised', (req, res) => {
  const rows = db.prepare(`
    SELECT ps.id, ps.status, rc.customer_name, rc.intent,
      (SELECT COUNT(*) FROM session_messages m WHERE m.session_id = ps.id AND m.role = 'customer') AS customer_shown
    FROM real_chat_sessions rcs JOIN practice_sessions ps ON ps.id = rcs.session_id JOIN real_chats rc ON rc.id = rcs.real_chat_id
    WHERE rcs.supervised = 1 AND ps.intern_id = ? AND ps.status = 'active' ORDER BY ps.started_at DESC`).all(req.user.id);
  res.json(rows);
});

r.get('/supervised/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM practice_sessions WHERE id = ? AND intern_id = ?').get(req.params.id, req.user.id);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  autoReleaseIfDue(req.params.id);
  const st = getSupervised(req.params.id);
  const rc = db.prepare('SELECT rc.customer_name, rc.intent FROM real_chat_sessions rcs JOIN real_chats rc ON rc.id = rcs.real_chat_id WHERE rcs.session_id = ?').get(req.params.id);
  res.json({ session_id: req.params.id, mode: 'supervised', real_chat: rc, status: s.status,
    messages: supervisedVisible(req.params.id), customer_pending: !!(st?.pending_body || st?.pending_attachment) });
});

r.post('/supervised/:id/messages', async (req, res) => {
  const s = db.prepare('SELECT * FROM practice_sessions WHERE id = ? AND intern_id = ?').get(req.params.id, req.user.id);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  if (s.status !== 'active') return res.status(400).json({ error: 'Session has ended' });
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Empty message' });

  const before = supervisedVisible(req.params.id);
  const lastCustomer = [...before].reverse().find(m => m.role === 'customer');
  const msgId = uuid();
  db.prepare('INSERT INTO session_messages (id, session_id, role, body) VALUES (?, ?, ?, ?)').run(msgId, req.params.id, 'intern', body);
  await evaluateReply({
    internId: s.intern_id, sessionMessageId: msgId, conversation: [...before, { role: 'intern', body }],
    customerText: lastCustomer?.body || '', internReply: body, modelReply: null,
  }).catch(e => { console.error('supervised eval error:', e.message); });

  const state = afterAgentReply(req.params.id);
  if (state === 'done') {
    const scorecard = finishSession(req.params.id, s.intern_id);
    return res.json({ messages: supervisedVisible(req.params.id), complete: true, scorecard });
  }
  res.json({ messages: supervisedVisible(req.params.id), complete: false, customer_pending: true });
});

// ---- Live manual chat (trainee side; a trainer messages you live, fully manual) ----
r.get('/live-manual', (req, res) => {
  const rows = db.prepare(`
    SELECT lms.session_id AS id, lms.name, lms.status, u.name AS trainer_name,
      (SELECT COUNT(*) FROM session_messages m WHERE m.session_id = lms.session_id) AS message_count
    FROM live_manual_sessions lms JOIN users u ON u.id = lms.admin_id
    WHERE lms.agent_id = ? AND lms.status != 'ended'
    ORDER BY lms.created_at DESC`).all(req.user.id);
  res.json(rows);
});

r.get('/live-manual/:id', (req, res) => {
  const st = getLiveManual(req.params.id);
  if (!st || st.agent_id !== req.user.id) return res.status(404).json({ error: 'Session not found' });
  const trainer = db.prepare('SELECT name FROM users WHERE id = ?').get(st.admin_id);
  res.json(liveManualPayload(st, { mode: 'live_manual', trainer_name: trainer?.name || 'Trainer' }));
});

r.post('/live-manual/:id/claim', (req, res) => {
  const st = claimLiveManual(req.params.id, req.user.id);
  if (!st) return res.status(404).json({ error: 'Session not found' });
  const trainer = db.prepare('SELECT name FROM users WHERE id = ?').get(st.admin_id);
  res.json(liveManualPayload(st, { mode: 'live_manual', trainer_name: trainer?.name || 'Trainer' }));
});

r.post('/live-manual/:id/messages', (req, res) => {
  const st = getLiveManual(req.params.id);
  if (!st || st.agent_id !== req.user.id) return res.status(404).json({ error: 'Session not found' });
  if (st.status === 'ended') return res.status(400).json({ error: 'Chat has ended' });
  if (st.status === 'invited') claimLiveManual(req.params.id, req.user.id);
  if (!addLiveManualMessage(req.params.id, 'intern', req.body?.body)) return res.status(400).json({ error: 'Empty message' });
  res.json(liveManualPayload(getLiveManual(req.params.id), { mode: 'live_manual' }));
});

r.post('/real-chat-sessions/:id/messages', async (req, res) => {
  const s = ownSession(req, res); if (!s) return;
  if (s.status !== 'active') return res.status(400).json({ error: 'Session has ended' });
  const state = db.prepare('SELECT * FROM real_chat_sessions WHERE session_id = ?').get(s.id);
  if (!state) return res.status(404).json({ error: 'Real chat session not found' });

  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Empty message' });

  const before = visibleMessages(s.id);
  const lastCustomer = [...before].reverse().find(m => m.role === 'customer');
  const msgId = uuid();
  db.prepare('INSERT INTO session_messages (id, session_id, role, body) VALUES (?, ?, ?, ?)').run(msgId, s.id, 'intern', body);

  const conversation = [...before, { role: 'intern', body }];
  const evalResult = await evaluateReply({
    internId: s.intern_id,
    sessionMessageId: msgId,
    conversation,
    customerText: lastCustomer?.body || '',
    internReply: body,
    modelReply: state.current_reference || null,
  }).catch(e => { console.error('real chat eval error:', e.message); return null; });

  const repliesInBlock = Number(state.replies_in_block || 0) + 1;
  db.prepare(`UPDATE real_chat_sessions SET replies_in_block = ?, updated_at = datetime('now') WHERE session_id = ?`)
    .run(repliesInBlock, s.id);

  res.json({
    messages: visibleMessages(s.id),
    evaluation_recorded: !!evalResult,
    waiting_for_more: true,
    manual_next: true,
  });
});

r.post('/real-chat-sessions/:id/continue', (req, res) => {
  const s = ownSession(req, res); if (!s) return;
  if (s.status !== 'active') return res.status(400).json({ error: 'Session has ended' });
  const state = db.prepare('SELECT * FROM real_chat_sessions WHERE session_id = ?').get(s.id);
  if (!state) return res.status(404).json({ error: 'Real chat session not found' });

  const next = revealNextRealCustomerBlock(s.id, state.real_chat_id, state.next_index);
  if (next.done) {
    const scorecard = finishSession(s.id, s.intern_id);
    return res.json({ messages: visibleMessages(s.id), complete: true, scorecard });
  }

  res.json({ messages: visibleMessages(s.id), complete: false });
});

// end session → scorecard
r.post('/sessions/:id/end', (req, res) => {
  const s = ownSession(req, res); if (!s) return;
  res.json(finishSession(s.id, s.intern_id));
});

function finishSession(sessionId, internId) {
  const evals = db.prepare(
    `SELECT e.*, m.body AS intern_body FROM evaluations e JOIN session_messages m ON m.id = e.session_message_id
     WHERE m.session_id = ? ORDER BY e.created_at`
  ).all(sessionId).map(parseEval);
  const overall = evals.length ? +(evals.reduce((a, e) => a + (e.overall || 0), 0) / evals.length).toFixed(1) : null;
  db.prepare(`UPDATE practice_sessions SET status = 'ended', ended_at = datetime('now'), overall_score = ? WHERE id = ?`).run(overall, sessionId);
  const u = db.prepare('SELECT role FROM users WHERE id = ?').get(internId);
  if (u?.role === 'intern') computeReadiness(internId, { snapshot: true });

  const weakest = [...evals].sort((a, b) => (a.overall || 0) - (b.overall || 0)).slice(0, 3);
  return { overall, turn_count: evals.length, evaluations: evals, weakest_turns: weakest };
}

r.get('/real-chat-sessions/:id/export', (req, res) => {
  const s = ownSession(req, res); if (!s) return;
  const real = db.prepare(
    `SELECT rc.* FROM real_chat_sessions rcs JOIN real_chats rc ON rc.id = rcs.real_chat_id WHERE rcs.session_id = ?`
  ).get(s.id);
  if (!real) return res.status(404).json({ error: 'Real chat session not found' });
  const messages = visibleMessages(s.id);
  const evals = db.prepare(
    `SELECT e.*, m.body AS intern_body FROM evaluations e JOIN session_messages m ON m.id = e.session_message_id
     WHERE m.session_id = ? ORDER BY e.created_at`
  ).all(s.id).map(parseEval);
  const lines = [
    `Decoinks Real Chat Practice`,
    `Customer: ${real.customer_name}`,
    `Intent: ${real.intent || ''}`,
    `Summary: ${real.summary || ''}`,
    '',
    'Transcript:',
    ...messages.map(m => `${m.role === 'intern' ? 'Intern' : 'Customer'}: ${m.body}${m.attachment_url ? `\n  Artwork: ${m.attachment_url}` : ''}`),
    '',
    'Scores:',
    ...evals.map((e, i) => `Turn ${i + 1}: ${e.overall} overall | ideal: ${e.ideal_reply || ''}`),
  ];
  res.json({ filename: `${real.customer_name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'real-chat'}-practice.txt`, text: lines.join('\n') });
});

r.get('/sessions', (req, res) => {
  const rows = db.prepare(
    `SELECT ps.*, p.name AS persona_name,
       (SELECT COUNT(*) FROM session_messages m WHERE m.session_id = ps.id AND m.role='intern') AS intern_turns
     FROM practice_sessions ps LEFT JOIN personas p ON p.id = ps.persona_id
     WHERE ps.intern_id = ? ORDER BY ps.started_at DESC LIMIT 50`
  ).all(req.user.id);
  res.json(rows);
});

export function parseEval(e) {
  return {
    ...e,
    rationale: safeParse(e.rationale, {}),
    violations: safeParse(e.violations, []),
    context: safeParse(e.context, {}),
  };
}
function safeParse(s, fallback) { try { return JSON.parse(s) ?? fallback; } catch { return fallback; } }

export default r;
