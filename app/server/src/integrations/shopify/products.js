import { getShopifyClient } from './client.js';
import { prisma } from '../../lib/db.js';

export async function fetchProducts(shopDomain, limit = 50) {
  const client = await getShopifyClient(shopDomain);
  const response = await client.get({
    path: 'products',
    query: {
      limit,
    },
  });
  return response.body.products;
}

export async function fetchProductDetails(shopDomain, productId) {
  const client = await getShopifyClient(shopDomain);
  const response = await client.get({
    path: `products/${productId}`,
  });
  return response.body.product;
}

/**
 * Clean HTML tags from Shopify product descriptions
 */
function stripHtml(html = '') {
  if (!html) return '';
  return String(html)
    .replace(/<[^>]*>?/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Searches the Shopify catalog for products matching a natural customer query.
 * Safe for AI consumption: returns ONLY customer-facing fields and never exposes
 * internal tokens, secrets, or administrative data.
 *
 * @param {string} shopDomain - The domain of the merchant store
 * @param {string} query - The customer search string (e.g. "chair protection cover")
 * @returns {Promise<{ success: boolean, query: string, totalFound: number, products: Array<Object>, message?: string }>}
 */
export async function searchShopifyProducts(shopDomain, query = '') {
  const rawQuery = String(query || '').trim();
  if (!rawQuery) {
    return {
      success: true,
      query: '',
      totalFound: 0,
      products: [],
      message: 'Empty product query provided.'
    };
  }

  // Tokenize query into searchable keywords, excluding common Urdu/English conversational stop words
  const stopWords = new Set([
    'hai', 'hain', 'ka', 'ki', 'ke', 'ko', 'se', 'mein', 'me', 'aur', 'ya',
    'bhi', 'available', 'chahiye', 'mil', 'sakta', 'sakti', 'hoga', 'hogi',
    'the', 'a', 'an', 'and', 'or', 'for', 'is', 'are', 'in', 'of', 'to', 'with'
  ]);

  const tokens = rawQuery
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !stopWords.has(t));

  const searchTokens = tokens.length > 0 ? tokens : [rawQuery.toLowerCase()];

  let rawProducts = [];

  // 1. Try Shopify REST API
  try {
    rawProducts = await fetchProducts(shopDomain, 50);
  } catch (err) {
    console.warn(`⚠️ [Shopify:searchShopifyProducts] API search failed for ${shopDomain}: ${err.message}. Falling back to DB cache.`);
    // 2. Fallback to Prisma database Product catalog
    try {
      const dbProducts = await prisma.product.findMany({
        where: { shop: { domain: shopDomain } },
        take: 50
      });
      rawProducts = dbProducts.map(p => {
        let parsedVariants = [];
        try {
          parsedVariants = typeof p.variants === 'string'
            ? JSON.parse(p.variants)
            : (Array.isArray(p.variants) ? p.variants : []);
        } catch (_) {}
        const title = p.name || p.title || '';
        const desc = p.description || p.body_html || p.bodyHtml || '';
        return {
          id: p.id,
          title,
          body_html: desc,
          product_type: p.category || p.product_type,
          handle: p.handle || (title ? title.toLowerCase().replace(/[^a-z0-9]+/g, '-') : undefined),
          status: 'active',
          variants: parsedVariants.length > 0 ? parsedVariants : [{
            title: 'Default',
            price: String(p.price || '0'),
            inventory_quantity: p.stock ?? p.inventoryQuantity ?? 10
          }]
        };
      });
    } catch (dbErr) {
      console.warn(`⚠️ [Shopify:searchShopifyProducts] DB fallback also failed: ${dbErr.message}`);
    }
  }

  if (!Array.isArray(rawProducts) || rawProducts.length === 0) {
    return {
      success: true,
      query: rawQuery,
      totalFound: 0,
      count: 0,
      products: [],
      message: `No products found in store catalog for "${rawQuery}".`
    };
  }

  // 3. Relevance Scoring
  const queryLower = rawQuery.toLowerCase();
  const scored = [];

  for (const p of rawProducts) {
    const titleLower = String(p.title || '').toLowerCase();
    const bodyLower = String(p.body_html || '').toLowerCase();
    const tagsLower = String(p.tags || '').toLowerCase();
    const typeLower = String(p.product_type || '').toLowerCase();

    let score = 0;

    // Exact title match
    if (titleLower === queryLower) {
      score += 100;
    } else if (titleLower.includes(queryLower)) {
      score += 60;
    }

    // Keyword matching
    let tokenMatches = 0;
    for (const token of searchTokens) {
      if (titleLower.includes(token)) {
        score += 25;
        tokenMatches++;
      } else if (tagsLower.includes(token) || typeLower.includes(token)) {
        score += 15;
        tokenMatches++;
      } else if (bodyLower.includes(token)) {
        score += 5;
      }
    }

    // Must match at least one relevant token to be considered
    if (score > 0 && (tokenMatches > 0 || titleLower.includes(queryLower))) {
      scored.push({ product: p, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  // 4. Customer-facing safe projection
  const safeResults = scored.slice(0, 3).map(({ product: p }) => {
    const variants = Array.isArray(p.variants) ? p.variants : [];
    const firstVariant = variants[0] || {};

    const cleanPrice = firstVariant.price
      ? (String(firstVariant.price).startsWith('Rs') ? String(firstVariant.price) : `Rs. ${firstVariant.price}`)
      : 'Price on request';

    const inStock = variants.some(v => (v.inventory_quantity === undefined || v.inventory_quantity > 0));

    const cleanDesc = stripHtml(p.body_html || p.description || '');
    const truncatedDesc = cleanDesc.length > 160 ? `${cleanDesc.substring(0, 157)}...` : cleanDesc;

    return {
      title: p.title,
      price: cleanPrice,
      available: inStock,
      description: truncatedDesc || undefined,
      handle: p.handle || undefined,
      variantsCount: variants.length > 1 ? variants.length : undefined,
      url: p.handle ? `https://${shopDomain}/products/${p.handle}` : undefined
    };
  });

  return {
    success: true,
    query: rawQuery,
    totalFound: safeResults.length,
    count: safeResults.length,
    products: safeResults,
    message: safeResults.length === 0
      ? `No matching products found in the catalog for "${rawQuery}".`
      : undefined
  };
}
