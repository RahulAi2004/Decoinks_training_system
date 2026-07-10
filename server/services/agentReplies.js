// Generates a Decoinks AGENT reply grounded in the knowledge base, for the admin
// "Chat with AI" portal (admin plays customer, AI plays agent). Admin corrections
// are injected as hard rules so the agent follows the admin's guidance and does
// not repeat flagged mistakes.
import { completeText, resolveProvider } from '../llm.js';
import { kbContext } from '../rag.js';
import { relevantAgentExamples } from './agentExamples.js';
import { getPrompt } from './prompts.js';

export async function agentReply({ conversation = [], customerText }) {
  const examples = await relevantAgentExamples(customerText || conversation.at(-1)?.body || '', 12);
  const corrections = examples.filter(e => e.is_correction);
  const goodExamples = examples.filter(e => !e.is_correction);

  const { provider } = resolveProvider();
  if (provider === 'mock') {
    return corrections[0]?.reply || goodExamples[0]?.reply || 'Thanks for reaching out! Could you share your design, size, and quantity so I can quote you?';
  }

  const kb = await kbContext(customerText || conversation.at(-1)?.body || '', { k: 6 });
  const convo = conversation.slice(-10).map(m => `${m.role === 'customer' ? 'CUSTOMER' : 'AGENT'}: ${m.body}`).join('\n');

  const correctionBlock = corrections.length
    ? `CORRECTIONS FROM ADMIN — these are HARD RULES. Always follow them; never repeat the old mistake:\n${corrections.map((c, i) => `${i + 1}. When the customer says something like "${c.customer_text || '(any)'}", reply in the spirit of: "${c.reply}"`).join('\n')}\n\n`
    : '';
  const goodBlock = goodExamples.length
    ? `ADMIN-APPROVED GOOD AGENT REPLIES (imitate this quality and tone):\n${goodExamples.map((g, i) => `${i + 1}. ${g.reply}`).join('\n')}\n\n`
    : '';

  try {
    const text = await completeText({
      system: getPrompt('agent_system'),
      messages: [{
        role: 'user',
        content:
`${correctionBlock}${goodBlock}SOURCE OF TRUTH (knowledge base):
${kb || '(No KB excerpts retrieved.)'}

CONVERSATION SO FAR:
${convo || '(Start of chat.)'}

CUSTOMER JUST SAID: "${customerText || conversation.at(-1)?.body || ''}"

Write the Decoinks agent's next reply.`,
      }],
      maxTokens: 200,
    });
    return text.trim() || 'Could you share your design, size, and quantity so I can quote you accurately?';
  } catch (e) {
    console.error('agent reply error:', e.message);
    return corrections[0]?.reply || 'Could you share your design, size, and quantity so I can quote you accurately?';
  }
}
