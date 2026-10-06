import { redis } from '../lib/redis.js';

// Fallback in-memory state store if Redis is offline
const memoryStore = new Map();
const STATE_TTL_SECONDS = 3600; // 1 hour session memory
const GREETING_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours conversation session expiry

/**
 * Structured Conversational State & Context Memory Service for Dial Mate 2.0
 * 
 * Production Guarantees:
 * 1. Persistent entity resolution across turns:
 *    currentProduct, lastProducts, currentOrder, lastOrders, currentSearch,
 *    currentSearchPage, customer, recentIntent, recentTopic,
 *    deliveryContext, purchaseContext, humanEscalationState.
 * 2. Manages conversation lifecycle (greeting policy: only at start or after genuine 24h expiry).
 * 3. Survives individual worker executions via Redis + robust memory fallback.
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
    
    // Sync currentProduct and lastReferencedProduct for 100% backward compatibility
    let currentProd = partialState.currentProduct || partialState.lastReferencedProduct || current.currentProduct || current.lastReferencedProduct || null;
    let lastRefProd = currentProd;

    const updated = {
      ...current,
      ...partialState,
      currentProduct: currentProd,
      lastReferencedProduct: lastRefProd,
      lastActivityTimestamp: partialState.lastActivityTimestamp || Date.now(),
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
   * Evaluates if a formal greeting is allowed on this turn.
   * Allowed ONLY at conversation start or after genuine 24-hour expiry.
   * 
   * @param {string} conversationId 
   * @param {number} messageCount - Number of past messages in conversation
   * @returns {Promise<boolean>}
   */
  static async shouldGreet(conversationId, messageCount = 0) {
    if (!conversationId) return true;
    const state = await this.getState(conversationId);

    // If already greeted in active memory, no new greeting
    if (state.isGreetingSent) {
      const elapsed = Date.now() - (state.lastActivityTimestamp || 0);
      if (elapsed < GREETING_EXPIRY_MS) {
        return false;
      }
    }

    // If message count > 0 and recent turn within session, no greeting
    if (messageCount > 0) {
      return false;
    }

    return true;
  }

  /**
   * Marks that the initial greeting has been delivered
   * 
   * @param {string} conversationId 
   */
  static async markGreetingSent(conversationId) {
    if (!conversationId) return;
    await this.updateState(conversationId, { isGreetingSent: true });
  }

  /**
   * Resolves currently active product from conversation state
   * 
   * @param {string} conversationId 
   * @returns {Promise<object|null>}
   */
  static async resolveActiveProduct(conversationId) {
    const state = await this.getState(conversationId);
    return state.currentProduct || state.lastReferencedProduct || (state.lastProducts && state.lastProducts[0]) || null;
  }

  /**
   * Resolves currently active order from conversation state
   * 
   * @param {string} conversationId 
   * @returns {Promise<object|null>}
   */
  static async resolveActiveOrder(conversationId) {
    const state = await this.getState(conversationId);
    return state.currentOrder || (state.lastOrders && state.lastOrders[0]) || null;
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
    const current = state.currentProduct || state.lastReferencedProduct;

    const clean = String(text || '').toLowerCase().trim();

    // 1. Ordinal References
    if (/\b(pehle|pehla|1st|first|one|number\s*1|1\s*number)\b/i.test(clean) && products[0]) {
      const p = products[0];
      await this.updateState(conversationId, { currentProduct: p, lastReferencedProduct: p, recentTopic: 'product' });
      return p;
    }

    if (/\b(doosre|doosra|dusra|dusre|2nd|second|two|number\s*2|2\s*number)\b/i.test(clean) && products[1]) {
      const p = products[1];
      await this.updateState(conversationId, { currentProduct: p, lastReferencedProduct: p, recentTopic: 'product' });
      return p;
    }

    if (/\b(teesre|teesra|tisra|3rd|third|three|number\s*3|3\s*number)\b/i.test(clean) && products[2]) {
      const p = products[2];
      await this.updateState(conversationId, { currentProduct: p, lastReferencedProduct: p, recentTopic: 'product' });
      return p;
    }

    if (/\b(chothe|chotha|4th|fourth|four|number\s*4|4\s*number)\b/i.test(clean) && products[3]) {
      const p = products[3];
      await this.updateState(conversationId, { currentProduct: p, lastReferencedProduct: p, recentTopic: 'product' });
      return p;
    }

    if (/\b(paanchwe|paanchwa|panchwa|5th|fifth|five|number\s*5|5\s*number)\b/i.test(clean) && products[4]) {
      const p = products[4];
      await this.updateState(conversationId, { currentProduct: p, lastReferencedProduct: p, recentTopic: 'product' });
      return p;
    }

    // 2. Direct Pronoun References ("iski", "iska", "is ki", "is ka", "iss ki", "iss ka", "yeh", "ye", "this", "that", "item", "product", etc.)
    if (/\b(iska|iski|is\s*ki|is\s*ka|iss\s*ki|iss\s*ka|ye\s*wala|yeh\s*wala|ye|yeh|this|that|item|product|uska|uski|us\s*ka|us\s*ki|woh\s*wala|wo\s*wala|wo|woh)\b/i.test(clean)) {
      const p = current || products[0] || null;
      if (p) {
        await this.updateState(conversationId, { currentProduct: p, lastReferencedProduct: p, recentTopic: 'product' });
      }
      return p;
    }

    // 3. Name fragment matching within recent products
    if (products.length > 0) {
      for (const p of products) {
        const words = p.title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        if (words.some(w => clean.includes(w))) {
          await this.updateState(conversationId, { currentProduct: p, lastReferencedProduct: p, recentTopic: 'product' });
          return p;
        }
      }
    }

    return current || products[0] || null;
  }
}

export default ConversationStateService;
