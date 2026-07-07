// The evaluator — scores every intern reply on the 6-dimension rubric, grounded in
// retrieved KB chunks. Uses LLM structured output when a key is configured; otherwise
// falls back to a transparent heuristic (evaluator_model = 'mock').
import db, { uuid, getWeights } from '../db.js';
import { completeJSON, resolveProvider } from '../llm.js';
import { kbContext } from '../rag.js';
import { localEmbed, cosine } from '../embeddings.js';
import { getSourceOfTruth } from './sourceOfTruth.js';

export const DIMENSIONS = ['accuracy', 'completeness', 'tone', 'policy', 'language', 'sales'];

const EVAL_SCHEMA = {
  type: 'object',
  properties: {
    accuracy: { type: 'number' }, completeness: { type: 'number' }, tone: { type: 'number' },
    policy: { type: 'number' }, language: { type: 'number' }, sales: { type: 'number' },
    rationale: {
      type: 'object',
      properties: Object.fromEntries(DIMENSIONS.map(d => [d, { type: 'string' }])),
      required: DIMENSIONS,
    },
    violations: { type: 'array', items: { type: 'string' } },
    ideal_reply: { type: 'string' },
  },
  required: [...DIMENSIONS, 'rationale', 'violations', 'ideal_reply'],
};

const RUBRIC = `You are the strict but fair evaluator for Decoinks (custom apparel + DTF transfer print shop) sales-intern training.
You are given a SOURCE OF TRUTH (the authoritative Decoinks knowledge & reply standard) plus supporting KB excerpts. The SOURCE OF TRUTH is authoritative and overrides everything else.
Score the INTERN'S REPLY on each dimension 0-100:
1. accuracy — every fact (prices, MOQ, turnaround, policies) must match the SOURCE OF TRUTH. A wrong or invented fact = score 0-20 on this dimension and add a violation that cites the correct fact.
2. completeness — did they gather what's needed (design + size + quantity; address for shipping quotes) and actually answer the question?
3. tone — warm, human, concise (1-3 sentences), not robotic; appropriate light emoji use.
4. policy — no invented prices/dates; no free physical samples (digital mockups only); payment details only after quote approval; honest about what we don't offer. List each violation.
5. language — replied in the customer's language (Spanish customer → Spanish reply).
6. sales — moved the sale forward with a clear next step or closing question.
A great reply follows the Decoinks style: Acknowledge → Answer → Advance, states only facts from the SOURCE OF TRUTH, and reads like one of the 5 reply styles (Direct / Qualifying / Relationship-focused / Value-driven / Close-to-order).
Base every factual judgement ONLY on the SOURCE OF TRUTH (and supporting excerpts) — never on your own assumptions. If it isn't covered there, treat an asserted fact as invented.
Also produce ideal_reply: the best possible agent reply for this turn, grounded in the SOURCE OF TRUTH, in the customer's language, 1-3 sentences, warm with at most one emoji, following Acknowledge → Answer → Advance.`;

function clamp(x) { return Math.max(0, Math.min(100, Number(x) || 0)); }

export function weightedOverall(scores) {
  const w = getWeights();
  return +DIMENSIONS.reduce((sum, d) => sum + clamp(scores[d]) * (w[d] || 0), 0).toFixed(1);
}

// ---------- mock (no-key) heuristic ----------
const SPANISH_RE = /\b(el|la|los|las|de|que|cómo|cuánto|precio|envío|gracias|hola|necesito|quiero|por favor)\b/i;
function looksSpanish(t) { return (t.match(SPANISH_RE) || []).length > 0 && /[áéíóúñ¿¡]/.test(t) || /\b(cuánto|envío|diseño|precio de|hola)\b/i.test(t); }

function mockEvaluate({ customerText, internReply, kb, modelReply }) {
  const simTo = (ref) => Math.round(cosine(localEmbed(internReply), localEmbed(ref)) * 100);
  const kbSim = kb ? simTo(kb) : 40;
  const refSim = modelReply ? simTo(modelReply) : kbSim;
  const len = internReply.trim().length;
  const sentences = internReply.split(/[.!?]+/).filter(s => s.trim()).length;
  const violations = [];
  if (/\bfree sample\b/i.test(internReply)) violations.push('Offered a free physical sample (mockups only).');
  if (/\$\s*\d/.test(internReply) && !/design|size|quantity|artwork|inch|feet|foot/i.test(customerText + ' ' + internReply))
    violations.push('Quoted a price without qualifying (design + size + quantity first).');
  const custSpanish = looksSpanish(customerText);
  const replySpanish = looksSpanish(internReply);
  const scores = {
    accuracy: clamp(30 + kbSim * 0.7 - violations.length * 25),
    completeness: clamp(20 + refSim * 0.6 + (/[?]/.test(internReply) ? 15 : 0)),
    tone: clamp(len < 15 ? 35 : sentences <= 3 ? 80 : 55) + (/😊|👍|🎉|🔥|🚚/u.test(internReply) ? 5 : 0),
    policy: clamp(95 - violations.length * 40),
    language: custSpanish === replySpanish ? 90 : 25,
    sales: clamp(/[?]/.test(internReply) || /send|share|let me know|just/i.test(internReply) ? 75 : 45),
  };
  return {
    ...scores,
    rationale: {
      accuracy: `Heuristic: reply/KB similarity ${kbSim}%. (Mock mode — add an API key for real fact-checking.)`,
      completeness: `Heuristic: similarity to reference reply ${refSim}%.`,
      tone: `${sentences} sentence(s), ${len} chars.`,
      policy: violations.length ? violations.join(' ') : 'No obvious policy issues detected heuristically.',
      language: custSpanish ? (replySpanish ? 'Matched Spanish.' : 'Customer wrote Spanish; reply was not.') : 'English conversation.',
      sales: /[?]/.test(internReply) ? 'Ends with a question / clear next step.' : 'No clear closing question detected.',
    },
    violations,
    ideal_reply: modelReply || 'Ask for the design, size, and quantity so you can quote accurately, in a warm 1-2 sentence reply.',
  };
}

// ---------- main entry ----------
// context: { conversation: [{role, body}], customerText, internReply, modelReply? }
export async function evaluateReply({ internId, sessionMessageId = null, scenarioAttemptId = null, conversation = [], customerText, internReply, modelReply = null }) {
  const kb = await kbContext(`${customerText}\n${internReply}`, { k: 6 });
  const sourceOfTruth = getSourceOfTruth();
  const { provider, model } = resolveProvider();

  let result = null;
  if (provider !== 'mock') {
    const convo = conversation.slice(-12).map(m => `${m.role === 'customer' ? 'CUSTOMER' : 'INTERN'}: ${m.body}`).join('\n');
    try {
      result = await completeJSON({
        system: RUBRIC,
        schemaName: 'evaluation',
        schema: EVAL_SCHEMA,
        messages: [{
          role: 'user',
          content:
`===== SOURCE OF TRUTH (authoritative — grade against THIS) =====
${sourceOfTruth || '(source of truth file missing)'}
===== END SOURCE OF TRUTH =====

SUPPORTING KB EXCERPTS (retrieved for this question; the Source of Truth still overrides these):
${kb || '(no knowledge base ingested yet)'}

${modelReply ? `REFERENCE "BEST REPLY" from real Q&A:\n${modelReply}\n\n` : ''}CONVERSATION SO FAR:
${convo || `CUSTOMER: ${customerText}`}

INTERN'S REPLY TO EVALUATE:
${internReply}

Return the evaluation.`,
        }],
      });
    } catch (err) {
      console.error('Evaluator LLM error, falling back to mock:', err.message);
    }
  }
  const usedModel = result ? `${provider}/${model}` : 'mock';
  if (!result) result = mockEvaluate({ customerText, internReply, kb, modelReply });

  for (const d of DIMENSIONS) result[d] = clamp(result[d]);
  const overall = weightedOverall(result);

  const id = uuid();
  db.prepare(`INSERT INTO evaluations
    (id, session_message_id, scenario_attempt_id, intern_id, accuracy, completeness, tone, policy, language, sales,
     overall, rationale, violations, ideal_reply, evaluator_model, context)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, sessionMessageId, scenarioAttemptId, internId,
      result.accuracy, result.completeness, result.tone, result.policy, result.language, result.sales,
      overall, JSON.stringify(result.rationale || {}), JSON.stringify(result.violations || []),
      result.ideal_reply || '', usedModel,
      JSON.stringify({ customerText, internReply }));

  return { id, ...result, overall, evaluator_model: usedModel };
}
