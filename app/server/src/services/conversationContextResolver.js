import { ConversationStateService } from './conversationStateService.js';
import { ProductSummaryService } from './productSummaryService.js';
import { DeliveryService } from './deliveryService.js';

export const ActiveTopic = {
  PRODUCT: 'PRODUCT',
  ORDER: 'ORDER',
  CHECKOUT: 'CHECKOUT',
  SUPPORT: 'SUPPORT',
  GENERAL: 'GENERAL',
  UNKNOWN: 'UNKNOWN'
};

export const ResolvedEntityType = {
  PRODUCT: 'PRODUCT',
  ORDER: 'ORDER',
  CUSTOMER: 'CUSTOMER',
  NONE: 'NONE'
};

/**
 * Deterministic Conversation Context & Reference Resolver for Dial Mate 2.0 / Zara
 */
export class ConversationContextResolver {
  /**
   * Resolves reference pronouns ("iski", "iska", "yeh", "ye wala", "kal wala", etc.)
   *
   * @param {string} text - Customer's message
   * @param {object} state - Persistent conversation state
   * @param {object} options - { products: [], orders: [] }
   * @returns {{ entityType: string, entity: object|null, isAmbiguous: boolean, candidates: object[], clarificationPrompt?: string }}
   */
  static resolveReference(text = '', state = {}, options = {}) {
    const clean = String(text || '').toLowerCase().trim();
    const activeProd = state.activeProduct || null;
    const activeOrd = state.activeOrder || null;
    const recentProds = state.recentProducts || (state.lastProducts || []);
    const recentOrds = state.recentOrders || options.orders || [];

    // 1. Explicit Order References ("order #1643", "order 1643", "kal wala order", "chair wala order")
    const orderNumMatch = clean.match(/#?(\d{3,7})/);
    if (orderNumMatch && /\border|parcel|booking\b/i.test(clean)) {
      const num = orderNumMatch[1];
      const matchOrd = recentOrds.find(o => String(o.orderNumber || o.id) === num);
      if (matchOrd) {
        return { entityType: ResolvedEntityType.ORDER, entity: matchOrd, isAmbiguous: false, candidates: [matchOrd] };
      }
    }

    // 2. Specific named references in order context ("chair wala order", "anti snoring wala order")
    if (/\border|parcel\b/i.test(clean) && (clean.includes('chair') || clean.includes('snoring') || clean.includes('kal'))) {
      const filteredOrds = recentOrds.filter(o => {
        const itemStr = String(o.items || '').toLowerCase();
        if (clean.includes('chair') && itemStr.includes('chair')) return true;
        if (clean.includes('snoring') && itemStr.includes('snoring')) return true;
        return false;
      });

      if (filteredOrds.length === 1) {
        return { entityType: ResolvedEntityType.ORDER, entity: filteredOrds[0], isAmbiguous: false, candidates: filteredOrds };
      }
      if (filteredOrds.length > 1) {
        const choices = filteredOrds.map(o => `#${o.orderNumber}`).join(' aur ');
        return {
          entityType: ResolvedEntityType.ORDER,
          entity: null,
          isAmbiguous: true,
          candidates: filteredOrds,
          clarificationPrompt: `Ji, aapke is product ke multiple orders mil rahe hain: ${choices}. Aap kis order ki baat kar rahay hain?`
        };
      }
    }

    // 3. Pronouns for Orders ("iska status?", "yeh kab ayega?", "mera order")
    const isOrderPronoun = /\b(status|kahan\s*pohch|kab\s*ayega|dispatch|deliver)\b/i.test(clean);
    if (isOrderPronoun) {
      if (activeOrd) {
        return { entityType: ResolvedEntityType.ORDER, entity: activeOrd, isAmbiguous: false, candidates: [activeOrd] };
      }
      if (recentOrds.length === 1) {
        return { entityType: ResolvedEntityType.ORDER, entity: recentOrds[0], isAmbiguous: false, candidates: recentOrds };
      }
      if (recentOrds.length > 1) {
        return {
          entityType: ResolvedEntityType.ORDER,
          entity: null,
          isAmbiguous: true,
          candidates: recentOrds,
          clarificationPrompt: `Aapke ${recentOrds.length} orders record mein hain. Baraye meharbani batayein kis order ka status check karna hai?`
        };
      }
    }

    // 4. Ordinal References ("pehle wala", "doosre wala", "1st", "2nd")
    if (/\b(pehle|pehla|1st|first)\b/i.test(clean) && !/\border\b/i.test(clean)) {
      if (recentProds[0]) {
        return { entityType: ResolvedEntityType.PRODUCT, entity: recentProds[0], isAmbiguous: false, candidates: [recentProds[0]] };
      }
    }
    if (/\b(doosre|doosra|dusra|dusre|2nd|second)\b/i.test(clean) && !/\border\b/i.test(clean)) {
      if (recentProds[1]) {
        return { entityType: ResolvedEntityType.PRODUCT, entity: recentProds[1], isAmbiguous: false, candidates: [recentProds[1]] };
      }
    }

    // 5. Product Pronouns ("iski price", "iska rate", "iska link", "iska total", "iski delivery", "ye kitne ka hai", "ye wala")
    const isProductPronoun = /\b(iski|iska|is\s*ki|is\s*ka|iss\s*ki|iss\s*ka|ye\s*wala|yeh\s*wala|ye|yeh|this|that|item|product|uska|uski|us\s*ka|us\s*ki|woh\s*wala|wo\s*wala|wo|woh)\b/i.test(clean);
    if (isProductPronoun && !/\border\b/i.test(clean)) {
      if (activeProd && !ConversationStateService.isRejected(state, activeProd)) {
        return { entityType: ResolvedEntityType.PRODUCT, entity: activeProd, isAmbiguous: false, candidates: [activeProd] };
      }
      const validRecent = recentProds.filter(p => !ConversationStateService.isRejected(state, p));
      if (validRecent.length === 1) {
        return { entityType: ResolvedEntityType.PRODUCT, entity: validRecent[0], isAmbiguous: false, candidates: validRecent };
      }
      if (validRecent.length > 1) {
        const names = validRecent.slice(0, 2).map(p => ProductSummaryService.normalizeProductName(p.title).customerFriendlyName);
        return {
          entityType: ResolvedEntityType.PRODUCT,
          entity: null,
          isAmbiguous: true,
          candidates: validRecent,
          clarificationPrompt: `Ji, aap ${names[0]} ki baat kar rahay hain ya ${names[1]} ki?`
        };
      }
    }

    // 6. Default to activeProduct if available and relevant
    if (activeProd && !ConversationStateService.isRejected(state, activeProd)) {
      return { entityType: ResolvedEntityType.PRODUCT, entity: activeProd, isAmbiguous: false, candidates: [activeProd] };
    }

    if (activeOrd) {
      return { entityType: ResolvedEntityType.ORDER, entity: activeOrd, isAmbiguous: false, candidates: [activeOrd] };
    }

    return { entityType: ResolvedEntityType.NONE, entity: null, isAmbiguous: false, candidates: [] };
  }

  /**
   * Builds canonical, rich Conversation Context Object
   */
  static buildContextObject(state = {}, resolvedEntity = null, customer = null) {
    const activeProd = state.activeProduct || null;
    const activeOrd = state.activeOrder || null;

    let activeTopic = ActiveTopic.UNKNOWN;
    if (state.checkoutState && state.checkoutState.step !== 'IDLE') {
      activeTopic = ActiveTopic.CHECKOUT;
    } else if (state.recentTopic === 'order' || state.activeOrderNumber) {
      activeTopic = ActiveTopic.ORDER;
    } else if (state.recentTopic === 'product' || activeProd) {
      activeTopic = ActiveTopic.PRODUCT;
    }

    return {
      activeTopic,
      activeProduct: activeProd ? {
        id: activeProd.id,
        title: activeProd.title,
        canonicalTitle: ProductSummaryService.normalizeProductName(activeProd.title).canonicalShopifyTitle,
        friendlyName: ProductSummaryService.normalizeProductName(activeProd.title).customerFriendlyName,
        url: activeProd.url,
        price: activeProd.numericPrice || activeProd.price,
        formattedPrice: activeProd.formattedPrice || `Rs. ${activeProd.numericPrice}`,
        numericPrice: Number(activeProd.numericPrice || 0),
        deliveryCharge: state.activeDeliveryCharge || 199,
        total: state.activeProductTotal || (Number(activeProd.numericPrice || 0) + (state.activeDeliveryCharge || 199)),
        available: activeProd.available !== false
      } : null,
      activeOrder: activeOrd ? {
        id: activeOrd.id || activeOrd.orderId,
        orderNumber: String(activeOrd.orderNumber).replace(/^#/, ''),
        status: activeOrd.status || 'Pending Confirmation',
        items: activeOrd.items,
        total: activeOrd.totalAmount,
        shippingFee: activeOrd.shippingFee || 199,
        shippingAddress: activeOrd.shippingAddress,
        customerName: activeOrd.customerName
      } : null,
      customer: {
        name: customer?.firstName || state.customerName || null,
        phone: customer?.phone || state.customerPhone || null,
        city: customer?.city || state.customerCity || null,
        address: customer?.address || state.customerAddress || null
      },
      checkoutState: state.checkoutState || null,
      pendingAction: state.pendingAction || null,
      lastResolvedEntity: resolvedEntity?.entityType || ResolvedEntityType.NONE,
      lastIntent: state.activeIntent || null,
      recentProducts: state.recentProducts || [],
      recentOrders: state.recentOrders || [],
      rejectedProducts: state.rejectedProducts || [],
      recentTurns: state.recentTurns || []
    };
  }
}

export default ConversationContextResolver;
