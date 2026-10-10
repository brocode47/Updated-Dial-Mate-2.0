import { ProductSummaryService } from './productSummaryService.js';
import { DeliveryService } from './deliveryService.js';
import { PhoneNormalizer } from './phoneNormalizer.js';

/**
 * ============================================================================
 * CONVERSATION BRAIN FOR DIAL MATE 2.0 — ZARA (SUNDAY BAZAAAR OFFICIAL)
 * ============================================================================
 *
 * Core Foundations:
 * 1. Multi-tier Message Normalization Layer (preserves raw, normalizes phonetic Roman Urdu,
 *    Pakistani English, typos, repeated chars, contractions, abbreviations).
 * 2. Active Entity & Discourse Management (PRODUCT, ORDER, CUSTOMER, DELIVERY_POLICY,
 *    PAYMENT_POLICY, RETURN_POLICY, STORE_INFO, HUMAN_SUPPORT, CASUAL_TOPIC, NONE).
 * 3. Continuity vs Context-Switch Detection.
 * 4. Semantic Reference Resolution (Pronouns, Ordinals, Relatives, Ellipticals).
 * 5. Generalized Intent Understanding Engine.
 * 6. Ambiguity Detection & Minimal Clarification.
 * 7. Multi-layered Memory Architecture (Turn, Short-Term Context, Structured State, Customer Memory, Business Knowledge).
 * 8. Response Generation Contract & Response Relevance Guard.
 * 9. Unified Modality Architecture (Text <-> Voice shared brain).
 */

export const ActiveEntityType = {
  PRODUCT: 'PRODUCT',
  ORDER: 'ORDER',
  CUSTOMER: 'CUSTOMER',
  DELIVERY_POLICY: 'DELIVERY_POLICY',
  PAYMENT_POLICY: 'PAYMENT_POLICY',
  RETURN_POLICY: 'RETURN_POLICY',
  STORE_INFO: 'STORE_INFO',
  HUMAN_SUPPORT: 'HUMAN_SUPPORT',
  CASUAL_TOPIC: 'CASUAL_TOPIC',
  NONE: 'NONE'
};

export const ConversationPhase = {
  GREETING: 'GREETING',
  PRODUCT_DISCOVERY: 'PRODUCT_DISCOVERY',
  PRODUCT_EVALUATION: 'PRODUCT_EVALUATION',
  CHECKOUT_FLOW: 'CHECKOUT_FLOW',
  ORDER_SERVICING: 'ORDER_SERVICING',
  SUPPORT_ESCALATION: 'SUPPORT_ESCALATION',
  CASUAL_CHAT: 'CASUAL_CHAT',
  CLOSED: 'CLOSED'
};

export const IntentFamily = {
  DELIVERY_INQUIRY: 'DELIVERY_INQUIRY',
  TOTAL_COST_INQUIRY: 'TOTAL_COST_INQUIRY',
  PRODUCT_DETAIL: 'PRODUCT_DETAIL',
  PRODUCT_LINK: 'PRODUCT_LINK',
  PRODUCT_INQUIRY: 'PRODUCT_INQUIRY',
  PRODUCT_REJECTION: 'PRODUCT_REJECTION',
  PURCHASE_INTENT: 'PURCHASE_INTENT',
  CHECKOUT: 'CHECKOUT',
  ORDER_STATUS: 'ORDER_STATUS',
  ORDER_LOOKUP: 'ORDER_LOOKUP',
  ORDER_SUMMARY: 'ORDER_SUMMARY',
  ORDER_NUMBER_INPUT: 'ORDER_NUMBER_INPUT',
  CONFIRM: 'CONFIRM',
  CANCEL: 'CANCEL',
  CONFIRM_NEGATED: 'CONFIRM_NEGATED',
  CANCEL_NEGATED: 'CANCEL_NEGATED',
  HUMAN_TRANSFER: 'HUMAN_TRANSFER',
  OWNER_INFO: 'OWNER_INFO',
  BOT_IDENTITY: 'BOT_IDENTITY',
  STORE_INFO: 'STORE_INFO',
  CATALOG: 'CATALOG',
  COLLECTION: 'COLLECTION',
  SOCIAL_CASUAL: 'SOCIAL_CASUAL',
  SOCIAL_FRIENDSHIP: 'SOCIAL_FRIENDSHIP',
  SOCIAL_CLOSING: 'SOCIAL_CLOSING',
  SOCIAL_THANKYOU: 'SOCIAL_THANKYOU',
  CUSTOMER_COMPLAINT: 'CUSTOMER_COMPLAINT',
  CUSTOMER_FRUSTRATION: 'CUSTOMER_FRUSTRATION',
  SOCIAL_ACK: 'SOCIAL_ACK',
  CLARIFICATION_NEEDED: 'CLARIFICATION_NEEDED',
  UNKNOWN: 'UNKNOWN'
};

/**
 * Tier 1: Message Normalization Layer
 * Preserves raw input untouched while extracting clean semantic tokens and phonetic expansions.
 */
export class MessageNormalizer {
  /**
   * Normalizes inbound customer text while preserving raw text
   *
   * @param {string} text
   * @returns {object}
   */
  static normalize(text = '') {
    const raw = String(text || '');
    const clean = raw.toLowerCase().trim();

    // 1. Collapse run-away repeated characters (e.g. "plzzzzz" -> "plz", "soooch" -> "soch", "kaaaab" -> "kab")
    let collapsed = clean.replace(/([a-z])\1{2,}/gi, '$1$1');

    // 2. Expand common Pakistani e-commerce abbreviations before tokenization
    // Use word boundary-safe regex
    collapsed = collapsed
      .replace(/\b(d[\.\/\s]?c[\.\?]?)\b/gi, 'delivery charges')
      .replace(/\bdc\?/gi, 'delivery charges?')
      .replace(/\b(c[\.\/\s]?o[\.\/\s]?d)\b/gi, 'cash on delivery')
      .replace(/\b(asap)\b/gi, 'as soon as possible')
      .replace(/\b(plz|plse|pls|plese)\b/gi, 'please')
      .replace(/\b(yr|yara)\b/gi, 'yaar')
      .replace(/\b(pic|pics|pix)\b/gi, 'picture')
      .replace(/\b(loc)\b/gi, 'location')
      .replace(/\b(num|ph|contct)\b/gi, 'number')
      .replace(/\b(msg)\b/gi, 'message')
      .replace(/\b(w\/o|w\/out)\b/gi, 'without')
      .replace(/\b(w\/)\b/gi, 'with')
      .replace(/\b(b\/w)\b/gi, 'between')
      .replace(/\b(info)\b/gi, 'information');

    // 3. Phonetic Roman Urdu and typos mapping
    let normalized = collapsed
      .replace(/\b(mujhy|muje|mjhe|mujy|mje|muj)\b/gi, 'mujhe')
      .replace(/\b(chahiye|chaiye|chahye|chaia|chahie|chaheye|chahiy)\b/gi, 'chahiye')
      .replace(/\b(protekshan|protekshin|protact|protector)\b/gi, 'protection')
      .replace(/\b(chear|chaer|chayer)\b/gi, 'chair')
      .replace(/\b(delivry|delvry|dilvery|dilevery|dlvery|dilivry|delvery|delivary)\b/gi, 'delivery')
      .replace(/\b(charjis|chargis|chargiz|chargs)\b/gi, 'charges')
      .replace(/\b(pohcha|pohncha|poncha|pahuncha|pohancho|pahancha|pohnchega|ponchega|pohnchegi|pohnch)\b/gi, 'pohancha')
      .replace(/\b(kidr|kdr|kidhar)\b/gi, 'kahan')
      .replace(/\b(cnfrm|confrim|confrm|cnfirm|confarm)\b/gi, 'confirm')
      .replace(/\b(cancle|cancil|cancl|cencl)\b/gi, 'cancel')
      .replace(/\b(btao|btado|batadein|bta|btayein|btana|btaein)\b/gi, 'batao')
      .replace(/\b(kitny|kitney)\b/gi, 'kitne')
      .replace(/\b(kro|krow)\b/gi, 'karo')
      .replace(/\b(krdo|kardo)\b/gi, 'kar do')
      .replace(/\b(krna|krni|krne)\b/gi, 'karna')
      .replace(/\b(kr)\b/gi, 'kar')
      .replace(/\b(mt)\b/gi, 'mat')
      .replace(/\b(nhi|nai|nae)\b/gi, 'nahi')
      .replace(/\b(kb)\b/gi, 'kab')
      .replace(/\b(kaha|kha)\b/gi, 'kahan')
      .replace(/\b(bottal|botal|botle)\b/gi, 'bottle')
      .replace(/\b(safai|safayee)\b/gi, 'cleaning')
      .replace(/\b(baraf|barf)\b/gi, 'ice')
      .replace(/\b(nasel)\b/gi, 'nasal')
      .replace(/\b(dikhaye|dikhao|dekhao|dkhao)\b/gi, 'dikhao')
      .replace(/\b(bhejo|bhej|send\s*kro|send\s*karo)\b/gi, 'bhejo')
      .replace(/\b(paray\s*ga|padega|parega|pary\s*ga|parayga|parhega)\b/gi, 'padega')
      .replace(/\b(shippng|shiping)\b/gi, 'shipping');

    const tokens = normalized.split(/\s+/).filter(Boolean);

    // 4. Structural linguistic feature detection
    const isQuestion = raw.includes('?') || /\b(kya|kab|kahan|kitna|kitne|kitni|kaise|kese|kon|koun|who|what|where|when|how|how\s*much|how\s*many)\b/i.test(normalized);

    // Detect pronouns & relative demonstratives
    const pronounMatch = normalized.match(/\b(iski|iska|iske|is|uska|uski|uske|yeh|ye|woh|wo|this|that|it|its|the\s*product|the\s*item|the\s*order|yehi|wohi|item|product)\b/i);
    const hasPronoun = Boolean(pronounMatch);
    const detectedPronoun = pronounMatch ? pronounMatch[1].toLowerCase() : null;

    // Detect relative/ordinal references
    const ordinalMatch = normalized.match(/\b(pehle\s*wala|pehla|1st|first|one|number\s*1|doosre\s*wala|doosra|dusra|2nd|second|two|number\s*2|teesre\s*wala|teesra|tisra|3rd|third|three|number\s*3|chothe|chotha|4th|fourth|paanchwe|paanchwa|5th|fifth|last\s*wala|aakhri|upar\s*wala|jo\s*bataya\s*tha|jo\s*dikhaya\s*tha|jo\s*order\s*kiya\s*tha|same\s*wala|same)\b/i);
    const hasOrdinal = Boolean(ordinalMatch);

    // Detect elliptical follow-up queries (short messages asking for specific attributes)
    let ellipticalType = null;
    const strippedPunctuation = clean.replace(/[?!.]/g, '').trim();

    if (
      /^(total|kul|final|total\s*bill|final\s*bill|overall|all\s*inclusive|total\s*amount)$/i.test(strippedPunctuation) ||
      (/\b(total|final|all\s*inclusive|kul)\b/i.test(strippedPunctuation) && strippedPunctuation.length <= 30)
    ) {
      ellipticalType = 'TOTAL_QUERY';
    } else if (
      /^(dc|delivery|delivery\s*charges|shipping|shipping\s*charges|ghar\s*tak)$/i.test(strippedPunctuation) ||
      (/\b(dc|delivery\s*charges?|shipping\s*charges?|shipping|delivery)\b/i.test(strippedPunctuation) && strippedPunctuation.length <= 25 && !/\b(kab|hogi|ayega|deliver\s*hoga|pohanchega)\b/i.test(strippedPunctuation))
    ) {
      ellipticalType = 'DELIVERY_QUERY';
    } else if (
      /^(price|rate|cost|kitne\s*ka|kitna|kitne)$/i.test(strippedPunctuation) ||
      (/\b(price|rate|cost)\b/i.test(strippedPunctuation) && strippedPunctuation.length <= 15)
    ) {
      ellipticalType = 'PRICE_QUERY';
    } else if (
      /^(link|url|website|page|direct\s*link)$/i.test(strippedPunctuation)
    ) {
      ellipticalType = 'LINK_QUERY';
    }

    return {
      rawMessage: raw,
      cleanMessage: clean,
      normalizedMessage: normalized,
      tokens,
      isQuestion,
      hasPronoun,
      detectedPronoun,
      hasOrdinal,
      ordinalMatch: ordinalMatch ? ordinalMatch[1] : null,
      ellipticalType
    };
  }
}

/**
 * Tier 2: Semantic Discourse & Context Management
 * Manages the active entity, distinguishes topic switches from continuation,
 * and resolves semantic references.
 */
export class SemanticContextResolver {
  /**
   * Evaluates discourse continuity vs topic switch
   *
   * @param {object} normalization
   * @param {object} state
   * @param {object} contextOptions
   * @returns {object}
   */
  static evaluateDiscourse(normalization, state = {}, contextOptions = {}) {
    const text = normalization.normalizedMessage;
    const clean = normalization.cleanMessage;

    const currentProduct = state.activeProduct || state.currentProduct || null;
    const currentOrder = state.activeOrder || state.currentOrder || null;
    const recentTopic = state.recentTopic || null;

    // 1. Explicit Order topic triggers (always priority)
    const hasOrderKeywords = /\b(order|parcel|booking|tracking|shipment|courier|dispatch)\b/i.test(text);
    const hasOrderDigits = /\b#?\d{3,7}\b/.test(clean);
    const isExplicitOrderSwitch = (hasOrderKeywords && !/\b(order\s*kar|book\s*kar|order\s*karna|ye\s*order)\b/i.test(text)) ||
      (hasOrderDigits && !/\b(pack|piece|pcs|ml|ltr|size)\b/i.test(text));

    if (isExplicitOrderSwitch) {
      const isContinuingSameOrder = currentOrder && (
        text.includes(String(currentOrder.orderNumber || '')) ||
        /\b(yeh|ye|woh|wo|iska|iski|status|kab|kahan|tracking)\b/i.test(text)
      );
      return {
        isTopicSwitch: !isContinuingSameOrder,
        isContinuation: Boolean(isContinuingSameOrder),
        targetEntityType: ActiveEntityType.ORDER,
        topic: 'order'
      };
    }

    // 2. Explicit Human Support escalation trigger
    const personWord = '(human|insan|insaan|real\\s*(person|banda|insan)|asli\\s*banda|banda|agent|representative|operator|owner|manager|customer\\s*(support|care|service)|support(\\s*(team|staff))?|staff)';
    const isHumanRequest = new RegExp(`(kisi\\s*)?${personWord}\\s*(se|sy|say|ko)\\s*(baat|bat|bate|talk|connect|milao|milwao|rabta|call|bulao|transfer)`, 'i').test(text) ||
      new RegExp(`\\b(talk|speak|baat|connect|transfer)\\s*(to|with|karwao|karao|karo)?\\s*(a\\s*)?(kisi\\s*)?${personWord}\\b`, 'i').test(text) ||
      /\b(human|agent|insan|banda)\s*(chahiye|please|plz|bhejo|bulao)\b/i.test(text) ||
      /\b(human|live)\s*agent\b/i.test(text);

    if (isHumanRequest) {
      return {
        isTopicSwitch: true,
        isContinuation: false,
        targetEntityType: ActiveEntityType.HUMAN_SUPPORT,
        topic: 'support'
      };
    }

    // 3. Casual / emotional / chit-chat topic triggers (NEVER trigger catalog search!)
    const isCasualChitChat = /\b(dosti|friendship|friends|upset\s*h[uo]n?|udas\s*h[uo]n?|sad\s*h[uo]n?|pareshan\s*h[uo]n?|mood\s*kharab|neend\s*nahi|neend\s*nhi|girlfriend|kaisi\s*ho|kese\s*ho|kya\s*haal|chup\s*karo|shut\s*up|idiot|pagal|bekar\s*bot|bakwas\s*bot|fuzool\s*bot)\b/i.test(text) ||
      /\b(allah\s*hafiz|khuda\s*hafiz|bye|goodbye|thank\s*you|thanks|shukriya)\b/i.test(text);

    if (isCasualChitChat) {
      return {
        isTopicSwitch: true,
        isContinuation: false,
        targetEntityType: ActiveEntityType.CASUAL_TOPIC,
        topic: 'casual'
      };
    }

    // 4. General Store / Website / Delivery Policy inquiry (when no specific product is being discussed)
    const isGeneralPolicy = (
      /\b(delivery\s*policy|delivery\s*charges\s*kitni|all\s*pakistan\s*delivery|return\s*policy|exchange\s*policy|payment\s*method|cash\s*on\s*delivery\s*available|website\s*kya\s*hai|online\s*store)\b/i.test(text)
    ) && !currentProduct;

    if (isGeneralPolicy) {
      return {
        isTopicSwitch: true,
        isContinuation: false,
        targetEntityType: ActiveEntityType.DELIVERY_POLICY,
        topic: 'policy'
      };
    }

    // 5. Explicit New Product Mentions (Context Switch between products)
    const knownProductKeywords = [
      'snoring', 'dilator', 'kharate', 'kharatoun',
      'chair', 'kursi', 'silicone\s*cover', 'leg\s*cover',
      'brush', 'bath\s*brush', 'shower\s*brush',
      'bottle', 'water\s*bottle', 'spray',
      'belt', 'shoes', 'chopper', 'cutter', 'mop'
    ];

    const mentionsNewProduct = knownProductKeywords.some(kw => new RegExp(`\\b${kw}\\b`, 'i').test(text));
    if (mentionsNewProduct) {
      // Check if user is referencing the SAME product already active
      const currentTitle = (currentProduct?.title || '').toLowerCase();
      const isSameProduct = currentProduct && knownProductKeywords.some(kw => {
        const regex = new RegExp(`\\b${kw}\\b`, 'i');
        return regex.test(text) && regex.test(currentTitle);
      });

      if (!isSameProduct) {
        return {
          isTopicSwitch: true,
          isContinuation: false,
          targetEntityType: ActiveEntityType.PRODUCT,
          topic: 'product'
        };
      }
    }

    // 6. Continuation with Active Entity
    // If active product exists and customer asks an elliptical question, pronoun, price, total, link, etc.
    const isContinuationQuery = Boolean(
      normalization.ellipticalType ||
      normalization.hasPronoun ||
      normalization.hasOrdinal ||
      /\b(price|rate|cost|kitne|kitna|total|kul|final|dc|delivery|shipping|link|url|details|detail|order\s*kar|book\s*kar|lena\s*hai|bhejo|aur\s*batao|ye\s*kitne|ye\s*kya)\b/i.test(text)
    );

    if (currentProduct && isContinuationQuery && !hasOrderKeywords) {
      return {
        isTopicSwitch: false,
        isContinuation: true,
        targetEntityType: ActiveEntityType.PRODUCT,
        topic: 'product'
      };
    }

    if (currentOrder && (isContinuationQuery || hasOrderKeywords)) {
      return {
        isTopicSwitch: false,
        isContinuation: true,
        targetEntityType: ActiveEntityType.ORDER,
        topic: 'order'
      };
    }

    return {
      isTopicSwitch: false,
      isContinuation: Boolean(currentProduct || currentOrder),
      targetEntityType: currentProduct ? ActiveEntityType.PRODUCT : (currentOrder ? ActiveEntityType.ORDER : ActiveEntityType.NONE),
      topic: recentTopic || 'general'
    };
  }

  /**
   * Resolves semantic reference (pronouns, ordinals, ellipsis) to concrete entity
   *
   * @param {object} normalization
   * @param {object} state
   * @param {object} discourse
   * @param {object} options - { orders: [], catalogProducts: [] }
   * @returns {object}
   */
  static resolveEntity(normalization, state = {}, discourse = {}, options = {}) {
    const text = normalization.normalizedMessage;
    const clean = normalization.cleanMessage;
    const recentProducts = state.recentProducts || state.lastProducts || state.recentEntities || [];
    const recentOrders = state.recentOrders || options.orders || [];
    const activeProd = state.activeProduct || state.currentProduct || null;
    const activeOrd = state.activeOrder || state.currentOrder || null;

    const makeRes = (type, ent, isAmb, cands, prompt = null) => ({
      entityType: type,
      entity: ent,
      resolvedEntity: ent,
      isAmbiguous: isAmb,
      ambiguous: isAmb,
      candidates: cands,
      possibleEntities: cands,
      clarificationPrompt: prompt
    });

    // 1. Ordinal References ("pehle wala", "doosre wala", "1st", "2nd", "3rd", etc.)
    if (normalization.hasOrdinal && !/\border\b/i.test(text)) {
      const ordinalIndices = [
        { pattern: /\b(pehle|pehla|1st|first|one|number\s*1)\b/i, index: 0 },
        { pattern: /\b(doosre|doosra|dusra|2nd|second|two|number\s*2)\b/i, index: 1 },
        { pattern: /\b(teesre|teesra|tisra|3rd|third|three|number\s*3)\b/i, index: 2 },
        { pattern: /\b(chothe|chotha|4th|fourth|four|number\s*4)\b/i, index: 3 },
        { pattern: /\b(paanchwe|paanchwa|5th|fifth|five|number\s*5)\b/i, index: 4 }
      ];

      for (const oi of ordinalIndices) {
        if (oi.pattern.test(text) && recentProducts[oi.index]) {
          const target = recentProducts[oi.index];
          return makeRes(ActiveEntityType.PRODUCT, target, false, [target]);
        }
      }
    }

    // 2. Explicit Order References by Number ("#1643", "1643", "order 1643")
    const orderNumMatch = clean.match(/#?(\d{3,7})/);
    if (orderNumMatch && (discourse.targetEntityType === ActiveEntityType.ORDER || /\border|parcel|booking\b/i.test(text))) {
      const num = orderNumMatch[1];
      const matchOrd = recentOrders.find(o => String(o.orderNumber || o.id).replace(/^#/, '') === num);
      if (matchOrd) {
        return makeRes(ActiveEntityType.ORDER, matchOrd, false, [matchOrd]);
      }
    }

    // 3. Ambiguity Resolution: Multiple Orders on file and customer gives an ambiguous inquiry
    if (discourse.targetEntityType === ActiveEntityType.ORDER && !activeOrd && recentOrders.length > 1) {
      if (/\b(status|kab|kahan|tracking|cancel|confirm)\b/i.test(text) && !orderNumMatch) {
        const choices = recentOrders.slice(0, 3).map(o => `#${o.orderNumber}`).join(' ya ');
        return makeRes(
          ActiveEntityType.ORDER,
          null,
          true,
          recentOrders,
          `Aapke ${recentOrders.length} orders record mein hain (${choices}). Aap kis order ke baare mein baat kar rahay hain?`
        );
      }
    }

    // 4. Order continuation / Pronouns referring to active order
    if (discourse.targetEntityType === ActiveEntityType.ORDER && activeOrd) {
      return makeRes(ActiveEntityType.ORDER, activeOrd, false, [activeOrd]);
    }

    // 5. Pronouns & Elliptical Continuation for Active Product
    const isProductContinuation = discourse.targetEntityType === ActiveEntityType.PRODUCT ||
      Boolean(activeProd && (normalization.ellipticalType || normalization.hasPronoun || discourse.isContinuation));

    if (isProductContinuation && activeProd) {
      return makeRes(ActiveEntityType.PRODUCT, activeProd, false, [activeProd]);
    }

    // 6. Ambiguity Resolution: Multiple Products recently discussed and customer says "iska batao" or "link?"
    if (normalization.hasPronoun && !activeProd && recentProducts.length > 1) {
      const names = recentProducts.slice(0, 2).map(p => ProductSummaryService.normalizeProductName(p.title).customerFriendlyName);
      return makeRes(
        ActiveEntityType.PRODUCT,
        null,
        true,
        recentProducts,
        `Ji, aap ${names[0]} ki baat kar rahay hain ya ${names[1]} ki?`
      );
    }

    // 7. Policy / Business Entity
    if (discourse.targetEntityType === ActiveEntityType.DELIVERY_POLICY) {
      return makeRes(
        ActiveEntityType.DELIVERY_POLICY,
        { standardDeliveryCharge: 199, estimatedDays: '3–5 working days', coverage: 'All Pakistan COD' },
        false,
        []
      );
    }

    return makeRes(discourse.targetEntityType || ActiveEntityType.NONE, null, false, []);
  }
}

/**
 * Tier 3: General Intent Understanding Engine
 * Maps natural conversation, elliptical phrases, and discourse context to generalized intent families.
 */
export class IntentEngine {
  /**
   * Evaluates if a statement expresses negation
   */
  static isNegated(text = '', action = 'confirm') {
    const clean = String(text || '').toLowerCase().trim();
    if (action === 'confirm') {
      if (/\b(confirm|cnfrm)\s*(nahi|nahin|nhi|mat|mt|na)\b/i.test(clean)) return true;
      if (/(?<!\bcancel\s*)\b(nahi|nahin|nhi|mat|mt|na)\s*(karna|krna|karwana)?\s*(confirm|cnfrm)\b/i.test(clean)) return true;
      if (/\b(bhejna|bhejo|dispatch|deliver)\s*(mat|nahi|nahin|nhi|na)\b/i.test(clean)) return true;
      if (/\b(mat|nahi|nahin|nhi|na)\s*(bhejna|bhejo|dispatch|deliver)\b/i.test(clean)) return true;
      if (/\b(abhi\s*nahi|soch\s*kar|shayad|baad\s*mein|bad\s*me|wait|ruko|filhal\s*nahi|filhaal\s*nahi)\b/i.test(clean)) return true;
      return false;
    }
    if (action === 'cancel') {
      if (/\b(cancel|cancle)\s*(nahi|nahin|nhi|mat|mt|na)\b/i.test(clean)) return true;
      if (/(?<!\b(confirm|cnfrm)\s*)\b(nahi|nahin|nhi|mat|mt|na)\s*(karna|krna|karwana)?\s*(cancel|cancle)\b/i.test(clean)) return true;
      return false;
    }
    return false;
  }

  /**
   * Infers semantic intent family based on message normalization + discourse context
   *
   * @param {object} normalization
   * @param {object} discourse
   * @param {object} entityResolution
   * @param {object} state
   * @returns {{ family: string, intent: string, confidence: number, [key: string]: any }}
   */
  static inferIntent(normalization, discourse = {}, entityResolution = {}, state = {}) {
    const text = normalization.normalizedMessage;
    const clean = normalization.cleanMessage;

    // 1. Direct Shortcuts
    if (clean === '1' || clean === 'confirm') {
      return { family: IntentFamily.CONFIRM, intent: 'CONFIRM', confidence: 0.99 };
    }
    if (clean === '2' || clean === 'cancel') {
      return { family: IntentFamily.CANCEL, intent: 'CANCEL', confidence: 0.99 };
    }

    // 2. Exact Order Number Input (#1643, 1643, order 1643)
    const exactOrderMatch = clean.match(/^#?(\d{3,7})(?:\s*wala(?:\s*order)?)?$/i);
    if (exactOrderMatch) {
      return { family: IntentFamily.ORDER_NUMBER_INPUT, intent: 'ORDER_NUMBER_INPUT', orderNumber: exactOrderMatch[1], confidence: 0.99 };
    }
    const explicitOrderPhrase = clean.match(/^(?:order|mera\s*order)\s*(?:#|no\.?|number)?\s*(\d{3,7})(?:\s*wala)?$/i);
    if (explicitOrderPhrase) {
      return { family: IntentFamily.ORDER_NUMBER_INPUT, intent: 'ORDER_NUMBER_INPUT', orderNumber: explicitOrderPhrase[1], confidence: 0.99 };
    }

    // 3. Negations & Hesitations
    const isConfirmNegated = this.isNegated(clean, 'confirm');
    const isCancelNegated = this.isNegated(clean, 'cancel');

    if (isConfirmNegated && /\b(cancel|cancle|khatam|mansookh)\b/i.test(clean) && !isCancelNegated) {
      return { family: IntentFamily.CANCEL, intent: 'CANCEL', confidence: 0.95 };
    }
    if (isCancelNegated && /\b(confirm|bhej|dispatch)\b/i.test(clean) && !isConfirmNegated) {
      return { family: IntentFamily.CONFIRM, intent: 'CONFIRM', confidence: 0.95 };
    }
    if (isConfirmNegated) {
      return { family: IntentFamily.CONFIRM_NEGATED, intent: 'CONFIRM_NEGATED', confidence: 0.98 };
    }
    if (isCancelNegated) {
      if (/\b(mt|mat)\s*k[ar]na\b/i.test(clean)) {
        return { family: IntentFamily.CANCEL, intent: 'CANCEL', isNegated: true, confidence: 0.98 };
      }
      return { family: IntentFamily.CANCEL_NEGATED, intent: 'CANCEL_NEGATED', confidence: 0.98 };
    }

    // 4. Human Support Escalation
    if (discourse.targetEntityType === ActiveEntityType.HUMAN_SUPPORT) {
      return { family: IntentFamily.HUMAN_TRANSFER, intent: 'HUMAN_TRANSFER', confidence: 0.96 };
    }

    // 5. Customer Complaints & Retention
    if (
      /\b(kabhi\s*(bhi\s*)?(ab\s*)?(shopping\s*nahi|nahi\s*karunga|kuch\s*nahi\s*mangwana)|dobara\s*shopping\s*nahi|bohat\s*buri\s*service|bht\s*buri\s*service|gandi\s*service|fraud|service\s*pasand\s*nahi|never\s*shopping\s*again|worst\s*service|nahi\s*karunga\s*shopping)\b/i.test(clean) ||
      /\b(main\s*kabhi\s*ab\s*.*shopping\s*nahi)\b/i.test(clean)
    ) {
      return { family: IntentFamily.CUSTOMER_COMPLAINT, intent: 'CUSTOMER_COMPLAINT', confidence: 0.96 };
    }

    // 5b. Customer Frustration
    if (
      /\b(tum\s*kya\s*bata\s*rahi\s*ho|tumhara\s*masla\s*kya\s*hai|tmhara\s*masla\s*kya\s*hai|bekar\s*bot|bakwas\s*bot|fuzool\s*bot|fazol\s*bot|samajh\s*nahi\s*aa\s*raha|samjh\s*nhi\s*ara|kya\s*bakwas\s*hai|kisi\s*kaam\s*ki\s*nahi|dimagh\s*kharab|dimaag\s*kharab|chup\s*karo|shut\s*up|idiot|pagal\s*bot)\b/i.test(clean) ||
      /\b(masla\s*kya\s*hai|kya\s*masla\s*hai|tumhara\s*kya\s*masla\s*hai)\b/i.test(clean)
    ) {
      return { family: IntentFamily.CUSTOMER_FRUSTRATION, intent: 'CUSTOMER_FRUSTRATION', confidence: 0.98 };
    }

    // 6. Identity & Bot Ownership
    if (/\b(tumh?are\s*owner\s*ka\s*naam|owner\s*ka\s*naam|owner\s*kon\s*hai|owner\s*koun\s*hai|who\s*is\s*(the\s*)?owner)\b/i.test(clean)) {
      return { family: IntentFamily.OWNER_INFO, intent: 'OWNER_INFO', confidence: 0.95 };
    }
    if (/\b((tum[ahr]+a|tmhara|apka|aapka|tera|your|bot)\s*(naam|name)\s*kya\s*(hai|h[ya]i?|he)|who\s*are\s*you|what\s*is\s*your\s*name)\b/i.test(clean)) {
      return { family: IntentFamily.BOT_IDENTITY, intent: 'BOT_IDENTITY', confidence: 0.95 };
    }

    // 7. Ordinal References & Specific Demonstrative Price/Link queries (e.g. "pehle wale ka link", "iski price?", "iska link", "ye wala kitne ka?")
    const isOrdinalOrContextual = Boolean(
      (/\b(pehle\s*wale|doosre\s*wale|dusre\s*wale|teesre|tisre|chothe|paanchwe|1st|2nd|3rd|number\s*1|number\s*2|yeh?\s*wal[ae]y?|pehly\s*walay|woh?\s*wal[ae]y?|doosra\s*wala|last\s*wala|iska\s*link|iski\s*link)\b/i.test(clean) ||
       /\b(iska|iski)\s*price\?/i.test(clean) ||
       /^(?:iska|iski)\s*price\??$/i.test(clean) ||
       /\b(ye\s*wala\s*kitne\s*ka)\b/i.test(clean)) &&
      !/\b(order|confirm|cnfrm)\b/i.test(clean)
    );

    if (isOrdinalOrContextual || (normalization.hasOrdinal && !/\b(order|confirm|cnfrm)\b/i.test(clean))) {
      return { family: IntentFamily.PRODUCT_DETAIL, intent: 'ORDINAL_REFERENCE', confidence: 0.94 };
    }

    // 8. General Total Cost Inquiry (Semantic Match for "total?", "final kitna?", "all inclusive kitna?", "yeh kitne ka paray ga?", "delivery mila k kitna?", etc.)
    const isTotalQuery = Boolean(
      normalization.ellipticalType === 'TOTAL_QUERY' ||
      /\b(total|kul|final|overall|all\s*inclusive)\b/i.test(text) ||
      /\b(iska\s*total|total\s*kitna|total\s*bill|kitne\s*paise|total\s*amount|cod\s*amount|kitna\s*bill|kul\s*total|delivery\s*(?:ke\s*sath|mila\s*k[ae]?)\s*total|delivery\s*mila\s*k\s*kitna|delivery\s*mila\s*kar\s*kitna|total\s*with\s*delivery|ghar\s*tak\s*kitne|shipping\s*ke\s*sath|kul\s*kitna|overall\s*price|kitna\s*padega|yeh\s*kitne\s*ka\s*padega|final\s*kitna|all\s*inclusive\s*kitna)\b/i.test(text)
    );

    if (isTotalQuery) {
      return {
        family: IntentFamily.TOTAL_COST_INQUIRY,
        intent: 'ORDER_TOTAL', // Matches existing backward-compatible intent name
        confidence: 0.95
      };
    }

    // 9. General Delivery Charges & Shipping Inquiry (Semantic Match for "dc?", "delivery charges", "shipping kitni", etc.)
    const isDeliveryQuery = Boolean(
      (normalization.ellipticalType === 'DELIVERY_QUERY' && normalization.ellipticalType !== 'TOTAL_QUERY') ||
      /\b(delivery\s*charges?|shipping\s*charges?|deliv[er]*y\s*charges?|delivry\s*charges?|delivery\s*kitni|shipping\s*kitni|delivery\s*cost|ghar\s*tak\s*(?:delivery|kitna\s*lagega)|delivery\s*included|delivery\s*free|delivery\s*ke\s*kitne|delivery\s*ka\s*kya\s*scene|iske\s*saath\s*shipping|dispatch\s*charges|dc\?|dc\b)\b/i.test(text) ||
      (/\b(delivery|shipping)\b/i.test(text) && /\b(charges|kitni|kitna|cost|scene|fee|lagega|batao|btao|btadein|info|details|kya\s*h[ya]i?)\b/i.test(text) && !/\b(mila\s*k[ae]?)\b/i.test(text))
    );

    if (isDeliveryQuery && !/\b(total|kul|overall|final|all\s*inclusive|bill)\b/i.test(text) && !/\b(kab|ayega|deliver\s*hoga|pohanchega|hogi)\b/i.test(text)) {
      return {
        family: IntentFamily.DELIVERY_INQUIRY,
        intent: 'ORDER_DELIVERY_CHARGES', // Matches existing backward-compatible intent name
        confidence: 0.95
      };
    }

    // 10. Store / Website Link
    if (
      /\b(website\s*(ka\s*)?(link|url|bhejo)?|store\s*(ka\s*)?(link|url|bhejo)|online\s*store)\b/i.test(clean) &&
      !/\b(product|item|iska|iski)\b/i.test(clean)
    ) {
      return { family: IntentFamily.STORE_INFO, intent: 'STORE_LINK', confidence: 0.96 };
    }

    // 11. Product Link Request ("link?", "url?", "link bhejo")
    const isLinkQuery = Boolean(
      normalization.ellipticalType === 'LINK_QUERY' ||
      /\b(link\s*(do|dein|bhejo|bhej|send\s*k[ar]o)|(?:product|item|page|direct)\s*(?:ka\s*)?link|(?:iska|product)\s*url|url\s*(bhejo|send\s*k[ar]o|do)|product\s*page|mujhe\s*(?:iska\s*)?link\s*chahiye|where\s*can\s*i\s*see\s*this|link\?|link|url)\b/i.test(clean)
    );

    if (isLinkQuery && !/\b(website|store\s*ka\s*link|online\s*store|iska\s*link|iski\s*link)\b/i.test(clean)) {
      return { family: IntentFamily.PRODUCT_LINK, intent: 'PRODUCT_LINK', confidence: 0.96 };
    }

    // 12. Order Status & Tracking Queries
    if (
      /\b((?:order|parcel|package)\s*(?:ka|ki|ke)?\s*(?:status|tracking|(?:kahan|kidhar)\s*(?:poh[ae]?n?ch\w*|pahn?ch\w*|tak))|status\s*kya\s*hai|status\s*(?:batao|btao|chahiye|required)|tracking\s*batao|parcel\s*ka\s*status|order\s*confirm\s*hua|cancel\s*hua)\b/i.test(clean) ||
      /\b(?:order|parcel)\s*(?:kahan|kidhar)\s*poh[ae]?n?ch/i.test(clean) ||
      (/\border\b/i.test(clean) && /\bstatus\b/i.test(clean))
    ) {
      return { family: IntentFamily.ORDER_STATUS, intent: 'ORDER_STATUS', confidence: 0.98 };
    }

    // 13. Order Summary / Lookup by Details
    if (
      /\b(directory|directory\s*mein|directory\s*main|details?\s*se|name\s*se|naam\s*se|address\s*se|number\s*se|phone\s*se|details?\s*check|mere\s*details|meri\s*details|mere\s*number\s*se|meri\s*details\s*se)\b/i.test(clean) ||
      (/\b(check\s*karo|check\s*karein|dhoondo|dhundo|search\s*karo)\b/i.test(clean) && /\b(order|parcel|booking|details|record|directory|number)\b/i.test(clean))
    ) {
      return { family: IntentFamily.ORDER_LOOKUP, intent: 'ORDER_LOOKUP_BY_DETAILS', confidence: 0.98 };
    }

    if (
      !/\b(confirm|cnfrm|confrim|cancel|cancle|dispatch)\b/i.test(clean) && (
        /\b(last\s*order|latest\s*order|recent\s*order|last\s*wala\s*order|jo\s*(tumhare\s*pas\s*)?last\s*order|mera\s*last\s*order|last\s*order\s*ka\s*number|latest\s*booking|meri\s*latest\s*booking|jo\s*last\s*order\s*aya)\b/i.test(clean) ||
        /\b(mera\s*order\s*kya\s*hai|kya\s*order\s*hai|order\s*details|kya\s*order\s*kiya|kya\s*mangwaya|mera\s*order|mere\s*kitne\s*orders)\b/i.test(clean) ||
        /\b(mera\s*par[sc][ae]l\s*(kidr|kahan|kab)?|par[sc][ae]l\s*kab\s*ayega|order\s*kab\s*(ayega|milega)|(par[sc][ae]l|order)\s*kab\s*(ayega|milega|deliver|pohanchega)|kab\s*deliver\s*hoga|delivery\s*kab\s*(hogi|ho\s*gi)|order\s*kidr\s*hai|order\s*kahan\s*hai|yeh?\s*kab\s*(?:tak\s*)?poh[ae]?n?ch\w*|ye\s*kab\s*ayega)\b/i.test(clean) ||
        /\b(kal\s*wala\s*order|jo\s*order\s*mene\s*kal\s*kiya|kal\s*(?:aik\s*|ek\s*)?order\s*kiya|mene\s*kal\s*.*order\s*kiya|order\s*kiya\s*tha|order\s*number\s*yad\s*nahi|order\s*no\s*yaad\s*nahi)\b/i.test(clean)
      )
    ) {
      return { family: IntentFamily.ORDER_SUMMARY, intent: 'ORDER_SUMMARY', confidence: 0.96 };
    }

    // 14. Single Product Price / Detail Inquiry ("adhesive wall max ki price", "ye kitne ka hai?", "details")
    const isPriceDetailQuery = Boolean(
      normalization.ellipticalType === 'PRICE_QUERY' ||
      (!/\b(order|parcel|booking|check\s*karo|se\s*check|check\s*karein|meri\s*details|mere\s*details|mere\s*number)\b/i.test(clean) && (
        /\b(price|rate|cost|prize|details|detail)\b/i.test(clean) ||
        /\b(ki\s*price|ka\s*rate|kitn(?:ay|ey|e|y|a|i)\s*ka\s*(?:h[ya]i?|he|hai|par(?:ay|ey|e|a)\s*ga|padega|parega)?|price\s*batao|rate\s*batao|ye\s*kitny\s*ka|details\s*batao|detail\s*batao)\b/i.test(clean) ||
        /\b(?:ye|yeh)?\s*kitn(?:ay|ey|e|y|a|i)\s*ka\s*(?:par(?:ay|ey|e|a)\s*ga|padega|parega|h[ya]i?)\b/i.test(clean) ||
        clean === 'price' || clean === 'price?' || clean === 'details'
      ))
    );

    if (isPriceDetailQuery) {
      return { family: IntentFamily.PRODUCT_DETAIL, intent: 'PRODUCT_DETAIL', confidence: 0.93 };
    }

    // 15. Rejections / Dismissals
    const isRejection =
      /\b(nahi|nahin|nhi|nai|no)\s*(chahiye|chahiyeh|chaiye|chahye|chahiay|lena|leni|lene|lunga|lungi|pasand)\b/i.test(clean) ||
      /\b(rehne?\s*(do|dein|de)|reh\s*ne\s*do|rahne\s*do|chh?oro|chh?or\s*do|chodo|chhod\s*do|skip|no\s*thanks?|not\s*interested|don'?t\s*want|dont\s*want|no\s*need)\b/i.test(clean) ||
      /\b(zarurat|zaroorat|zarorat)\s*(nahi|nhi|nahin)\b/i.test(clean) ||
      clean === 'nahi' || clean === 'nahin' || clean === 'nhi' || clean === 'no';

    if (isRejection) {
      const hasOrderActive = Boolean(state.activeOrderNumber || state.activeOrderId || state.recentTopic === 'order');
      const mentionsNewProduct = /\b(product|item|cover|belt|shoes|kursi|chair|snoring|dilator|kitchen)\b/i.test(clean);
      if (hasOrderActive && !mentionsNewProduct) {
        return { family: IntentFamily.CANCEL, intent: 'CANCEL', confidence: 0.96 };
      }
      return { family: IntentFamily.PRODUCT_REJECTION, intent: 'PRODUCT_REJECTION', confidence: 0.94 };
    }

    // 16. Explicit Order Cancellation
    if (/\b(cancel\s*(kar|kardo|karein|karna|dein)?|cancle|cancil|cancl|radd)\b/i.test(clean)) {
      const isOrderExplicit = /\b(order|parcel|booking|mera\s*order|order\s*#?\d*)\b/i.test(clean);
      return { family: IntentFamily.CANCEL, intent: 'CANCEL', isOrderCancel: isOrderExplicit, confidence: 0.96 };
    }

    // 17. Purchase Intent vs Existing Order Confirmation
    if (
      /\b(order\s*kar\s*(do|dein|kardo)|book\s*kar\s*(do|dein|kardo)|ye\s*order\s*kar\s*(do|dein)|ye\s*lena\s*hai|yeh\s*lena\s*hai|order\s*karna\s*hai|mujhe\s*ye\s*chahiye|lena\s*hai|product\s*confirm\s*(kro|karo|krdo|kardo)|.*wala\s*order\s*kar\s*(do|dein|kardo))\b/i.test(clean)
    ) {
      return { family: IntentFamily.PURCHASE_INTENT, intent: 'PURCHASE_INTENT', confidence: 0.94 };
    }

    // 18. Confirmation of Existing Order or selected item
    if (
      /\b(please\s*)?(mera\s*)?order\s*(confirm|cnfrm)\s*(k[ar]o|krdo|kardo|dein|kar\s*(?:do|dein))?\b/i.test(clean) ||
      /\b(confirm\s*(?:my\s*)?order|order\s*confirm|booking\s*confirm|cnfrm\s*krdo|confirm\s*kardo|confirm\s*kar\s*(?:do|dein|dijie)|confirm\s*kar\s*dein|haan\s*yehi|haan\s*ye|ji\s*yehi|ye\s*wala\s*confirm)\b/i.test(clean) ||
      /\b(dispatch\s*(?:kar\s*)?(?:do|dein)|(?:haan\s*)?bhej(?:o)?\s*(?:do|dein))\b/i.test(clean) ||
      clean === 'confirm kar dein' || clean === 'confirm kar do' || clean === 'confirm' || clean === 'haan' || clean === 'ji' || clean === 'haan bhej do'
    ) {
      return { family: IntentFamily.CONFIRM, intent: 'CONFIRM', confidence: 0.94 };
    }

    // 19. Catalog & Collection Inquiries
    if (/\b(collection|collections|kitchen\s*(ke\s*)?products?|mobile\s*accessories|women\s*collection|cleaning\s*(ke\s*)?products?|cleaning\s*collection)\b/i.test(clean)) {
      return { family: IntentFamily.COLLECTION, intent: 'COLLECTION', confidence: 0.90 };
    }
    if (/\b(aur\s*dikhao|aur\s*products?|next|mazeed|more)\b/i.test(clean) || clean === 'aur dikhao' || clean === 'next' || clean === 'more') {
      return { family: IntentFamily.CATALOG, intent: 'MORE', confidence: 0.95 };
    }
    if (/\b(catalog\s*dikhao|catalog\s*bhejo|products\s*dikhao|sari\s*items|tamam\s*products|kya\s*kya\s*hai|list\s*bhejo|sab\s*products|aur\s*kya\s*hai)\b/i.test(clean)) {
      return { family: IntentFamily.CATALOG, intent: 'CATALOG', confidence: 0.92 };
    }

    // 20. Social Chitchat & Acks
    if (/\b(acha|achha|theek\s*hai|theek|sahi\s*hai|ok|okay)\b/i.test(clean) && clean.length < 15) {
      return { family: IntentFamily.SOCIAL_ACK, intent: 'SOCIAL_ACK', confidence: 0.94 };
    }
    if (/\b(dosti\s*karogi|friendship|friends|dost\s*ban\s*sakte|dosti)\b/i.test(clean)) {
      return { family: IntentFamily.SOCIAL_FRIENDSHIP, intent: 'SOCIAL_FRIENDSHIP', confidence: 0.95 };
    }
    if (/\b(allah\s*hafiz|khuda\s*hafiz|bye|goodbye)\b/i.test(clean)) {
      return { family: IntentFamily.SOCIAL_CLOSING, intent: 'SOCIAL_CLOSING', confidence: 0.95 };
    }
    if (/\b(thank\s*you|thanks|shukriya|meherbani)\b/i.test(clean)) {
      return { family: IntentFamily.SOCIAL_THANKYOU, intent: 'SOCIAL_THANKYOU', confidence: 0.95 };
    }
    if (/\b(neend\s*nahi|neend\s*nhi|girlfriend|kaisi\s*ho|kese\s*ho|kya\s*haal|upset\s*h[uo]n?|udas\s*h[uo]n?|sad\s*h[uo]n?|pareshan\s*h[uo]n?|mood\s*kharab)\b/i.test(clean)) {
      return { family: IntentFamily.SOCIAL_CASUAL, intent: 'SOCIAL_CASUAL', confidence: 0.95 };
    }
    if (/\b(hello|hi|hey|assalam\s*o\s*alaikum|salam)\b/i.test(clean) && !/\b(order|price|link|cancel|confirm)\b/i.test(clean)) {
      return { family: IntentFamily.SOCIAL_CASUAL, intent: 'GENERAL_QUERY', confidence: 0.90 };
    }

    // 21. Product Discovery / Inquiry (Must contain product category or product action)
    if (
      /\b(product|item|cover|belt|shoes|shirt|suit|wall\s*max|chair|kursi|snoring|dilator|kharat[eo]n?|kharate|silicone|protection|brush|bottle|bottal|mat|cleaner|cleaning|lunch\s*box|cutter|chopper|mop|dispenser|stand|holder|light|fan|watch)\b/i.test(clean) ||
      (/\b(dikhao|dikha\s*do|dikha\s*dein|dikhana|dikha\s*bhejo|show\s*me|mujhe\s*.*chahiye)\b/i.test(clean) && !/\b(order|parcel|booking|status|cancel|confirm)\b/i.test(clean))
    ) {
      return { family: IntentFamily.PRODUCT_INQUIRY, intent: 'PRODUCT_INQUIRY', confidence: 0.90 };
    }

    // 22. Genuinely Ambiguous or General Query
    if (entityResolution.isAmbiguous) {
      return { family: IntentFamily.CLARIFICATION_NEEDED, intent: 'CLARIFICATION_NEEDED', confidence: 0.95 };
    }

    return { family: IntentFamily.UNKNOWN, intent: 'GENERAL_QUERY', confidence: 0.60 };
  }
}

/**
 * Tier 4: Master Conversation Brain
 * Orchestrates message understanding, discourse tracking, response contracts,
 * and relevance guards for Zara.
 */
export class ConversationBrain {
  /**
   * Complete conversational turn analysis
   *
   * @param {object} params
   * @param {string} params.messageText
   * @param {object} params.state
   * @param {object} params.customer
   * @param {Array} params.orders
   * @param {Array} params.catalogProducts
   * @returns {object}
   */
  static analyzeTurn({ messageText = '', state = {}, customer = null, orders = [], catalogProducts = [] } = {}) {
    // 1. Normalize
    const normalization = MessageNormalizer.normalize(messageText);

    // 2. Discourse analysis (topic shift vs continuation)
    const discourse = SemanticContextResolver.evaluateDiscourse(normalization, state, { orders, catalogProducts });

    // 3. Semantic entity resolution
    const entityResolution = SemanticContextResolver.resolveEntity(normalization, state, discourse, { orders, catalogProducts });

    // 4. Intent understanding
    const intent = IntentEngine.inferIntent(normalization, discourse, entityResolution, state);

    // 5. Establish Response Generation Contract
    const contract = this.buildResponseContract({
      normalization,
      discourse,
      entityResolution,
      intent,
      state,
      customer
    });

    return {
      normalization,
      discourse,
      entityResolution,
      intent,
      contract
    };
  }

  /**
   * Internal Response Generation Contract
   * Establishes the 8-point internal contract before generating any outbound message.
   */
  static buildResponseContract(params = {}) {
    const normalization = params.normalization || params.normalizedMessage || {};
    const discourse = params.discourse || params.discourseContext || {};
    const entityResolution = params.entityResolution || {};
    const intent = params.intent || {};
    const state = params.state || {};
    const customer = params.customer || null;

    const activeProd = entityResolution.entityType === ActiveEntityType.PRODUCT ? entityResolution.entity : state.activeProduct;
    const activeOrd = entityResolution.entityType === ActiveEntityType.ORDER ? entityResolution.entity : state.activeOrder;

    const knownInfo = {};
    if (activeProd) {
      knownInfo.productId = activeProd.id;
      knownInfo.productTitle = activeProd.title;
      knownInfo.productPrice = activeProd.numericPrice || activeProd.price;
      knownInfo.deliveryCharge = activeProd.deliveryCharge || 199;
      knownInfo.productUrl = activeProd.url;
    }
    if (activeOrd) {
      knownInfo.orderNumber = activeOrd.orderNumber;
      knownInfo.orderStatus = activeOrd.status;
      knownInfo.totalAmount = activeOrd.totalAmount;
      knownInfo.items = activeOrd.items;
    }
    if (customer) {
      knownInfo.customerName = customer.firstName;
      knownInfo.customerPhone = customer.phone;
      knownInfo.customerCity = customer.city;
    }

    const missingInfo = [];
    if (intent.family === IntentFamily.CHECKOUT && !knownInfo.customerAddress) {
      missingInfo.push('customerAddress');
    }
    if (intent.family === IntentFamily.ORDER_STATUS && !knownInfo.orderNumber) {
      missingInfo.push('orderNumber');
    }

    const isAmb = Boolean(entityResolution.isAmbiguous || entityResolution.ambiguous);
    const action = isAmb ? 'CLARIFY_AMBIGUITY' : intent.family;

    return {
      userMessage: normalization.cleanMessage || normalization.raw || '',
      context: discourse.topic,
      activeEntity: entityResolution.entityType,
      intent: intent.intent,
      intentFamily: intent.family,
      knownInformation: knownInfo,
      missingInformation: missingInfo,
      isAmbiguous: isAmb,
      ambiguous: isAmb,
      clarificationPrompt: entityResolution.clarificationPrompt || null,
      action,
      actionRequired: action
    };
  }

  /**
   * Response Relevance Guard
   * Validates that the generated response answers the user's inquiry, respects active context,
   * prevents empty fallbacks, and respects modality constraints.
   */
  static guardResponse({ proposedReply, analysis, isVoice = false }) {
    let reply = String(proposedReply || '').trim();
    const issues = [];
    let repaired = false;

    // Guard 1: Prohibit vacuous non-answers when an active entity and query are present
    if (
      reply.includes('main samajh gayi hoon') &&
      (reply.includes('mazeed details') || reply.length < 40)
    ) {
      const activeProd = analysis.entityResolution.entity || analysis.contract.knownInformation.productTitle;
      if (analysis.intent.family === IntentFamily.DELIVERY_INQUIRY) {
        issues.push('Replaced generic acknowledgment with grounded delivery response');
        const prodName = activeProd?.title || 'product';
        const fee = activeProd?.deliveryCharge || 199;
        reply = `Ji, *${prodName}* ke delivery charges Rs. ${fee} hain (tamam Pakistan mein 3–5 working days).`;
        repaired = true;
      } else if (analysis.intent.family === IntentFamily.TOTAL_COST_INQUIRY) {
        issues.push('Replaced generic acknowledgment with grounded total cost response');
        const price = Number(activeProd?.numericPrice || 499);
        const fee = Number(activeProd?.deliveryCharge || 199);
        const total = price + fee;
        reply = `Ji, *${activeProd?.title || 'product'}* ki price Rs. ${price} aur delivery Rs. ${fee} mila kar kul total Rs. ${total} banta hai.`;
        repaired = true;
      }
    }

    // Guard 2: Ambiguity handling — use the clarification prompt
    if (analysis.entityResolution.isAmbiguous && analysis.entityResolution.clarificationPrompt) {
      reply = analysis.entityResolution.clarificationPrompt;
      repaired = true;
    }

    // Guard 3: Voice Quality — Strip URLs in voice output
    if (isVoice) {
      if (/https?:\/\/\S+/i.test(reply) || /🔗/u.test(reply)) {
        issues.push('Stripped URL from spoken voice response');
        reply = reply
          .replace(/🔗\s*https?:\/\/\S+/gi, '')
          .replace(/https?:\/\/\S+/gi, '')
          .replace(/Product dekhne ke liye:\s*/gi, '')
          .trim();
        repaired = true;
      }
    }

    return {
      isValid: true,
      replyText: reply,
      repaired,
      issues
    };
  }
}

export default ConversationBrain;
