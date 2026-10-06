import { getShopifyClient } from '../integrations/shopify/client.js';
import { prisma } from '../lib/db.js';

// In-memory catalog cache with 10-minute TTL per shop
const catalogCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

function stripHtml(html = '') {
  if (!html) return '';
  return String(html)
    .replace(/<[^>]*>?/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Authoritative Shopify Catalog Service for Dial Mate 2.0
 */
export class ShopifyCatalogService {
  /**
   * Resolves the customer-facing storefront domain (e.g. sundaybazaaar.store)
   * 
   * @param {string} shopDomain 
   * @returns {Promise<string>}
   */
  static async getStorefrontDomain(shopDomain) {
    if (!shopDomain) return 'sundaybazaaar.store';

    try {
      const client = await getShopifyClient(shopDomain);
      const res = await client.get({ path: 'shop' });
      const domain = res.body?.shop?.domain || res.body?.shop?.myshopify_domain;
      if (domain) return domain;
    } catch (_) {}

    return shopDomain;
  }

  /**
   * Clears in-memory catalog cache
   */
  static clearCache(shopDomain = null) {
    if (shopDomain) {
      catalogCache.delete(shopDomain);
    } else {
      catalogCache.clear();
    }
  }

  /**
   * Loads and caches all products for the shop (up to 250 products)
   * 
   * @param {string} shopDomain 
   * @param {{ skipCache?: boolean }} options
   * @returns {Promise<Array<object>>}
   */
  static async loadCatalog(shopDomain, options = {}) {
    if (process.env.NODE_ENV !== 'test' && !options.skipCache) {
      const cached = catalogCache.get(shopDomain);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.products;
      }
    }

    let rawProducts = [];
    let storefrontDomain = shopDomain;

    try {
      const client = await getShopifyClient(shopDomain);
      storefrontDomain = await this.getStorefrontDomain(shopDomain);

      const response = await client.get({
        path: 'products',
        query: { limit: 250 }
      });
      rawProducts = response.body?.products || [];
    } catch (err) {
      console.warn(`⚠️ [ShopifyCatalogService] REST load failed for ${shopDomain}: ${err.message}. Checking DB.`);
      try {
        const dbProducts = await prisma.product.findMany({
          where: { shop: { domain: shopDomain } },
          take: 250
        });
        rawProducts = dbProducts.map(p => {
          let parsedVariants = [];
          try {
            parsedVariants = typeof p.variants === 'string'
              ? JSON.parse(p.variants)
              : (Array.isArray(p.variants) ? p.variants : []);
          } catch (_) {}
          return {
            id: p.id,
            title: p.name || p.title || '',
            body_html: p.description || '',
            product_type: p.category || '',
            handle: (p.name || p.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            variants: parsedVariants.length > 0 ? parsedVariants : [{
              price: String(p.price || '0'),
              inventory_quantity: p.stock ?? 10
            }]
          };
        });
      } catch (dbErr) {
        console.warn(`⚠️ [ShopifyCatalogService] DB fallback failed: ${dbErr.message}`);
      }
    }

    // Normalize each product with rigorous numeric validation (zero NaN tolerance)
    const normalized = rawProducts.map(p => {
      const variants = Array.isArray(p.variants) && p.variants.length > 0 ? p.variants : [{}];
      const firstVariant = variants[0] || {};

      const rawPriceStr = String(firstVariant.price ?? p.price ?? '0').replace(/,/g, '');
      const priceMatch = rawPriceStr.match(/\d+(?:\.\d+)?/);
      const parsedPrice = priceMatch ? parseFloat(priceMatch[0]) : null;
      const isPriceValid = Number.isFinite(parsedPrice) && parsedPrice > 0;
      const numericPrice = isPriceValid ? parsedPrice : null;

      const formattedPrice = isPriceValid ? `Rs. ${numericPrice}` : 'Price on request';

      const inStock = variants.some(v => (v.inventory_quantity === undefined || v.inventory_quantity > 0));
      const cleanDesc = stripHtml(p.body_html || p.description || '');
      const truncatedDesc = cleanDesc.length > 160 ? `${cleanDesc.substring(0, 157)}...` : cleanDesc;

      const handle = p.handle || (p.title ? p.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') : '');
      const url = handle ? `https://${storefrontDomain}/products/${handle}` : `https://${storefrontDomain}`;

      return {
        id: String(p.id),
        title: p.title || p.name || 'Product',
        handle,
        price: formattedPrice,
        numericPrice,
        formattedPrice,
        available: inStock,
        inventory: firstVariant.inventory_quantity ?? 10,
        variantsCount: variants.length,
        description: truncatedDesc,
        productType: p.product_type || p.category || '',
        tags: String(p.tags || ''),
        url
      };
    });

    catalogCache.set(shopDomain, {
      timestamp: Date.now(),
      products: normalized,
      storefrontDomain
    });

    return normalized;
  }

  /**
   * Searches the entire catalog with multi-keyword relevance ranking and pagination
   * 
   * @param {string} shopDomain 
   * @param {string} query 
   * @param {{ page?: number, limit?: number }} options 
   * @returns {Promise<{ success: boolean, query: string, page: number, limit: number, totalFound: number, count: number, totalPages: number, products: Array<object>, message?: string }>}
   */
  static async searchProducts(shopDomain, query = '', options = {}) {
    const rawQuery = String(query || '').trim();
    const page = Math.max(1, parseInt(options.page || 1, 10));
    const limit = Math.max(1, Math.min(20, parseInt(options.limit || 5, 10)));

    const allProducts = await this.loadCatalog(shopDomain);
    const storefrontDomain = catalogCache.get(shopDomain)?.storefrontDomain || shopDomain;

    if (!rawQuery || rawQuery.toLowerCase() === 'catalog' || rawQuery.toLowerCase() === 'all') {
      // Return browsing view (first N products)
      const totalFound = allProducts.length;
      const totalPages = Math.ceil(totalFound / limit);
      const startIndex = (page - 1) * limit;
      const paged = allProducts.slice(startIndex, startIndex + limit);

      return {
        success: true,
        query: rawQuery,
        page,
        limit,
        totalFound,
        count: paged.length,
        totalPages,
        storefrontDomain,
        allProductsUrl: `https://${storefrontDomain}/collections/all-products`,
        products: paged,
        message: paged.length === 0 ? 'No products found in catalog.' : undefined
      };
    }

    const stopWords = new Set([
      'hai', 'hain', 'ka', 'ki', 'ke', 'ko', 'se', 'mein', 'me', 'aur', 'ya',
      'bhi', 'available', 'chahiye', 'mil', 'sakta', 'sakti', 'hoga', 'hogi',
      'the', 'a', 'an', 'and', 'or', 'for', 'is', 'are', 'in', 'of', 'to', 'with'
    ]);

    const PAKISTANI_SYNONYMS = {
      'kursi': ['chair'],
      'kursiyan': ['chair', 'chairs'],
      'kursiyo': ['chair', 'chairs'],
      'kursiyon': ['chair', 'chairs'],
      'chairs': ['chair'],
      'paon': ['leg', 'legs', 'foot', 'feet'],
      'paaon': ['leg', 'legs', 'foot', 'feet'],
      'paye': ['leg', 'legs'],
      'taang': ['leg', 'legs'],
      'taangein': ['leg', 'legs'],
      'covers': ['cover'],
      'protectors': ['protector', 'protect', 'protection'],
      'protection': ['protector', 'protect', 'cover', 'guard', 'silicone'],
      'protective': ['protection', 'protector', 'cover'],
      'wooden': ['wood', 'wooden'],
      'silicone': ['silicon', 'silicone'],
      'silicon': ['silicone'],
      'snoring': ['snoring', 'snore', 'anti-snoring'],
      'snore': ['snoring', 'anti-snoring'],
      'kharrate': ['snoring', 'anti-snoring', 'snore'],
      'kharate': ['snoring', 'anti-snoring', 'snore'],
      'kharaton': ['snoring', 'anti-snoring', 'snore'],
      'rokne': ['anti', 'stop', 'prevent'],
      'roknay': ['anti', 'stop', 'prevent'],
      'cheez': ['item', 'kit', 'product'],
      'naak': ['nasal', 'nose'],
      'chashma': ['glasses', 'spectacles'],
      'jootay': ['shoes'],
      'joote': ['shoes'],
      'kapray': ['clothes'],
      'kapre': ['clothes'],
      'kitchen': ['kitchen', 'cooking'],
      'cleaning': ['clean', 'cleaning'],
      'accessories': ['accessory', 'accessories'],
      'mobile': ['mobile', 'phone'],
      'pankha': ['fan'],
      'darwaza': ['door'],
      'dewar': ['wall'],
      'deewar': ['wall']
    };

    const tokens = rawQuery
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1 && !stopWords.has(t));

    const expandedTokens = new Set(tokens);
    for (const t of tokens) {
      if (PAKISTANI_SYNONYMS[t]) {
        for (const syn of PAKISTANI_SYNONYMS[t]) {
          expandedTokens.add(syn);
        }
      }
    }

    const searchTokens = expandedTokens.size > 0 ? Array.from(expandedTokens) : [rawQuery.toLowerCase()];
    const queryLower = rawQuery.toLowerCase();
    const scored = [];

    for (const p of allProducts) {
      const titleLower = p.title.toLowerCase();
      const handleLower = (p.handle || '').toLowerCase();
      const descLower = (p.description || '').toLowerCase();
      const tagsLower = (p.tags || '').toLowerCase();
      const typeLower = (p.productType || '').toLowerCase();

      let score = 0;

      // Exact title or handle match
      if (titleLower === queryLower || handleLower === queryLower) {
        score += 100;
      } else if (titleLower.includes(queryLower) || handleLower.includes(queryLower)) {
        score += 60;
      }

      // Keyword token matching
      let tokenMatches = 0;
      for (const token of searchTokens) {
        if (titleLower.includes(token)) {
          score += 25;
          tokenMatches++;
        } else if (handleLower.includes(token)) {
          score += 20;
          tokenMatches++;
        } else if (tagsLower.includes(token) || typeLower.includes(token)) {
          score += 15;
          tokenMatches++;
        } else if (descLower.includes(token)) {
          score += 5;
        }
      }

      if (score > 0 && (tokenMatches > 0 || titleLower.includes(queryLower))) {
        scored.push({ product: p, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);

    const totalFound = scored.length;
    const totalPages = Math.ceil(totalFound / limit);
    const startIndex = (page - 1) * limit;
    const paged = scored.slice(startIndex, startIndex + limit).map(s => s.product);

    return {
      success: true,
      query: rawQuery,
      page,
      limit,
      totalFound,
      count: paged.length,
      totalPages,
      storefrontDomain,
      allProductsUrl: `https://${storefrontDomain}/collections/all-products`,
      products: paged,
      message: paged.length === 0 ? `No products found matching "${rawQuery}".` : undefined
    };
  }

  /**
   * Retrieves single product details with authoritative pricing and direct URL
   * 
   * @param {string} shopDomain 
   * @param {{ query?: string, handle?: string, productId?: string }} identifier 
   * @returns {Promise<object|null>}
   */
  static async getProductDetails(shopDomain, identifier = {}) {
    const allProducts = await this.loadCatalog(shopDomain);

    const { query, handle, productId } = identifier;

    if (productId) {
      const found = allProducts.find(p => p.id === String(productId));
      if (found) return found;
    }

    if (handle) {
      const found = allProducts.find(p => p.handle.toLowerCase() === handle.toLowerCase());
      if (found) return found;
    }

    if (query) {
      const searchRes = await this.searchProducts(shopDomain, query, { page: 1, limit: 1 });
      if (searchRes.products && searchRes.products.length > 0) {
        return searchRes.products[0];
      }
    }

    return null;
  }

  /**
   * Fetches real store collections and links
   * 
   * @param {string} shopDomain 
   * @param {string} category 
   * @returns {Promise<Array<object>>}
   */
  static async getCollections(shopDomain, category = null) {
    const storefrontDomain = await this.getStorefrontDomain(shopDomain);
    const collections = [
      { title: 'All Products', handle: 'all-products', url: `https://${storefrontDomain}/collections/all-products` },
      { title: 'Best Selling', handle: 'best-selling', url: `https://${storefrontDomain}/collections/best-selling` },
      { title: 'Kitchen Collections', handle: 'kitchen-collections', url: `https://${storefrontDomain}/collections/kitchen-collections` },
      { title: 'Mobile Accessories', handle: 'mobile-accessories', url: `https://${storefrontDomain}/collections/mobile-accessories` },
      { title: 'Cleaning Products', handle: 'cleaning-products', url: `https://${storefrontDomain}/collections/cleaning-products` },
      { title: 'Women Collection', handle: 'women-collection', url: `https://${storefrontDomain}/collections/women-collection` }
    ];

    if (!category) return collections;

    const catLower = String(category).toLowerCase();
    const matched = collections.filter(c => c.title.toLowerCase().includes(catLower) || c.handle.includes(catLower));
    return matched.length > 0 ? matched : collections;
  }

  /**
   * Returns general store information and links
   * 
   * @param {string} shopDomain 
   * @returns {Promise<object>}
   */
  static async getStoreInfo(shopDomain) {
    const storefrontDomain = await this.getStorefrontDomain(shopDomain);
    return {
      name: 'Sunday Bazaaar',
      storefrontUrl: `https://${storefrontDomain}`,
      catalogUrl: `https://${storefrontDomain}/collections/all-products`,
      deliveryCharges: 'Free delivery on selected products / standard COD delivery across Pakistan'
    };
  }
}

export default ShopifyCatalogService;
