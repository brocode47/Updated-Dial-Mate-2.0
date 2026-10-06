import { redis } from '../lib/redis.js';

// Fallback in-memory state store if Redis is offline
const memoryStore = new Map();
const STATE_TTL_SECONDS = 3600; // 1 hour session memory

/**
 * Structured Conversational State & Context Memory Service
 */
export class ConversationStateService {
  /**
   * Retrieves conversation session state
   * 
   * @param {string} conversationId 
   * @returns {Promise<object>}
   */
  static async getState(conversationId) {
    if (!conversationId) return {};

    try {
      if (redis && redis.status === 'ready') {
        const raw = await redis.get(`conv_state:${conversationId}`);
        if (raw) return JSON.parse(raw);
      }
    } catch (_) {}

    return memoryStore.get(conversationId) || {};
  }

  /**
   * Updates conversation session state with partial attributes
   * 
   * @param {string} conversationId 
   * @param {object} partialState 
   * @returns {Promise<object>}
   */
  static async updateState(conversationId, partialState = {}) {
    if (!conversationId) return {};

    const current = await this.getState(conversationId);
    const updated = {
      ...current,
      ...partialState,
      updatedAt: Date.now()
    };

    try {
      if (redis && redis.status === 'ready') {
        await redis.setex(`conv_state:${conversationId}`, STATE_TTL_SECONDS, JSON.stringify(updated));
      }
    } catch (_) {}

    memoryStore.set(conversationId, updated);
    return updated;
  }

  /**
   * Resolves natural Roman Urdu ordinal or contextual product reference
   * (e.g. "pehle wale", "doosra wala", "iska price", "jo wall max dikhaya tha")
   * 
   * @param {string} conversationId 
   * @param {string} text 
   * @returns {Promise<object|null>}
   */
  static async resolveProductReference(conversationId, text = '') {
    const state = await this.getState(conversationId);
    const products = state.lastProducts || [];
    if (products.length === 0) return state.lastReferencedProduct || null;

    const clean = String(text || '').toLowerCase().trim();

    // 1. Ordinal References
    if (/\b(pehle|pehla|1st|first|one|number\s*1|1\s*number)\b/i.test(clean)) {
      const p = products[0] || null;
      if (p) await this.updateState(conversationId, { lastReferencedProduct: p });
      return p;
    }

    if (/\b(doosre|doosra|dusra|dusre|2nd|second|two|number\s*2|2\s*number)\b/i.test(clean)) {
      const p = products[1] || null;
      if (p) await this.updateState(conversationId, { lastReferencedProduct: p });
      return p;
    }

    if (/\b(teesre|teesra|tisra|3rd|third|three|number\s*3|3\s*number)\b/i.test(clean)) {
      const p = products[2] || null;
      if (p) await this.updateState(conversationId, { lastReferencedProduct: p });
      return p;
    }

    if (/\b(chothe|chotha|4th|fourth|four|number\s*4|4\s*number)\b/i.test(clean)) {
      const p = products[3] || null;
      if (p) await this.updateState(conversationId, { lastReferencedProduct: p });
      return p;
    }

    if (/\b(paanchwe|paanchwa|panchwa|5th|fifth|five|number\s*5|5\s*number)\b/i.test(clean)) {
      const p = products[4] || null;
      if (p) await this.updateState(conversationId, { lastReferencedProduct: p });
      return p;
    }

    // 2. Direct Pronoun References ("iska", "iski", "ye wala", "uska")
    if (/\b(iska|iski|is\s*ki|ye\s*wala|yeh\s*wala|uska|uski)\b/i.test(clean)) {
      const p = state.lastReferencedProduct || products[0] || null;
      return p;
    }

    // 3. Name fragment matching within recent products
    for (const p of products) {
      const words = p.title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      if (words.some(w => clean.includes(w))) {
        await this.updateState(conversationId, { lastReferencedProduct: p });
        return p;
      }
    }

    return state.lastReferencedProduct || null;
  }
}

export default ConversationStateService;
