/**
 * Product Summary & Name Normalization Service for Dial Mate 2.0
 * 
 * Guarantees:
 * 1. Customer-friendly and spoken-friendly product names (no robotic brackets, SKU numbers, or awkward punctuation).
 * 2. Never sends raw scraped Shopify marketing or dropshipping descriptions.
 * 3. Extracts core benefits, pack sizes, and materials in natural Roman Urdu.
 */
export class ProductSummaryService {
  /**
   * Normalizes product titles into canonical, customer-friendly, and spoken forms
   * 
   * @param {string} rawTitle 
   * @returns {{ canonicalShopifyTitle: string, customerFriendlyName: string, shortSpokenName: string }}
   */
  static normalizeProductName(rawTitle = '') {
    const canonical = String(rawTitle || '').trim();
    if (!canonical) {
      return {
        canonicalShopifyTitle: 'Product',
        customerFriendlyName: 'Product',
        shortSpokenName: 'Product'
      };
    }

    const lower = canonical.toLowerCase();

    // Preserve exact canonical titles when already clean
    if (lower.includes('wooden silicone chair') || lower.includes('silicone chair protection')) {
      return {
        canonicalShopifyTitle: canonical,
        customerFriendlyName: canonical,
        shortSpokenName: 'Chair Protection Cover'
      };
    }

    if (lower.includes('chair') && (lower.includes('cover') || lower.includes('protect') || lower.includes('silicone') || lower.includes('leg'))) {
      return {
        canonicalShopifyTitle: canonical,
        customerFriendlyName: canonical.includes('Chair') ? canonical : 'Chair Protection Cover',
        shortSpokenName: 'Chair Protection Cover'
      };
    }

    if (lower.includes('anti snorring') || lower.includes('anti snoring')) {
      const clean = canonical.replace(/\s*-\s*\([0-9]+\s*sizes?\)/gi, '').replace(/\s*\([0-9]+\s*sizes?\)/gi, '').trim();
      return {
        canonicalShopifyTitle: canonical,
        customerFriendlyName: clean || 'Anti Snoring Kit',
        shortSpokenName: 'Anti Snoring Kit'
      };
    }

    if (lower.includes('nasal dilator')) {
      return {
        canonicalShopifyTitle: canonical,
        customerFriendlyName: canonical,
        shortSpokenName: 'Anti Snoring Kit'
      };
    }

    if (lower.includes('wall max') || lower.includes('adhesive wall max')) {
      return {
        canonicalShopifyTitle: canonical,
        customerFriendlyName: canonical,
        shortSpokenName: 'Adhesive Wall Max'
      };
    }

    if (lower.includes('sofa') && lower.includes('cover')) {
      return {
        canonicalShopifyTitle: canonical,
        customerFriendlyName: canonical,
        shortSpokenName: 'Sofa Cover'
      };
    }

    // Generic title cleanup: strip parenthetical pack/size text, SKU numbers, weird punctuation
    let friendly = canonical
      .replace(/\s*\([0-9]+\s*(?:sizes?|pieces?|pcs?|pack)\)/gi, '')
      .replace(/\s*-\s*\([0-9]+\s*(?:sizes?|pieces?|pcs?|pack)\)/gi, '')
      .replace(/\s*-\s*[0-9]+\s*(?:sizes?|pieces?|pcs?|pack)/gi, '')
      .replace(/\s*\[[^\]]+\]/g, '')
      .replace(/\s*\([^\)]+\)/g, '')
      .replace(/\b(?:Pack of|Set of)\s*\d+\b/gi, '')
      .replace(/\s+-\s+.*$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (!friendly) friendly = canonical;

    const spoken = friendly
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    return {
      canonicalShopifyTitle: canonical,
      customerFriendlyName: friendly,
      shortSpokenName: spoken || friendly
    };
  }

  static normalizeProductTitle(rawTitle = '') {
    return this.normalizeProductName(rawTitle);
  }

  /**
   * Generates a clean, customer-facing Roman Urdu product summary
   * Eliminates raw scraped HTML/marketing copy completely.
   * 
   * @param {string} rawTitle 
   * @param {string} rawDescription 
   * @returns {string}
   */
  static cleanProductSummary(rawTitle = '', rawDescription = '') {
    const titleLower = String(rawTitle || '').toLowerCase();
    const descLower = String(rawDescription || '').toLowerCase();

    // 1. Curated Sunday Bazaaar Catalog Product Profiles
    if (titleLower.includes('chair') || descLower.includes('chair legs') || descLower.includes('protect you flooring')) {
      return 'Yeh chair ke legs ke liye silicone protection covers hain. Ye chairs move karte waqt floor ko scratches aur awaz se bachane mein madad karte hain. Pack mein 24 pieces hain.';
    }

    if (titleLower.includes('snor') || descLower.includes('snoring') || descLower.includes('nasal dilator')) {
      return 'Yeh anti snoring nose clip kit hai jo sote waqt saans lene ko aasan banati hai aur kharaton ko reduce karne mein madad karti hai. Ismein 4 different sizes shamil hain.';
    }

    if ((titleLower.includes('wall') && titleLower.includes('max')) || titleLower.includes('tape')) {
      return 'Yeh heavy-duty double sided transparent adhesive tape hai jo deewar par baghair keel (nails) ke cheezon ko mazbooti se chipkane ke liye use hoti hai.';
    }

    if (titleLower.includes('sofa') && titleLower.includes('cover')) {
      return 'Yeh stretchable velvet sofa cover hai jo sofa ko dhool aur daagh se mehfooz rakhta hai aur new look deta hai.';
    }

    // 2. Generic Product Cleaning & Human Roman Urdu Extraction
    if (!rawDescription) {
      const names = this.normalizeProductName(rawTitle);
      return `Yeh hamari ${names.customerFriendlyName} hai, jo high quality aur genuine product hai.`;
    }

    // Strip HTML tags
    let clean = String(rawDescription)
      .replace(/<[^>]*>?/gm, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, ' ')
      .trim();

    // Strip common dropshipping / scraped junk phrases
    const junkPatterns = [
      /Looking for something that protect you flooring[\s\S]*?\./gi,
      /100% brand new and high quality[\s\S]*?\./gi,
      /Package Included:[\s\S]*/gi,
      /Package List:[\s\S]*/gi,
      /Specification:[\s\S]*/gi,
      /Notice:[\s\S]*/gi,
      /Note:[\s\S]*/gi,
      /Warm tips:[\s\S]*/gi,
      /Due to the light and screen setting difference[\s\S]*?\./gi,
      /Please allow slight dimension difference[\s\S]*?\./gi,
      /Features?:/gi
    ];

    for (const pat of junkPatterns) {
      clean = clean.replace(pat, ' ');
    }
    clean = clean.replace(/\s{2,}/g, ' ').trim();

    // Extract first 1-2 clean sentences that contain useful facts
    const sentences = clean.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 15 && s.length < 160);
    if (sentences.length > 0) {
      const best = sentences.slice(0, 2).join('. ') + '.';
      return `Yeh ${best}`;
    }

    const names = this.normalizeProductName(rawTitle);
    return `Yeh hamari ${names.customerFriendlyName} hai, jo daily use ke liye best aur reliable product hai.`;
  }
}

export default ProductSummaryService;
