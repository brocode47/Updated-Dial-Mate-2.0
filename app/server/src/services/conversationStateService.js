import { redis } from '../lib/redis.js';
import { MessageNormalizer } from './conversationBrain.js';

// Fallback in-memory state store if Redis is offline
const memoryStore = new Map();
const aliasMap = new Map();
const STATE_TTL_SECONDS = 3600; // 1 hour session memory
const GREETING_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours conversation session expiry

/**
 * Structured Conversational State & Context Memory Service for Dial Mate 2.0
 * 
 * Production Guarantees:
 * 1. Persistent entity resolution across turns:
 *    activeIntent, activeProduct, activeProductId, activeProductUrl, activeProductPrice,
 *    activeDeliveryCharge, activeProductTotal, activeOrderId, activeOrderNumber,
 *    activeOrderStatus, lastCustomerMessage, lastAssistantMessage, lastAssistantIntent,
 *    pendingAction, rejectedProducts, conversationSummary, recentTurns, escalationState.
 * 2. Manages conversation lifecycle (greeting policy, closure and seamless resumption).
 * 3. Survives individual worker executions via Redis + robust memory fallback.
 * 4. Canonical phone-keyed and conversation-id aliased state persistence.
 */
export class ConversationStateService {
  /**
   * Registers a key alias (e.g. mapping conversationId -> shopId:canonicalPhone)
   */
  static registerAlias(sourceKey, targetKey) {
    if (sourceKey && targetKey && sourceKey !== targetKey) {
      aliasMap.set(sourceKey, targetKey);
      // If sourceKey already had state stored before alias was registered, merge into targetKey
      const sourceState = memoryStore.get(sourceKey);
      const targetState = memoryStore.get(targetKey);
      if (sourceState && !targetState) {
        memoryStore.set(targetKey, sourceState);
      } else if (sourceState && targetState) {
        memoryStore.set(targetKey, { ...targetState, ...sourceState });
      }
    }
  }

  /**
   * Clears in-memory state store and alias map (useful for test isolation)
   */
  static clearMemory() {
    memoryStore.clear();
    aliasMap.clear();
  }

  /**
   * Resolves canonical key if an alias exists
   */
  static resolveKey(key) {
    if (!key) return key;
    return aliasMap.get(key) || key;
  }

  /**
   * Retrieves conversation session state
   * 
   * @param {string} conversationId 
   * @returns {Promise<object>}
   */
  static async getState(conversationId) {
    if (!conversationId) return {};
    const canonicalKey = this.resolveKey(conversationId);

    try {
      if (redis && (redis.status === 'ready' || redis.status === 'connect')) {
        let raw = await redis.get(`conv_state:${canonicalKey}`);
        if (!raw && canonicalKey !== conversationId) {
          raw = await redis.get(`conv_state:${conversationId}`);
        }
        if (raw) {
          const parsed = JSON.parse(raw);
          memoryStore.set(canonicalKey, parsed);
          memoryStore.set(conversationId, parsed);
          return parsed;
        }
      }
    } catch (_) {}

    return memoryStore.get(canonicalKey) || memoryStore.get(conversationId) || {};
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
    
    // Sync activeProduct, currentProduct, and lastReferencedProduct for 100% backward compatibility
    let currentProd = partialState.activeProduct !== undefined
      ? partialState.activeProduct
      : (partialState.currentProduct || partialState.lastReferencedProduct || current.activeProduct || current.currentProduct || current.lastReferencedProduct || null);
    let lastRefProd = currentProd;

    // Sync activeOrder and currentOrder
    let currentOrd = partialState.activeOrder !== undefined
      ? partialState.activeOrder
      : (partialState.currentOrder || current.activeOrder || current.currentOrder || null);

    const activeProdId = currentProd ? (currentProd.id || null) : (partialState.activeProductId ?? current.activeProductId ?? null);
    const activeProdUrl = currentProd ? (currentProd.url || null) : (partialState.activeProductUrl ?? current.activeProductUrl ?? null);
    const activeProdPrice = currentProd ? (currentProd.formattedPrice || currentProd.price || null) : (partialState.activeProductPrice ?? current.activeProductPrice ?? null);
    const activeProdVariant = partialState.activeProductVariant ?? currentProd?.variant ?? currentProd?.selectedVariant ?? current.activeProductVariant ?? null;

    const activeOrdId = currentOrd ? (currentOrd.orderId || currentOrd.id || null) : (partialState.activeOrderId ?? current.activeOrderId ?? null);
    const activeOrdNumber = currentOrd ? (currentOrd.orderNumber || null) : (partialState.activeOrderNumber ?? current.activeOrderNumber ?? null);
    const activeOrdStatus = currentOrd ? (currentOrd.status || null) : (partialState.activeOrderStatus ?? current.activeOrderStatus ?? null);

    // Customer Identity & Fields
    const activeCust = partialState.activeCustomer !== undefined ? partialState.activeCustomer : (current.activeCustomer || null);
    const custName = partialState.customerName ?? activeCust?.name ?? activeCust?.firstName ?? current.customerName ?? null;
    const custPhone = partialState.customerPhone ?? activeCust?.phone ?? current.customerPhone ?? null;
    const custCity = partialState.customerCity ?? activeCust?.city ?? current.customerCity ?? null;
    const custAddress = partialState.customerAddress ?? activeCust?.address ?? current.customerAddress ?? null;

    // Escalation state
    const escalation = partialState.escalationState || current.escalationState || current.humanEscalation || null;
    const humanEscActive = partialState.humanEscalationActive !== undefined
      ? Boolean(partialState.humanEscalationActive)
      : (partialState.escalationState?.requested ?? current.humanEscalationActive ?? Boolean(escalation?.requested));

    // Interaction & Entities
    const lastInt = partialState.lastIntent || partialState.activeIntent || current.lastIntent || current.activeIntent || null;
    const lastUserInt = partialState.lastUserIntent || (partialState.activeIntent ? partialState.activeIntent : current.lastUserIntent) || null;
    const lastAsstAction = partialState.lastAssistantAction || partialState.action || current.lastAssistantAction || null;
    const lastExpEntity = partialState.lastExplicitEntity !== undefined ? partialState.lastExplicitEntity : (current.lastExplicitEntity || null);
    const lastMentEntity = partialState.lastMentionedEntity !== undefined ? partialState.lastMentionedEntity : (current.lastMentionedEntity || (currentProd ? { type: 'PRODUCT', id: activeProdId, title: currentProd?.title } : null));

    // Stages
    const convStage = partialState.conversationPhase || partialState.conversationStage || current.conversationPhase || current.conversationStage || (currentOrd ? 'ORDER_SERVICING' : (currentProd ? 'PRODUCT_DISCOVERY' : 'GREETING'));
    const chkStage = partialState.checkoutStage !== undefined ? partialState.checkoutStage : (partialState.checkoutState?.step || current.checkoutStage || null);
    const pendClarification = partialState.pendingClarification !== undefined ? partialState.pendingClarification : (current.pendingClarification || null);

    // Active Entity representation (Product, Order, Customer, Policy, etc.)
    let activeEntity = partialState.activeEntity !== undefined
      ? partialState.activeEntity
      : (current.activeEntity || null);

    if (currentProd && (!activeEntity || activeEntity.type === 'PRODUCT' || partialState.activeProduct !== undefined)) {
      activeEntity = {
        type: 'PRODUCT',
        id: activeProdId,
        title: currentProd.title || currentProd.name,
        price: activeProdPrice,
        numericPrice: currentProd.numericPrice || null,
        deliveryCharge: partialState.activeDeliveryCharge ?? current.activeDeliveryCharge ?? 199,
        url: activeProdUrl
      };
    } else if (currentOrd && (!activeEntity || activeEntity.type === 'ORDER' || partialState.activeOrder !== undefined)) {
      activeEntity = {
        type: 'ORDER',
        id: activeOrdId,
        orderNumber: activeOrdNumber,
        status: activeOrdStatus,
        totalAmount: currentOrd.totalAmount || null
      };
    }

    // Recent Entities Stack
    const recentEntities = [...(partialState.recentEntities || current.recentEntities || [])];
    if (activeEntity && !recentEntities.some(e => e.id === activeEntity.id && e.type === activeEntity.type)) {
      recentEntities.unshift(activeEntity);
      if (recentEntities.length > 5) recentEntities.pop();
    }

    // Topic history
    const currentTopic = partialState.recentTopic || partialState.currentTopic || current.recentTopic || current.currentTopic || null;
    const prevTopic = (currentTopic && currentTopic !== current.currentTopic) ? current.currentTopic : (current.previousTopic || null);
    const prevIntent = (lastInt && lastInt !== current.activeIntent) ? current.activeIntent : (current.previousIntent || null);

    const updated = {
      ...current,
      ...partialState,
      // Active entity representation
      activeEntity,
      recentEntities,
      currentTopic,
      previousTopic: prevTopic,
      recentTopic: currentTopic,
      currentIntent: lastInt,
      previousIntent: prevIntent,
      conversationPhase: convStage,

      // Active product entities
      activeProduct: currentProd,
      currentProduct: currentProd,
      lastReferencedProduct: lastRefProd,
      activeProductVariant: activeProdVariant,
      activeProductId: activeProdId,
      activeProductUrl: activeProdUrl,
      activeProductPrice: activeProdPrice,
      activeDeliveryCharge: partialState.activeDeliveryCharge ?? current.activeDeliveryCharge ?? 199,
      activeProductTotal: partialState.activeProductTotal ?? current.activeProductTotal ?? null,

      // Active order entities
      activeOrder: currentOrd,
      currentOrder: currentOrd,
      activeOrderId: activeOrdId,
      activeOrderNumber: activeOrdNumber,
      activeOrderStatus: activeOrdStatus,

      // Customer identity
      activeCustomer: activeCust,
      customerName: custName,
      customerPhone: custPhone,
      customerCity: custCity,
      customerAddress: custAddress,

      // Interaction tracking
      activeIntent: lastInt,
      lastIntent: lastInt,
      lastUserIntent: lastUserInt,
      lastAssistantAction: lastAsstAction,
      lastExplicitEntity: lastExpEntity,
      lastMentionedEntity: lastMentEntity,
      lastCustomerMessage: partialState.lastCustomerMessage || current.lastCustomerMessage || null,
      lastAssistantMessage: partialState.lastAssistantMessage || current.lastAssistantMessage || null,
      lastAssistantIntent: partialState.lastAssistantIntent || current.lastAssistantIntent || null,
      pendingAction: partialState.pendingAction !== undefined ? partialState.pendingAction : (current.pendingAction || null),

      // Lifecycles & Stages
      rejectedProducts: partialState.rejectedProducts || current.rejectedProducts || [],
      rejectedCategories: partialState.rejectedCategories || current.rejectedCategories || [],
      conversationStage: convStage,
      humanEscalationActive: humanEscActive,
      checkoutStage: chkStage,
      pendingClarification: pendClarification,
      recentTurns: partialState.recentTurns || current.recentTurns || [],
      escalationState: escalation,
      isClosed: partialState.isClosed !== undefined ? partialState.isClosed : (current.isClosed || false),

      lastActivityTimestamp: partialState.lastActivityTimestamp || Date.now(),
      updatedAt: Date.now()
    };

    // Rebuild compact summary
    updated.conversationSummary = this.buildSummary(updated);

    const canonicalKey = this.resolveKey(conversationId);

    try {
      if (redis && (redis.status === 'ready' || redis.status === 'connect')) {
        await redis.setex(`conv_state:${canonicalKey}`, STATE_TTL_SECONDS, JSON.stringify(updated));
        if (canonicalKey !== conversationId) {
          await redis.setex(`conv_state:${conversationId}`, STATE_TTL_SECONDS, JSON.stringify(updated));
        }
      }
    } catch (_) {}

    memoryStore.set(canonicalKey, updated);
    memoryStore.set(conversationId, updated);

    if (process.env.ZARA_DEBUG_CONTEXT === 'true') {
      console.log(`[STATE WRITE] key=${conversationId} canonical=${canonicalKey} activeProd=${updated.activeProduct?.title || 'none'} activeOrd=${updated.activeOrderNumber || 'none'}`);
    }

    return updated;
  }

  /**
   * Sets active order context explicitly
   * 
   * @param {string} conversationId 
   * @param {object} order 
   * @returns {Promise<object>}
   */
  static async setActiveOrder(conversationId, order) {
    if (!conversationId || !order) return {};
    return this.updateState(conversationId, {
      activeOrder: order,
      currentOrder: order,
      activeOrderId: order.orderId || order.id || null,
      activeOrderNumber: String(order.orderNumber || order.id || '').replace(/^#/, ''),
      activeOrderStatus: order.status || 'In Transit',
      recentTopic: 'order'
    });
  }

  /**
   * Clears active order context
   */
  static async clearActiveOrder(conversationId) {
    if (!conversationId) return {};
    const current = await this.getState(conversationId);
    const updated = {
      ...current,
      activeOrder: null,
      currentOrder: null,
      activeOrderId: null,
      activeOrderNumber: null,
      activeOrderStatus: null,
      recentTopic: current.recentTopic === 'order' ? null : current.recentTopic,
      lastActivityTimestamp: Date.now(),
      updatedAt: Date.now()
    };
    const canonicalKey = this.resolveKey(conversationId);
    try {
      if (redis && (redis.status === 'ready' || redis.status === 'connect')) {
        await redis.setex(`conv_state:${canonicalKey}`, STATE_TTL_SECONDS, JSON.stringify(updated));
        if (canonicalKey !== conversationId) {
          await redis.setex(`conv_state:${conversationId}`, STATE_TTL_SECONDS, JSON.stringify(updated));
        }
      }
    } catch (_) {}
    memoryStore.set(canonicalKey, updated);
    memoryStore.set(conversationId, updated);
    return updated;
  }

  /**
   * Sets active product context explicitly with pricing and delivery charges
   */
  static async setActiveProduct(conversationId, product, deliveryCharge = 199) {
    if (!conversationId || !product) return {};
    await this.unrejectProduct(conversationId, product);
    const priceNum = Number(product.numericPrice || 0);
    const totalNum = priceNum > 0 ? (priceNum + deliveryCharge) : null;
    return this.updateState(conversationId, {
      activeProduct: product,
      currentProduct: product,
      lastReferencedProduct: product,
      activeProductId: product.id || null,
      activeProductUrl: product.url || null,
      activeProductPrice: product.formattedPrice || product.price || null,
      activeDeliveryCharge: deliveryCharge,
      activeProductTotal: totalNum ? `Rs. ${totalNum}` : null,
      recentTopic: 'product'
    });
  }

  /**
   * Sets pending action from assistant turn (e.g. AWAITING_ORDER_NUMBER)
   */
  static async setPendingAction(conversationId, action) {
    if (!conversationId) return {};
    return this.updateState(conversationId, { pendingAction: action });
  }

  /**
   * Clears pending action
   */
  static async clearPendingAction(conversationId) {
    if (!conversationId) return {};
    return this.updateState(conversationId, { pendingAction: null });
  }

  /**
   * Records a turn in recentTurns and updates latest messages
   */
  static async recordTurn(conversationId, turn = {}) {
    if (!conversationId) return;
    const state = await this.getState(conversationId);
    const turns = state.recentTurns || [];
    turns.push({
      sender: turn.sender || 'customer',
      text: turn.text || '',
      intent: turn.intent || null,
      timestamp: Date.now()
    });
    // Keep max 8 turns in compact memory
    const trimmed = turns.slice(-8);
    const updateObj = { recentTurns: trimmed };
    if (turn.sender === 'customer') {
      updateObj.lastCustomerMessage = turn.text;
      // If conversation was closed, reopening it automatically
      if (state.isClosed) {
        updateObj.isClosed = false;
      }
    } else {
      updateObj.lastAssistantMessage = turn.text;
      if (turn.intent) updateObj.lastAssistantIntent = turn.intent;
    }
    await this.updateState(conversationId, updateObj);
  }

  /**
   * Builds compact summary string of active entities and conversation progress
   */
  static buildSummary(state = {}) {
    const parts = [];
    if (state.activeOrderNumber) {
      parts.push(`Active Order: #${state.activeOrderNumber} (${state.activeOrderStatus || 'processing'})`);
    }
    if (state.activeProduct?.title) {
      parts.push(`Active Product: ${state.activeProduct.title} (${state.activeProductPrice || ''})`);
    }
    if (state.activeIntent) {
      parts.push(`Latest Intent: ${state.activeIntent}`);
    }
    if (state.pendingAction) {
      parts.push(`Pending Action: ${state.pendingAction}`);
    }
    if (state.rejectedProducts && state.rejectedProducts.length > 0) {
      parts.push(`Rejected: ${state.rejectedProducts.map(p => p.title || p.id).join(', ')}`);
    }
    if (state.escalationState?.requested) {
      parts.push(`Escalation: Human Support Notified`);
    }
    return parts.join(' | ');
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
      state.activeProduct,
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
    const target = product || state.activeProduct || state.currentProduct || state.lastReferencedProduct || null;
    const rejected = state.rejectedProducts || [];
    if (target && !this.isRejected(state, target)) {
      rejected.push({ ...target, rejectedAt: Date.now() });
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
   * Clears the active product context
   */
  static async clearActiveProduct(conversationId, extra = {}) {
    if (!conversationId) return {};
    const current = await this.getState(conversationId);
    const updated = {
      ...current,
      ...extra,
      activeProduct: null,
      currentProduct: null,
      lastReferencedProduct: null,
      activeProductId: null,
      activeProductUrl: null,
      activeProductPrice: null,
      activeProductTotal: null,
      productInterestState: extra.productInterestState || null,
      recentTopic: current.recentTopic === 'product' ? null : current.recentTopic,
      lastActivityTimestamp: Date.now(),
      updatedAt: Date.now()
    };
    const canonicalKey = this.resolveKey(conversationId);
    try {
      if (redis && (redis.status === 'ready' || redis.status === 'connect')) {
        await redis.setex(`conv_state:${canonicalKey}`, STATE_TTL_SECONDS, JSON.stringify(updated));
        if (canonicalKey !== conversationId) {
          await redis.setex(`conv_state:${conversationId}`, STATE_TTL_SECONDS, JSON.stringify(updated));
        }
      }
    } catch (_) {}
    memoryStore.set(canonicalKey, updated);
    memoryStore.set(conversationId, updated);
    return updated;
  }

  /**
   * Human escalation is an EVENT, not a terminal state.
   */
  static async hasRecentHumanEscalation(conversationId, windowMs = 30 * 60 * 1000) {
    const state = await this.getState(conversationId);
    const at = state.escalationState?.notifiedAt || state.humanEscalation?.notifiedAt;
    return Boolean(at && Date.now() - at < windowMs);
  }

  static async markHumanEscalation(conversationId, details = {}) {
    const escalation = {
      requested: true,
      notificationSent: details.notificationSent !== false,
      notifiedAt: details.notifiedAt || Date.now(),
      conversationId: details.conversationId || conversationId,
      ...details
    };
    await this.updateState(conversationId, {
      escalationState: escalation,
      humanEscalation: escalation,
      humanEscalationActive: true
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
    return state.activeOrder || state.currentOrder || (state.lastOrders && state.lastOrders[0]) || null;
  }

  /**
   * Resolves natural Roman Urdu ordinal or contextual product reference
   * 
   * @param {string} conversationId 
   * @param {string} text 
   * @returns {Promise<object|null>}
   */
  static async resolveProductReference(conversationId, text = '') {
    const state = await this.getState(conversationId);
    const products = state.lastProducts || [];
    const current = state.activeProduct || state.currentProduct || state.lastReferencedProduct;

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
        await this.setActiveProduct(conversationId, p);
        return p;
      }
    }

    // 2. Direct Pronoun & Elliptical References ("iski", "iska", "dc?", "price?", "link?", "total?", "ye", "woh", "same wala", "upar wala", etc.)
    const normalized = MessageNormalizer.normalize(text);
    if (
      normalized.hasPronoun ||
      normalized.ellipticalType ||
      /\b(iska|iski|iske|is\s*ki|is\s*ka|iss\s*ki|iss\s*ka|ye\s*wala|yeh\s*wala|ye|yeh|this|that|item|product|uska|uski|uske|us\s*ka|us\s*ki|woh\s*wala|wo\s*wala|wo|woh|same\s*wala|upar\s*wala|jo\s*bataya|jo\s*dikhaya|dc\?|dc)\b/i.test(clean)
    ) {
      const candidate = (current && !this.isRejected(state, current))
        ? current
        : products.find(p => !this.isRejected(state, p)) || null;
      if (candidate) {
        await this.setActiveProduct(conversationId, candidate);
      }
      return candidate;
    }

    // 3. Name fragment matching within recent products (explicitly unrejects if named)
    if (products.length > 0) {
      for (const p of products) {
        const words = (p.title || '').toLowerCase().split(/\s+/).filter(w => w.length > 3);
        if (words.some(w => clean.includes(w))) {
          await this.unrejectProduct(conversationId, p);
          await this.setActiveProduct(conversationId, p);
          return p;
        }
      }
    }

    // 4. Name fragment matching within previously rejected products (re-activates on explicit recall like "wo 19L wala dobara dikhao")
    if (state.rejectedProducts && state.rejectedProducts.length > 0) {
      for (const rej of state.rejectedProducts) {
        const words = (rej.title || '').toLowerCase().split(/\s+/).filter(w => w.length >= 3);
        if (words.some(w => clean.includes(w)) || (clean.includes('dobara') || clean.includes('phir se') || clean.includes('again'))) {
          if (words.some(w => clean.includes(w))) {
            await this.unrejectProduct(conversationId, rej);
            await this.setActiveProduct(conversationId, rej);
            return rej;
          }
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