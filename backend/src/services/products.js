'use strict';

const fetch = require('node-fetch');
const cheerio = require('cheerio');

// In-memory cache: { timestamp, products: [...] }
const cache = {
  avologi: null,
  hydrasphere: null,
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function isCacheValid(entry) {
  return entry && entry.timestamp && Date.now() - entry.timestamp < CACHE_TTL_MS;
}

/**
 * Fetch HTML from a URL with a browser-like User-Agent and a timeout.
 */
async function fetchPage(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; GlowSF/1.0; +https://glowsf.com)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeout: 15000,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }

  return response.text();
}

/**
 * Parse product cards from a Cheerio document.
 * Returns an array of { name, description, url, price }.
 */
function parseProductCards($, baseUrl) {
  const products = [];

  // Try common e-commerce selectors
  const selectors = [
    '.product',
    '.product-card',
    '.product-item',
    'article[class*="product"]',
    '[class*="product-grid"] li',
    '.woocommerce-loop-product',
    '.type-product',
  ];

  for (const selector of selectors) {
    const elements = $(selector);
    if (elements.length > 0) {
      elements.each((_, el) => {
        const $el = $(el);
        const name =
          $el.find('h1,h2,h3,h4,.product-title,.woocommerce-loop-product__title,.entry-title').first().text().trim() ||
          $el.find('[class*="title"]').first().text().trim();

        if (!name) return;

        const description =
          $el.find('.product-description,.short-description,p').first().text().trim().substring(0, 300);

        const priceEl = $el.find('.price,.amount,.woocommerce-Price-amount').first();
        const price = priceEl.text().trim();

        const linkHref = $el.find('a').attr('href') || '';
        const url = linkHref.startsWith('http')
          ? linkHref
          : linkHref ? `${baseUrl}${linkHref}` : '';

        products.push({ name, description, price, url });
      });
      break; // Stop at first working selector
    }
  }

  // Fallback: extract any H2/H3 + surrounding paragraph on the page
  if (products.length === 0) {
    $('h2, h3').each((_, el) => {
      const $el = $(el);
      const name = $el.text().trim();
      if (!name || name.split(' ').length > 10) return; // Skip long headings
      const description = $el.next('p').text().trim().substring(0, 300);
      products.push({ name, description, price: '', url: '' });
    });
  }

  return products;
}

/**
 * Fetch and cache product info from avologi.com/all-products/
 */
async function getAvologiProducts() {
  if (isCacheValid(cache.avologi)) {
    return cache.avologi.products;
  }

  const url = 'https://avologi.com/all-products/';
  console.log('[products] Fetching Avologi products from', url);

  try {
    const html = await fetchPage(url);
    const $ = cheerio.load(html);
    const products = parseProductCards($, 'https://avologi.com');

    cache.avologi = { timestamp: Date.now(), products };
    console.log(`[products] Cached ${products.length} Avologi product(s)`);
    return products;
  } catch (err) {
    console.error('[products] Failed to fetch Avologi products:', err.message);
    // Return stale cache if available
    if (cache.avologi?.products) {
      console.warn('[products] Returning stale Avologi cache');
      return cache.avologi.products;
    }
    return [];
  }
}

/**
 * Fetch and cache product info from hydrasphereplus.com
 */
async function getHydraSphereProducts() {
  if (isCacheValid(cache.hydrasphere)) {
    return cache.hydrasphere.products;
  }

  const url = 'https://hydrasphereplus.com';
  console.log('[products] Fetching HydraSphere products from', url);

  try {
    const html = await fetchPage(url);
    const $ = cheerio.load(html);
    const products = parseProductCards($, 'https://hydrasphereplus.com');

    cache.hydrasphere = { timestamp: Date.now(), products };
    console.log(`[products] Cached ${products.length} HydraSphere product(s)`);
    return products;
  } catch (err) {
    console.error('[products] Failed to fetch HydraSphere products:', err.message);
    if (cache.hydrasphere?.products) {
      console.warn('[products] Returning stale HydraSphere cache');
      return cache.hydrasphere.products;
    }
    return [];
  }
}

/**
 * Search across all cached products for entries relevant to the query.
 * Returns a formatted string suitable for passing to Claude as context.
 *
 * @param {string} query - The customer email body or keywords to search
 * @returns {string}
 */
async function searchProductInfo(query) {
  if (!query || typeof query !== 'string') return '';

  // Fetch both product lists in parallel
  const [avologiProducts, hydroProducts] = await Promise.all([
    getAvologiProducts(),
    getHydraSphereProducts(),
  ]);

  const allProducts = [
    ...avologiProducts.map(p => ({ ...p, brand: 'Avologi' })),
    ...hydroProducts.map(p => ({ ...p, brand: 'HydraSphere Plus' })),
  ];

  if (allProducts.length === 0) return '';

  // Simple keyword relevance: tokenize query, score each product
  const queryTokens = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2);

  const scored = allProducts
    .map(product => {
      const haystack = `${product.name} ${product.description}`.toLowerCase();
      const score = queryTokens.reduce((acc, token) => {
        return acc + (haystack.includes(token) ? 1 : 0);
      }, 0);
      return { ...product, score };
    })
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5); // Top 5 most relevant

  if (scored.length === 0) {
    // Return a brief summary of available brands instead
    return `Available brands: Avologi (${avologiProducts.length} products), HydraSphere Plus (${hydroProducts.length} products). No specific product match found for this query.`;
  }

  const lines = scored.map(p => {
    const parts = [`[${p.brand}] ${p.name}`];
    if (p.price) parts.push(`Price: ${p.price}`);
    if (p.description) parts.push(`Description: ${p.description}`);
    if (p.url) parts.push(`URL: ${p.url}`);
    return parts.join(' | ');
  });

  return `Relevant products from Glow SF inventory:\n${lines.join('\n')}`;
}

/**
 * Manually invalidate the product cache (useful for testing or forced refresh).
 */
function clearProductCache() {
  cache.avologi = null;
  cache.hydrasphere = null;
  console.log('[products] Cache cleared');
}

module.exports = {
  getAvologiProducts,
  getHydraSphereProducts,
  searchProductInfo,
  clearProductCache,
};
