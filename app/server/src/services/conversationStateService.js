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
   * Returns true when the product has been rejected/dismissed by the customer
   */
  static isRejected(state, product) {
    if (!product) return false;
    const key = product.id || product.title;
    return (state.rejectedProducts || []).some(r => (r.id || r.title) === key);
  }

  /**
   * Resolves currently active product from conversation state.
   * Rejected/dismissed products are never active.
   * 
   * @param {string} conversationId 
   * @returns {Promise<object|null>}
   */
  static async resolveActiveProduct(conversationId) {
    const state = await this.getState(conversationId);
    const candidates = [
      state.currentProduct,
      state.lastReferencedProduct,
      ...((state.lastProducts || []).slice(0, 1))
    ];
    return candidates.find(p => p && !this.isRejected(state, p)) || null;
  }

  /**
   * Marks the given product (default: current product) as REJECTED and removes it
   * from the active context. It is only re-activated if the customer asks for it again.
   *
   * @returns {Promise<object|null>} the rejected product
   */
  static async rejectProduct(conversationId, product = null) {
    if (!conversationId) return null;
    const state = await this.getState(conversationId);
    const target = product || state.currentProduct || state.lastReferencedProduct || null;
    const rejected = state.rejectedProducts || [];
    if (target && !this.isRejected(state, target)) {
      rejected.push({ id: target.id, title: target.title, rejectedAt: Date.now() });
    }
    await this.clearActiveProduct(conversationId, {
      rejectedProducts: rejected,
      productInterestState: target ? 'REJECTED' : (state.productInterestState || null),
      lastProducts: (state.lastProducts || []).filter(p => !target || (p.id || p.title) !== (target.id || target.title))
    });
    return target;
  }

  /**
   * Re-activates a previously rejected product (customer explicitly asked for it again)
   */
  static async unrejectProduct(conversationId, product) {
    if (!conversationId || !product) return;
    const state = await this.getState(conversationId);
    const key = product.id || product.title;
    await this.updateState(conversationId, {
      rejectedProducts: (state.rejectedProducts || []).filter(r => (r.id || r.title) !== key)
    });
  }

  /**
   * Clears the active product context (updateState cannot null out a product because it
   * merges with the previous value, so this writes the state directly).
   */
  static async clearActiveProduct(conversationId, extra = {}) {
    if (!conversationId) return {};
    const current = await this.getState(conversationId);
    const updated = {
      ...current,
      ...extra,
      currentProduct: null,
      lastReferencedProduct: null,
      productInterestState: extra.productInterestState || null,
      recentTopic: current.recentTopic === 'product' ? null : current.recentTopic,
      lastActivityTimestamp: Date.now(),
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
   * Human escalation is an EVENT, not a terminal state. These helpers record that the
   * human team was notified so the owner is not re-notified on every message, while the
   * conversation stays active.
   */
  static async hasRecentHumanEscalation(conversationId, windowMs = 30 * 60 * 1000) {
    const state = await this.getState(conversationId);
    const at = state.humanEscalation?.notifiedAt;
    return Boolean(at && Date.now() - at < windowMs);
  }

  static async markHumanEscalation(conversationId, details = {}) {
    await this.updateState(conversationId, {
      humanEscalation: { requested: true, notificationSent: details.notificationSent !== false, notifiedAt: Date.now(), ...details }
    });
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
    const ordinalMatches = [
      { pattern: /\b(pehle|pehla|1st|first|one|number\s*1|1\s*number)\b/i, index: 0 },
      { pattern: /\b(doosre|doosra|dusra|dusre|2nd|second|two|number\s*2|2\s*number)\b/i, index: 1 },
      { pattern: /\b(teesre|teesra|tisra|3rd|third|three|number\s*3|3\s*number)\b/i, index: 2 },
      { pattern: /\b(chothe|chotha|4th|fourth|four|number\s*4|4\s*number)\b/i, index: 3 },
      { pattern: /\b(paanchwe|paanchwa|panchwa|5th|fifth|five|number\s*5|5\s*number)\b/i, index: 4 }
    ];
    for (const om of ordinalMatches) {
      if (om.pattern.test(clean) && products[om.index]) {
        const p = products[om.index];
        await this.unrejectProduct(conversationId, p);
        await this.updateState(conversationId, { currentProduct: p, lastReferencedProduct: p, recentTopic: 'product' });
        return p;
      }
    }

    // 2. Direct Pronoun References ("iski", "iska", "is ki", "is ka", "iss ki", "iss ka", "yeh", "ye", "this", "that", "item", "product", etc.)
    if (/\b(iska|iski|is\s*ki|is\s*ka|iss\s*ki|iss\s*ka|ye\s*wala|yeh\s*wala|ye|yeh|this|that|item|product|uska|uski|us\s*ka|us\s*ki|woh\s*wala|wo\s*wala|wo|woh)\b/i.test(clean)) {
      const candidate = (current && !this.isRejected(state, current))
        ? current
        : products.find(p => !this.isRejected(state, p)) || null;
      if (candidate) {
        await this.updateState(conversationId, { currentProduct: candidate, lastReferencedProduct: candidate, recentTopic: 'product' });
      }
      return candidate;
    }

    // 3. Name fragment matching within recent products (explicitly unrejects if named)
    if (products.length > 0) {
      for (const p of products) {
        const words = (p.title || '').toLowerCase().split(/\s+/).filter(w => w.length > 3);
        if (words.some(w => clean.includes(w))) {
          await this.unrejectProduct(conversationId, p);
          await this.updateState(conversationId, { currentProduct: p, lastReferencedProduct: p, recentTopic: 'product' });
          return p;
        }
      }
    }

    const fallback = (current && !this.isRejected(state, current))
      ? current
      : products.find(p => !this.isRejected(state, p)) || null;
    return fallback;
  }
}

export default ConversationStateService;
