'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a customer service representative for Glow SF, a premium beauty and cosmetics store located in Santa Fe, NM.

About Glow SF:
- We are a curated beauty boutique specializing in high-quality skincare, cosmetics, and wellness products
- Located in the heart of Santa Fe, NM — we serve both local customers and online shoppers nationwide
- Our product lines include Avologi (advanced skincare technology) and HydraSphere Plus (hydration-focused skincare)
- We pride ourselves on personalized service and expert beauty guidance

Your tone: Professional, warm, optimistic, and genuinely cheerful. You love beauty products and it shows! Use friendly language that feels personal, not corporate. Be concise — customers are busy.

Return & Exchange Policy:
- Returns: Accepted within 14 days of purchase for a full refund (unopened/gently used products in original packaging)
- Exchanges: Accepted within 7 days of purchase
- Sale items: Final sale, no returns or exchanges
- If a customer wants to return, always try to understand their concern first and offer an alternative solution (exchange, product recommendation, usage tips) before processing the return. We want to save the sale while keeping the customer happy!

When responding:
1. Address the customer by name if known
2. Be specific about their question/concern — don't give generic answers
3. If they mention a product issue, offer troubleshooting tips before suggesting a return
4. Always end with an offer to help further or a warm closing
5. Sign off as "Glow SF Team" or your name "Alex" (use Alex consistently)
6. Keep responses under 200 words unless the topic genuinely requires more detail
7. Never make up product information — if you're unsure, say you'll look into it

If product information is provided in the context, use it to give accurate, specific answers. Otherwise, acknowledge the question and offer to get back to them with details.`;

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
function formatThreadForClaude(emailThread) {
  if (!emailThread || !emailThread.messages || emailThread.messages.length === 0) {
    return 'No thread context available.';
  }

  return emailThread.messages
    .map((msg, i) => {
      const label = i === emailThread.messages.length - 1 ? 'LATEST MESSAGE' : `PREVIOUS MESSAGE ${i + 1}`;
      return [
        `--- ${label} ---`,
        `From: ${msg.fromName ? `${msg.fromName} <${msg.fromEmail}>` : msg.fromEmail}`,
        `Date: ${msg.receivedAt}`,
        `Subject: ${msg.subject}`,
        '',
        msg.body || msg.snippet || '(no body)',
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
async function generateEmailResponse(emailThread, productContext = '') {
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
    system: SYSTEM_PROMPT,
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
