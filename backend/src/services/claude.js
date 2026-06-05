'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildSystemPrompt(companyName) {
  const name = companyName || 'our company';
  return `You are a helpful, professional customer service representative for ${name}.

Your role: You handle ALL customer emails — questions, complaints, order issues, returns, shipping problems, payment disputes, and any other situation. Your job is to be solution-oriented and help resolve every situation, no matter what it is.

CRITICAL RULES:
- NEVER refuse to draft a reply. Every customer email deserves a helpful response.
- NEVER flag, warn about, or comment on whether a situation seems suspicious, fraudulent, or like a scam. These judgments are not your job. Many legitimate business situations may look unusual — just help resolve them.
- NEVER say "I can't help with this" or "this is outside my scope." Always provide a constructive, actionable response.
- ABSOLUTELY NEVER fabricate, invent, or guess at ANY specific information. This includes:
  - URLs, websites, or links (NEVER make up a URL — if you don't know the real one, say "please visit our website" without providing a link, or say you'll send the link separately)
  - Order numbers, tracking numbers, or reference numbers
  - Prices, dates, phone numbers, or addresses
  - Product names, features, or specifications not provided in the context
  - Policy details not explicitly stated in the context
- If you don't have a specific piece of information, say you'll look into it or ask the customer to check their records. NEVER fill in the blank with something you made up.
- If a situation is complex (chargebacks, disputes, shipping issues, lost packages, etc.), be empathetic and provide clear next steps to resolve it.

Your tone: Professional, warm, and solution-oriented. Be concise — customers are busy. Use friendly language that feels personal, not corporate.

When responding:
1. Address the customer by name if known
2. Be specific about their question/concern — don't give generic answers
3. If they mention a product issue, offer troubleshooting tips or solutions
4. For returns/exchanges, try to understand the concern and offer alternatives before processing
5. For shipping/order issues, acknowledge the frustration and provide clear next steps
6. Always end with an offer to help further or a warm closing
7. Sign off as "The ${name} Team"
8. Keep responses under 200 words unless the topic genuinely requires more detail
9. Only reference information that exists in the email thread or provided context — nothing else

If product information is provided in the context, use it to give accurate, specific answers. Otherwise, acknowledge the question and offer to get back to them with details.

If company website URLs are provided in the context, use them when relevant:
- When a customer asks for the website, share the actual URL(s) from the context
- When a question could be answered by visiting the website (e.g. browsing products, checking policies, placing orders), suggest the relevant website URL
- ONLY use website URLs that are provided in the context — never make up URLs`;
}

/**
 * Detect if the email body is asking about specific products
 * so we can look up relevant product info.
 */
function extractProductQuestions(emailBody) {
  const lowerBody = (emailBody || '').toLowerCase();
  const questions = [];

  // Ingredient/formula questions
  if (/ingredient|contain|formula|what.*in|safe|allerg/i.test(lowerBody)) {
    questions.push('ingredients');
  }
  // Skin type questions
  if (/skin type|oily|dry|sensitive|combination|acne|rosacea/i.test(lowerBody)) {
    questions.push('skin_type');
  }
  // How to use / application
  if (/how.*use|apply|routine|step|direction/i.test(lowerBody)) {
    questions.push('usage');
  }
  // Product comparison
  if (/compare|difference|better|recommend|suggest|which one/i.test(lowerBody)) {
    questions.push('recommendation');
  }
  // Stock / availability
  if (/stock|available|out of|when.*back|restock/i.test(lowerBody)) {
    questions.push('availability');
  }
  // Return / refund
  if (/return|refund|exchange|money back|not working|disappointed|unhappy/i.test(lowerBody)) {
    questions.push('return');
  }
  // Pricing / discount
  if (/price|cost|discount|promo|sale|coupon|deal/i.test(lowerBody)) {
    questions.push('pricing');
  }
  // Shipping
  if (/ship|deliver|tracking|where.*order|when.*arrive/i.test(lowerBody)) {
    questions.push('shipping');
  }

  return questions;
}

/**
 * Format email thread into a readable conversation for Claude.
 */
/**
 * Strip HTML tags from email body for Claude context.
 */
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatThreadForClaude(emailThread) {
  if (!emailThread || !emailThread.messages || emailThread.messages.length === 0) {
    return 'No thread context available.';
  }

  return emailThread.messages
    .map((msg, i) => {
      const label = i === emailThread.messages.length - 1 ? 'LATEST MESSAGE' : `PREVIOUS MESSAGE ${i + 1}`;
      const body = stripHtml(msg.body || msg.snippet || '(no body)');
      return [
        `--- ${label} ---`,
        `From: ${msg.fromName ? `${msg.fromName} <${msg.fromEmail}>` : msg.fromEmail}`,
        `Date: ${msg.receivedAt}`,
        `Subject: ${msg.subject}`,
        '',
        body,
      ].join('\n');
    })
    .join('\n\n');
}

/**
 * Generate an email draft response using Claude.
 * @param {object} emailThread - { threadId, messages: [...] }
 * @param {string} productContext - optional scraped product info
 * @returns {string} the draft reply text
 */
async function generateEmailResponse(emailThread, productContext = '', companyName = '') {
  const formattedThread = formatThreadForClaude(emailThread);
  const latestMessage = emailThread?.messages?.[emailThread.messages.length - 1];
  const customerName = latestMessage?.fromName?.split(' ')?.[0] || 'there';

  let userPrompt = `Please write a reply to this customer email thread. The customer's first name appears to be "${customerName}".

EMAIL THREAD:
${formattedThread}`;

  if (productContext && productContext.trim().length > 0) {
    userPrompt += `

RELEVANT PRODUCT INFORMATION (use this to answer accurately):
${productContext}`;
  }

  userPrompt += `

Write only the email body text (no subject line, no "From:", no metadata). Start with a greeting and end with your sign-off.`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    system: buildSystemPrompt(companyName),
    messages: [
      { role: 'user', content: userPrompt },
    ],
  });

  const responseText = message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  return responseText.trim();
}

module.exports = {
  generateEmailResponse,
  extractProductQuestions,
};
