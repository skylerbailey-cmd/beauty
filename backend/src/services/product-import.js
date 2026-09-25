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

// Pictures.
//
// The model only ever sees the words on a page, so it cannot know what any
// product looks like. This walks the markup instead and builds a catalogue of
// the real images, each with whatever text sits closest to it — the alt
// attribute, the link it is inside, the card it belongs to. The model then
// picks from that list by name. It is never asked for a URL, because a URL it
// composed would look perfectly reasonable and point at nothing.
const MAX_IMAGES = 120;
// How far to look when the page they gave us has nothing on it. Fetching is
// cheap, so several addresses get a glance; reading one costs a model call and
// most of a minute of someone's time, so only the ones that actually carry
// prices are read, and at most two of those.
const MAX_PAGES_TO_CHECK = 6;
const MAX_PAGES_TO_READ = 2;

// The only steps the welcome email knows how to place a product into. Kept
// here as well as in the tool schema because the model's answer is untrusted
// input like any other.
const ROUTINE_STEPS = ['cleanser', 'toner', 'serum', 'eye treatment', 'moisturizer',
  'sunscreen', 'exfoliant', 'mask', 'device treatment', 'treatment cream'];

// A shop page is mostly furniture: logos, payment badges, flags, sprites.
const JUNK = /logo|icon|sprite|badge|payment|visa|mastercard|paypal|amex|flag|avatar|placeholder|spacer|pixel|tracking|loader|spinner|arrow|chevron|star-rating|swatch/i;

function imageCatalogue(html, pageUrl) {
  const cheerio = require('cheerio');
  const $ = cheerio.load(html);
  $('script, style, noscript, header nav, footer').remove();

  const seen = new Set();
  const out = [];

  $('img').each((_, el) => {
    if (out.length >= MAX_IMAGES) return;
    const $el = $(el);

    // Lazy-loaded images keep the real address out of src, so check the
    // attributes that actually carry it before falling back.
    const srcset = $el.attr('srcset') || $el.attr('data-srcset') || '';
    const widest = srcset
      .split(',')
      .map((part) => part.trim().split(/\s+/))
      .filter((p) => p[0])
      .sort((a, b) => (parseInt(b[1], 10) || 0) - (parseInt(a[1], 10) || 0))[0];
    const raw = $el.attr('data-src') || $el.attr('data-original')
      || (widest && widest[0]) || $el.attr('src') || '';
    if (!raw || raw.startsWith('data:')) return;

    let url;
    try { url = new URL(raw, pageUrl).toString(); } catch (_) { return; }
    if (!/^https?:/.test(url)) return;
    if (JUNK.test(url)) return;

    // Explicitly tiny images are furniture whatever they are called.
    const w = parseInt($el.attr('width') || '0', 10);
    const h = parseInt($el.attr('height') || '0', 10);
    if ((w && w < 80) || (h && h < 80)) return;

    // One entry per picture, ignoring the size suffix Shopify and friends add,
    // so the same product photo at six widths is not six candidates.
    const key = url.split('?')[0].replace(/_\d+x\d*(?=\.[a-z]{3,4}$)/i, '');
    if (seen.has(key)) return;
    seen.add(key);

    const alt = ($el.attr('alt') || '').trim();
    if (JUNK.test(alt)) return;

    // The nearest text that names the thing: the link wrapping it, or the card.
    const near = $el.closest('a').text().trim()
      || $el.parent().text().trim()
      || $el.closest('li, article, div').text().trim();

    out.push({
      url,
      alt: alt.slice(0, 120),
      near: near.replace(/\s+/g, ' ').slice(0, 140),
    });
  });

  return out;
}



// Is this page worth spending a model call on?
//
// Following three candidate pages means three fetches and three model calls,
// which is a shop watching a spinner for minutes and a bill for pages that
// were never going to work. A product listing has prices on it — several,
// close together. Counting them costs nothing and skips the About page before
// it costs anything.
function looksLikeProductList(text) {
  const prices = text.match(/(?:[$£€]\s?\d[\d,]*(?:\.\d{2})?)|(?:\d[\d,]*\.\d{2}\s?(?:USD|EUR|GBP))/gi) || [];
  // Three is enough to tell a listing from a page that mentions a price once.
  return prices.length >= 3;
}


// ─── The shop's own product feed ────────────────────────────────────────────
//
// Reading words off a page is the last resort, not the first. Most shops run
// on a platform that will simply hand over its catalogue — name, exact price,
// images, description — as JSON. That is faster than a model call, costs
// nothing, cannot misread a price, and works on the pages that defeat text
// extraction entirely: a listing built by JavaScript has no words for us to
// read, but the feed behind it is right there.
//
// Two platforms cover most of the trade. WooCommerce (WordPress) exposes a
// Store API; Shopify exposes products.json. Both are public read-only
// endpoints that the shop's own storefront uses.

const FEED_PAGE_SIZE = 100;
const FEED_MAX_PAGES = 5;

// Feeds hand back HTML-encoded text, names included: a product really called
// "Barrier Support & Recovery" arrives as "Barrier Support &#038; Recovery"
// and would go on the shelf, and onto a receipt, spelled exactly like that.
const decodeEntities = (str) => String(str || '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&nbsp;/g, ' ')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  // Ampersand last, so "&amp;#038;" cannot become an ampersand twice over.
  .replace(/&amp;/g, '&');

const stripTags = (html) => decodeEntities(String(html || '').replace(/<[^>]*>/g, ' '))
  .replace(/\s+/g, ' ')
  .trim();

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'SkySale-ProductImport/1.0 (+https://sky-sale.com)', Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    if (!/json/i.test(type)) return null;
    return await res.json();
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// WooCommerce prices arrive as integers scaled by currency_minor_unit: "11950"
// with a minor unit of 0 is $11,950, and with 2 it is $119.50. Reading it as a
// plain number gets the price wrong by a factor of a hundred, in whichever
// direction is worse.
function wooPrice(prices) {
  if (!prices) return null;
  const raw = Number(prices.price);
  if (!Number.isFinite(raw)) return null;
  const unit = Number(prices.currency_minor_unit);
  const scaled = Number.isFinite(unit) ? raw / Math.pow(10, unit) : raw;
  return scaled > 0 ? scaled : null;
}

async function readWooFeed(origin) {
  const out = [];
  for (let page = 1; page <= FEED_MAX_PAGES; page++) {
    const rows = await fetchJson(`${origin}/wp-json/wc/store/v1/products?per_page=${FEED_PAGE_SIZE}&page=${page}`);
    if (!Array.isArray(rows) || !rows.length) break;
    for (const r of rows) {
      // A variation is the same product in another size; the parent is the
      // product. Listing both puts the range in twice.
      if (r.type === 'variation') continue;
      out.push({
        name: decodeEntities(r.name).trim(),
        price: wooPrice(r.prices),
        brand: decodeEntities((r.brands && r.brands[0] && r.brands[0].name) || ''),
        category: decodeEntities((r.categories || []).map((c) => c.name).filter((n) => !/^products?$/i.test(n))[0] || ''),
        description: stripTags(r.short_description || r.description).slice(0, 1200),
        usage: '',
        image: (r.images && r.images[0] && r.images[0].src) || '',
        source_url: r.permalink || '',
      });
    }
    if (rows.length < FEED_PAGE_SIZE) break;
  }
  return out;
}

async function readShopifyFeed(origin) {
  const out = [];
  for (let page = 1; page <= FEED_MAX_PAGES; page++) {
    const body = await fetchJson(`${origin}/products.json?limit=250&page=${page}`);
    const rows = body && Array.isArray(body.products) ? body.products : null;
    if (!rows || !rows.length) break;
    for (const r of rows) {
      const variant = (r.variants || [])[0];
      const price = variant ? Number(variant.price) : NaN;
      out.push({
        name: decodeEntities(r.title).trim(),
        price: Number.isFinite(price) && price > 0 ? price : null,
        brand: decodeEntities(r.vendor || ''),
        category: decodeEntities(r.product_type || ''),
        description: stripTags(r.body_html).slice(0, 1200),
        usage: '',
        image: (r.images && r.images[0] && r.images[0].src) || '',
        source_url: `${origin}/products/${r.handle}`,
      });
    }
    if (rows.length < 250) break;
  }
  return out;
}

/** The catalogue straight from the shop's platform, or null if it has none. */
async function readProductFeed(pageUrl) {
  const origin = new URL(pageUrl).origin;
  for (const read of [readWooFeed, readShopifyFeed]) {
    try {
      const rows = (await read(origin)).filter((p) => p.name);
      if (rows.length) return rows;
    } catch (_) { /* try the next platform */ }
  }
  return null;
}

// ─── Where the products actually live ───────────────────────────────────────
//
// People paste the address they know, which is the front door: avologi.com,
// not avologi.com/collections/all. A homepage sells nothing in a form we can
// read — it has a hero image, a story, and a link to the shop — so the honest
// answer used to be "nothing on that page looked like a product", which is
// true and useless.
//
// This reads the front door's own links and works out where it keeps its
// products, the same way a person would: by looking for the one that says
// Shop.

// Paths worth trying on any site, in the order a guess is worth making.
// /collections/all is Shopify's, which is a large share of the trade.
const COMMON_PRODUCT_PATHS = [
  '/collections/all', '/shop', '/products', '/store', '/catalog', '/all-products',
];

// Anchor text that names a product listing, and text that only looks like it.
const SHOP_WORDS = /^(shop|shop all|shop now|all products|products|our products|store|catalog|catalogue|browse|the collection|collections|shop the range)$/i;
const NOT_SHOP = /cart|basket|checkout|account|login|wishlist|compare|blog|news|about|contact|faq|policy|terms|privacy|shipping|returns|careers|press/i;

function productPageCandidates(html, pageUrl) {
  const cheerio = require('cheerio');
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const scored = new Map();

  const consider = (href, score) => {
    if (!href) return;
    let u;
    try { u = new URL(href, base); } catch (_) { return; }
    // Same site only. Following a link off-site would turn "read my shop" into
    // "read whatever my shop links to", and the address guard exists for a
    // reason.
    if (u.hostname.toLowerCase() !== base.hostname.toLowerCase()) return;
    if (!/^https?:$/.test(u.protocol)) return;
    u.hash = '';
    const path = u.pathname.toLowerCase();
    if (NOT_SHOP.test(path)) return;
    if (path === base.pathname.toLowerCase() && u.search === base.search) return;
    const key = u.toString();
    scored.set(key, Math.max(scored.get(key) || 0, score));
  };

  $('a[href]').each((_, el) => {
    const $el = $(el);
    const href = $el.attr('href');
    const label = $el.text().replace(/\s+/g, ' ').trim();
    if (NOT_SHOP.test(label)) return;

    // What it says is the strongest signal: a link a person would click.
    if (SHOP_WORDS.test(label)) consider(href, 100);
    else if (/\b(shop|products|catalog|collection)\b/i.test(label) && label.length < 40) consider(href, 60);

    // Then what the address looks like.
    try {
      const path = new URL(href, base).pathname.toLowerCase();
      if (/^\/collections\/all\/?$/.test(path)) consider(href, 95);
      else if (/^\/(shop|products|store|catalog)\/?$/.test(path)) consider(href, 85);
      else if (/^\/collections\/[^/]+\/?$/.test(path)) consider(href, 55);
      else if (/^\/product-category\//.test(path)) consider(href, 55);
    } catch (_) { /* not a usable href */ }
  });

  // The conventional addresses, whether or not anything links to them —
  // except the one we are standing on, which has already been read.
  const here = base.pathname.replace(/\/+$/, '').toLowerCase();
  for (const [i, path] of COMMON_PRODUCT_PATHS.entries()) {
    if (path.replace(/\/+$/, '').toLowerCase() === here) continue;
    const u = new URL(path, base);
    if (!scored.has(u.toString())) scored.set(u.toString(), 40 - i);
  }

  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([href]) => href);
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
            frequency: {
              type: ['string', 'null'],
              // No enum: a strict tool schema will not take one alongside a
              // nullable type. The answer is checked against the same list
              // below, which is where it has to be checked anyway.
              description: 'How often the customer uses it. Exactly one of: daily, weekly, monthly. null if the page does not say — never guess from the product type.',
            },
            routine_step: {
              type: ['string', 'null'],
              description: 'Where it belongs in a skincare routine. Exactly one of: cleanser, toner, serum, eye treatment, moisturizer, sunscreen, exfoliant, mask, device treatment, treatment cream. null if it is none of these (a supplement, a tool, a gift set).',
            },
            benefits: {
              type: ['string', 'null'],
              description: 'What it does for the customer, as a short comma-separated list drawn from the page. null if the page claims nothing.',
            },
            ingredients: {
              type: ['string', 'null'],
              description: 'Key ingredients named on the page, comma separated. null if none are given.',
            },
            image: {
              type: ['string', 'null'],
              description: 'The picture of this product, copied EXACTLY from the numbered image list supplied with the page. Never write a URL that is not on that list, and never adapt one. null if no listed image shows this product.',
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

5. image must be copied character for character from the numbered image list, or be null. The list is the only source of pictures. A URL you composed, adjusted, or guessed will point at nothing and leave a broken picture on a till, which is worse than no picture at all. Match by what the alt text and surrounding words say, not by position in the list, and leave it null rather than attaching a picture you are unsure of. Two products must not share an image.

6. routine_step is what lets the welcome email put the product in the right place in a morning, evening or weekly routine, so it is worth care. Choose from the list given and nothing else. A face wash is a cleanser whatever the page calls it; a night cream is a moisturizer; a device or wand is a device treatment. If it is genuinely none of them — a supplement, a tool, a gift set — return null rather than forcing it.

7. frequency is only what the page states. "Use daily" is daily, "twice a week" is weekly, "once a month" is monthly. A page that does not say gets null: a customer told to use something daily when the maker says weekly is being given advice we invented.

8. usage is the field that matters most after price. It becomes the guidance a customer receives by email after buying, so capture how the product is actually used — the steps, how often, what it goes with — whenever the page says.

If the page sells nothing, record an empty list. That is a valid answer.`;

/**
 * Read a page and return the products on it.
 *
 * Returns { products, sourceUrl, pageTitle, model }. Never throws for "no
 * products found" — an empty list is an answer the caller shows plainly.
 */
// Read one page, and one page only.
async function readOnePage(rawUrl, opts = {}) {
  const url = assertFetchable(rawUrl);
  const html = opts.html || await fetchPage(url);
  const { title, text } = readableText(html);
  const images = imageCatalogue(html, url.toString());

  // A page that is mostly markup and barely any words is one whose content
  // arrives by JavaScript. We can't run that, and guessing at what it would
  // have said is exactly what this must never do.
  const words = text.replace(/\s/g, '').length;
  const looksScripted = html.length > 40000 && words < html.length * 0.02;

  if (words < 200) {
    const e = new Error('There was almost no readable text on that page — it probably builds itself with JavaScript. Try the catalogue or collection page that lists several products.');
    e.status = 422;
    // Marked so the search below can move on to another page instead of
    // stopping: a homepage that renders itself with JavaScript is exactly the
    // case where the products are one link away.
    e.nothingHere = true;
    e.html = html;
    throw e;
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
      content: `Page address: ${url.toString()}\nPage title: ${title || '(none)'}\n\n--- page text ---\n${text}`
        + (images.length
          ? `\n\n--- images on this page ---\nCopy one of these URLs exactly into a product's image field, or use null. Do not write any other URL.\n`
            + images.map((im, i) => `[${i + 1}] ${im.url}\n     alt: ${im.alt || '(none)'}\n     near: ${im.near || '(none)'}`).join('\n')
          : ''),
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

  // Only URLs that were actually on the page get through. The instruction not
  // to invent one is worth having, but it is not a guarantee, and a made-up
  // address renders as a broken picture on a till. An allow-list is.
  const offered = new Set(images.map((im) => im.url));
  const claimed = new Set();

  const products = raw
    .map((p) => ({
      name: String(p?.name || '').trim().slice(0, 200),
      // Number(null) is 0, and 0 is finite and not negative — so every product
      // the page gave no price for was arriving priced at nothing, which is
      // precisely the invented value the whole extraction is built to refuse.
      // A missing price has to stay missing, so the review screen can flag it.
      price: (() => {
        const raw = p?.price;
        if (raw === null || raw === undefined || raw === '') return null;
        const n = Number(raw);
        return Number.isFinite(n) && n > 0 ? n : null;
      })(),
      brand: p?.brand ? String(p.brand).trim().slice(0, 100) : '',
      category: p?.category ? String(p.category).trim().slice(0, 100) : '',
      description: p?.description ? String(p.description).trim().slice(0, 1200) : '',
      usage: p?.usage ? String(p.usage).trim().slice(0, 2000) : '',
      // Coerced against the same vocabulary the email's routine builder uses,
      // so a value outside it becomes blank rather than a product that is
      // listed but silently never placed in a routine.
      frequency: ['daily', 'weekly', 'monthly'].includes(String(p?.frequency || '').toLowerCase())
        ? String(p.frequency).toLowerCase() : '',
      routine_step: ROUTINE_STEPS.includes(String(p?.routine_step || '').toLowerCase())
        ? String(p.routine_step).toLowerCase() : '',
      benefits: p?.benefits ? String(p.benefits).trim().slice(0, 1000) : '',
      ingredients: p?.ingredients ? String(p.ingredients).trim().slice(0, 1000) : '',
      image: (() => {
        const src = p?.image ? String(p.image).trim() : '';
        // Not offered, or already spoken for — a page whose every card shares
        // one hero shot would otherwise put the same photo on all of them.
        if (!offered.has(src) || claimed.has(src)) return '';
        claimed.add(src);
        return src;
      })(),
    }))
    .filter((p) => p.name);

  return {
    products,
    html,
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



// What a feed does not carry.
//
// A platform feed gives the facts — name, price, picture, description — and
// says nothing about how a customer should use the thing, which is what the
// welcome email is made of. That is a reading job, so it is one model call
// over the descriptions we already have rather than a fetch per product.
async function describeForEmail(products, say) {
  if (!process.env.ANTHROPIC_API_KEY || !products.length) return products;
  say && say({ stage: 'reading', count: products.length });

  const TOOL = {
    name: 'describe_products',
    description: 'For each product, say where it belongs in a routine and how it is used.',
    strict: true,
    input_schema: {
      type: 'object', additionalProperties: false, required: ['products'],
      properties: {
        products: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            required: ['index', 'routine_step', 'frequency', 'usage', 'benefits'],
            properties: {
              index: { type: 'integer', description: 'The number this product was given in the list.' },
              routine_step: { type: ['string', 'null'], description: 'One of: cleanser, toner, serum, eye treatment, moisturizer, sunscreen, exfoliant, mask, device treatment, treatment cream. null if none of them fit.' },
              frequency: { type: ['string', 'null'], description: 'daily, weekly or monthly — only if the description says so. null otherwise.' },
              usage: { type: ['string', 'null'], description: 'How to use it, in the words of the description. null if it does not say.' },
              benefits: { type: ['string', 'null'], description: 'What it does for the customer, short and comma separated, from the description. null if it claims nothing.' },
            },
          },
        },
      },
    },
  };

  const listing = products
    .map((p, i) => `[${i}] ${p.name}${p.category ? ` (${p.category})` : ''}\n${(p.description || '').slice(0, 700)}`)
    .join('\n\n');

  try {
    const response = await client().messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system: `You are given a shop's products, each with its own description, and you say where each belongs in a skincare routine and how it is used.

Only what the description supports. A description that does not say how often to use something gets null for frequency — a customer told to use a product daily when the maker says weekly has been given advice we invented. The same goes for usage and benefits.

routine_step is the exception worth a judgement: a face wash is a cleanser whatever it is called, a night cream is a moisturizer, a wand or handset is a device treatment. If it is genuinely none of the listed steps — a supplement, a tool, a gift set — return null.

Answer for every product, using the number it was given.`,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'describe_products' },
      messages: [{ role: 'user', content: listing }],
    });

    const call = response.content.find((b) => b.type === 'tool_use');
    const rows = call && Array.isArray(call.input?.products) ? call.input.products : [];
    for (const row of rows) {
      const p = products[row.index];
      if (!p) continue;
      const step = String(row.routine_step || '').toLowerCase();
      if (ROUTINE_STEPS.includes(step)) p.routine_step = step;
      const freq = String(row.frequency || '').toLowerCase();
      if (['daily', 'weekly', 'monthly'].includes(freq)) p.frequency = freq;
      if (row.usage) p.usage = String(row.usage).slice(0, 2000);
      if (row.benefits) p.benefits = String(row.benefits).slice(0, 1000);
    }
  } catch (err) {
    // The facts are already right. Losing the routine notes is a smaller loss
    // than losing the catalogue, so this never fails the import.
    console.error('[product-import] Could not describe products:', err.message);
  }
  return products;
}

/**
 * Read a page and return the products on it — and if it has none, find the
 * page on that site that does.
 *
 * Returns { products, sourceUrl, pageTitle, model, searched }. Never throws
 * for "no products found": an empty list is an answer the caller shows.
 */
async function extractProductsFromUrl(rawUrl, onProgress) {
  const first = assertFetchable(rawUrl);
  const searched = [];
  const say = (event) => { try { onProgress && onProgress(event); } catch (_) {} };

  // The shop's own feed first. It is exact where reading a page is a guess,
  // it costs nothing, and it works on the JavaScript-built listings that have
  // no words on them at all — which is most of what fails here.
  say({ stage: 'feed', url: new URL(first).origin });
  const feed = await readProductFeed(first.toString()).catch(() => null);
  if (feed && feed.length) {
    searched.push({ url: `${new URL(first).origin} (product feed)`, found: feed.length });
    say({ stage: 'found', count: feed.length, products: feed, source: 'feed' });
    const enriched = await describeForEmail(feed, say);
    return {
      products: enriched,
      sourceUrl: first.toString(),
      pageTitle: '',
      searched,
      viaFeed: true,
      model: MODEL,
    };
  }

  let result = null;
  let firstHtml = null;
  try {
    result = await readOnePage(first.toString());
    firstHtml = result.html;
    searched.push({ url: result.sourceUrl, found: result.products.length });
    // Products with no price at all is what a homepage gives: it names the
    // range in a banner without selling anything. Worth keeping if the shop
    // page turns up nothing better, but not worth stopping the search for.
    if (result.products.some((p) => p.price != null)) return { ...result, searched };
  } catch (err) {
    if (!err.nothingHere) throw err;
    firstHtml = err.html || null;
    searched.push({ url: first.toString(), found: 0 });
  }

  // Nothing on the page they gave us. Work out where this site keeps its
  // products and try there, best guess first. Capped, because each attempt
  // costs a model call and a shop waiting on a spinner is not helped by the
  // eighth one.
  if (!firstHtml) return result ? { ...result, searched } : { products: [], sourceUrl: first.toString(), pageTitle: '', searched };

  const candidates = productPageCandidates(firstHtml, first.toString()).slice(0, MAX_PAGES_TO_CHECK);
  let read = 0;
  for (const candidate of candidates) {
    if (read >= MAX_PAGES_TO_READ) break;
    try {
      // Fetch first and look for prices. A page with none is an About page or
      // a 404 dressed as one, and sending it to the model would cost a minute
      // of someone's time to be told what a regular expression already knew.
      let candidateHtml;
      try {
        candidateHtml = await fetchPage(assertFetchable(candidate));
      } catch (fetchErr) {
        searched.push({ url: candidate, found: 0, problem: fetchErr.message });
        continue;
      }
      if (!looksLikeProductList(readableText(candidateHtml).text)) {
        searched.push({ url: candidate, found: 0, problem: 'no prices on it' });
        continue;
      }
      read++;
      const attempt = await readOnePage(candidate, { html: candidateHtml });
      searched.push({ url: attempt.sourceUrl, found: attempt.products.length });
      if (attempt.products.some((p) => p.price != null)) {
        return {
          ...attempt,
          searched,
          // Say plainly which page this came from. They typed a different one,
          // and a list of products from an address they did not ask for is
          // confusing until you say where it came from.
          foundElsewhere: true,
        };
      }
    } catch (err) {
      searched.push({ url: candidate, found: 0, problem: err.message });
      if (!err.nothingHere && err.status !== 400 && err.status !== 404) continue;
    }
  }

  // Nothing better anywhere. Whatever the first page did give is still worth
  // handing over — unpriced rows are flagged on the review screen and a shop
  // can type the prices in, which beats starting from an empty list.
  const tried = searched.length;
  if (result?.products?.length) {
    return { ...result, searched, hint: 'None of the pages we could read stated prices, so these need them typed in.' };
  }
  return {
    products: [],
    sourceUrl: first.toString(),
    pageTitle: result?.pageTitle || '',
    searched,
    hint: tried > 1
      ? `We looked at ${tried} pages on that site — including the ones it links to as its shop — and could not read a product list from any of them. Try the page that lists several products directly, or add them by hand.`
      : (result?.hint || 'Nothing on that page looked like a product for sale.'),
  };
}

module.exports = { extractProductsFromUrl, readOnePage, assertFetchable, readableText,
  imageCatalogue, productPageCandidates, readProductFeed, wooPrice };
