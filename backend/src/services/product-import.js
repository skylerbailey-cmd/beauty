'use strict';

// Reading a product range off a supplier's web page.
//
// A shop signing up types the address of their supplier's catalogue, and this
// turns that page into products the register can sell — name, price, and the
// usage notes the welcome email is built from.
//
// Two rules shape everything here:
//
//   Nothing is saved without a human looking at it. The extraction is a
//   suggestion. A price read wrong from a web page becomes a wrong charge at
//   a till, so the signup flow shows every row for approval first.
//
//   The model is never asked to invent. If a page doesn't state a price, the
//   price comes back null and the shop types it. A plausible-looking guess is
//   worse than a blank, because a blank is obviously unfinished.

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-opus-5';
const MAX_PAGE_BYTES = 2 * 1024 * 1024;   // a catalogue page, not a download
const FETCH_TIMEOUT_MS = 20000;

function client() {
  if (!process.env.ANTHROPIC_API_KEY) {
    const err = new Error('Product import is not configured on this server.');
    err.status = 503;
    throw err;
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// Only public web pages. Without this, a signup form is an open door into
// whatever the server can reach — cloud metadata endpoints, private ranges,
// anything on localhost.
function assertFetchable(raw) {
  let url;
  try { url = new URL(String(raw || '').trim()); }
  catch (_) { const e = new Error('That doesn\'t look like a web address.'); e.status = 400; throw e; }

  if (!['http:', 'https:'].includes(url.protocol)) {
    const e = new Error('Only http and https addresses can be read.'); e.status = 400; throw e;
  }
  const host = url.hostname.toLowerCase();
  const blocked =
    host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host) && (
      host.startsWith('127.') || host.startsWith('10.') || host.startsWith('0.') ||
      host.startsWith('169.254.') || host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) ||
    host === '[::1]' || host.startsWith('[fd') || host.startsWith('[fe80');
  if (blocked) {
    const e = new Error('That address isn\'t reachable from here.'); e.status = 400; throw e;
  }
  return url;
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        // Say who we are. A shop's supplier should be able to see this in
        // their logs and recognise it rather than guess at a scraper.
        'User-Agent': 'SkySale-ProductImport/1.0 (+https://sky-sale.com)',
        'Accept': 'text/html,application/xhtml+xml',
        // Without this a site serves whatever locale it guesses from the
        // server's address — a shop in Colorado got a Japanese page and would
        // have got yen prices with it.
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!resp.ok) {
      const e = new Error(`That page returned ${resp.status}. Check the address, or that it's public.`);
      e.status = 400; throw e;
    }
    const type = resp.headers.get('content-type') || '';
    if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) {
      const e = new Error('That address isn\'t a web page.'); e.status = 400; throw e;
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > MAX_PAGE_BYTES) {
      const e = new Error('That page is too large to read.'); e.status = 400; throw e;
    }
    return buf.toString('utf8');
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error('That page took too long to respond.'); e.status = 504; throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Strip the page to the words on it. Scripts, styles and navigation are most
// of a modern page's bytes and none of its meaning, and sending them wastes
// the context the actual product descriptions need.
function readableText(html) {
  const cheerio = require('cheerio');
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, iframe, header nav, footer').remove();
  const title = $('title').first().text().trim();
  const body = $('body').text().replace(/[ \t\r\f\v]+/g, ' ').replace(/\n\s*\n\s*/g, '\n').trim();
  return { title, text: body.slice(0, 120000) };
}

// The shape a product has to be in for the register to sell it and for the
// welcome email to say anything useful about it.
const PRODUCT_TOOL = {
  name: 'record_products',
  description: 'Record every product for sale on the page, exactly as the page describes them.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['products'],
    properties: {
      products: {
        type: 'array',
        description: 'One entry per distinct product. Empty if the page sells nothing.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'price', 'brand', 'category', 'description', 'usage'],
          properties: {
            name: { type: 'string', description: 'The product name as written on the page.' },
            price: {
              type: ['number', 'null'],
              description: 'Retail price in the page\'s own currency, digits only. null if the page does not state one — never estimate.',
            },
            brand: { type: ['string', 'null'], description: 'Manufacturer or brand, or null.' },
            category: {
              type: ['string', 'null'],
              description: 'Short grouping the page itself uses, e.g. "Serums" or "Devices". null if the page gives none.',
            },
            description: {
              type: ['string', 'null'],
              description: 'One or two sentences on what it is, drawn from the page. null if the page says nothing.',
            },
            usage: {
              type: ['string', 'null'],
              description: 'How the customer uses it — steps, frequency, order of application. This becomes the guidance in their welcome email. null if the page does not say.',
            },
          },
        },
      },
    },
  },
};

const SYSTEM = `You read a retailer's or supplier's web page and record the products offered for sale on it.

Rules, in order of importance:

1. Record only what the page says. If the page does not give a price, a brand, a description or usage instructions, return null for that field. Never estimate, infer from similar products, or fill a gap with something plausible. A null is a blank someone will fill in; an invented value is a wrong price at a till or a false instruction in a customer's email.

2. One entry per distinct product. Do not create an entry per size, colour or variant of the same product unless the page prices them separately — in which case the name must make the variant clear.

3. Ignore anything that is not a product for sale: navigation, delivery promises, newsletter sign-ups, related-article links, staff bios, testimonials.

4. Prices are digits only, in whatever currency the page uses. "$1,299.00" is 1299. "From $49" is 49. A price range means the lowest figure.

5. usage is the field that matters most after price. It becomes the guidance a customer receives by email after buying, so capture how the product is actually used — the steps, how often, what it goes with — whenever the page says.

If the page sells nothing, record an empty list. That is a valid answer.`;

/**
 * Read a page and return the products on it.
 *
 * Returns { products, sourceUrl, pageTitle, model }. Never throws for "no
 * products found" — an empty list is an answer the caller shows plainly.
 */
async function extractProductsFromUrl(rawUrl) {
  const url = assertFetchable(rawUrl);
  const html = await fetchPage(url);
  const { title, text } = readableText(html);

  // A page that is mostly markup and barely any words is one whose content
  // arrives by JavaScript. We can't run that, and guessing at what it would
  // have said is exactly what this must never do.
  const words = text.replace(/\s/g, '').length;
  const looksScripted = html.length > 40000 && words < html.length * 0.02;

  if (words < 200) {
    const e = new Error('There was almost no readable text on that page — it probably builds itself with JavaScript. Try the catalogue or collection page that lists several products.');
    e.status = 422; throw e;
  }

  const response = await client().messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system: SYSTEM,
    tools: [PRODUCT_TOOL],
    tool_choice: { type: 'tool', name: 'record_products' },
    messages: [{
      role: 'user',
      content: `Page address: ${url.toString()}\nPage title: ${title || '(none)'}\n\n--- page text ---\n${text}`,
    }],
  });

  if (response.stop_reason === 'refusal') {
    const e = new Error('That page could not be read.'); e.status = 422; throw e;
  }

  const call = response.content.find((b) => b.type === 'tool_use' && b.name === 'record_products');
  if (!call) {
    const e = new Error('Nothing could be read from that page.'); e.status = 422; throw e;
  }

  // Tool input is JSON the model produced; treat every field as untrusted and
  // coerce it into the shape the rest of the app expects.
  const raw = Array.isArray(call.input?.products) ? call.input.products : [];
  const products = raw
    .map((p) => ({
      name: String(p?.name || '').trim().slice(0, 200),
      price: Number.isFinite(Number(p?.price)) && Number(p?.price) >= 0 ? Number(p.price) : null,
      brand: p?.brand ? String(p.brand).trim().slice(0, 100) : '',
      category: p?.category ? String(p.category).trim().slice(0, 100) : '',
      description: p?.description ? String(p.description).trim().slice(0, 1200) : '',
      usage: p?.usage ? String(p.usage).trim().slice(0, 2000) : '',
    }))
    .filter((p) => p.name);

  return {
    products,
    sourceUrl: url.toString(),
    pageTitle: title || '',
    model: MODEL,
    usage: response.usage || null,
    // Nothing found on a page that is nearly all markup is a different problem
    // from nothing found on a page that simply sells nothing, and the shop can
    // act on the difference.
    hint: products.length === 0 && looksScripted
      ? 'That page builds its content with JavaScript, so there was nothing for us to read. Try the catalogue page that lists several products, or add this one by hand.'
      : null,
  };
}

module.exports = { extractProductsFromUrl, assertFetchable, readableText };
