import { prisma } from '../lib/db.js';
import { getAIClient } from '../integrations/ai/client.js';
import { ToolDispatcher } from '../integrations/ai/dispatcher.js';
import { AITools } from '../integrations/ai/tools.js';
import { WhatsAppClient } from '../integrations/whatsapp/client.js';
import { OrderEligibilityService } from './orderEligibilityService.js';
import { PhoneNormalizer } from './phoneNormalizer.js';
import { ShopifyCatalogService } from './shopifyCatalogService.js';
import { ConversationStateService } from './conversationStateService.js';
import { DeliveryService } from './deliveryService.js';
import { HumanEscalationService } from './humanEscalationService.js';
import { TextToSpeechService } from './textToSpeechService.js';
import { ProductSummaryService } from './productSummaryService.js';
import { SpokenResponsePlanner } from './spokenResponsePlanner.js';
import { OrderResolver } from './orderResolver.js';
import { ConversationContextResolver, ResolvedEntityType } from './conversationContextResolver.js';
import { CheckoutStateMachine, CheckoutStep } from './checkoutStateMachine.js';
import { IntentResolver } from './intentResolver.js';
import { ResponsePlanner } from './responsePlanner.js';
import { ResponseQualityControlService } from './responseQualityControlService.js';

/**
 * WhatsApp AI Customer Agent Service ("Zara 2.0")
 *
 * Production Architecture:
 * 1. Persona: "Zara" — Courteous, professional Roman Urdu / English support assistant.
 * 2. Multi-Tenant Scoped: Strict isolation by shopId & shopDomain.
 * 3. Canonical Phone & Identity: Multi-variant matching across +92, 92, 03, dashes/spaces.
 * 4. Grounded Order Resolution: Exact order number matching only (no substring, no nearest order fallback).
 * 5. Deterministic Checkout State Machine: Product -> Details -> Address -> Review -> Explicit Confirmation.
 * 6. Pronoun & Reference Grounding: "iski", "iska", "ye", "wo" resolve to active entity before any catalog search.
 * 7. Unified Voice & Text Pipeline: Identical reasoning engine, with modality-aware spoken response planner.
 */
export class WhatsAppAgentService {
  /**
   * Sanitizes customer-facing text to guarantee zero NaN, undefined, or null leaks
   */
  static sanitizeResponse(text) {
    if (!text) return '';
    let clean = String(text);
    clean = clean.replace(/^(?:Customer|User|Aap|Customer Message):\s*.*?(?:\n|$)/gim, '');
    clean = clean.replace(/Rs\.\s*NaN/gi, 'Price on request');
    clean = clean.replace(/\bNaN\b/g, '0');
    clean = clean.replace(/\bundefined\b/g, '');
    clean = clean.replace(/\bnull\b/g, '');
    clean = clean.replace(/\[object Object\]/g, '');

    const lines = clean.split('\n');
    const seenLines = new Set();
    const uniqueLines = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') {
        uniqueLines.push('');
      } else if (!seenLines.has(trimmed) || trimmed.startsWith('•') || trimmed.startsWith('-') || /^\d+\./.test(trimmed)) {
        seenLines.add(trimmed);
        uniqueLines.push(line);
      }
    }
    return uniqueLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /**
   * Checks whether an action (confirm/cancel) is negated
   */
  static isNegated(text, action) {
    return IntentResolver.isNegated(text, action);
  }

  /**
   * Detects whether message explicitly inquires about product stock/availability
   */
  static isAvailabilityInquiry(text) {
    if (!text) return false;
    const clean = String(text).toLowerCase().trim();
    if (/\b(dikhao|price|details|link)\b/i.test(clean)) return false;
    return /\b(stock\s*hai|available\s*hai|mil\s*jayega|mil\s*sakega|stock\s*mein\s*hai|available|stock|in\s*stock|availble)\b/i.test(clean);
  }

  /**
   * Checks whether message explicitly refers to an order
   */
  static hasExplicitOrderReference(text) {
    if (!text) return false;
    const clean = String(text).toLowerCase().trim();
    return (
      /\b(order|parcel|booking|tracking|shipment|delivery\s*status)\b/i.test(clean) ||
      /\b#\d{3,7}\b/.test(clean) ||
      /\b\d{4,6}\b/.test(clean) ||
      /\b(mera\s*order|last\s*order|pehle\s*wala\s*order|order\s*number|order\s*details|kal\s*wala\s*order)\b/i.test(clean)
    );
  }

  /**
   * Looks up a specific order strictly by exact normalized order number
   */
  static async resolveOrderByPhone(shopId, fromPhone) {
    const orders = await PhoneNormalizer.resolveOrders(shopId, null, fromPhone);
    return orders[0] || null;
  }

    static async resolveOrderByNumber(shopId, orderNumber) {
    return OrderResolver.resolveExactOrderNumber(shopId, orderNumber);
  }

  /**
   * Checks whether message contains a product pronoun or reference
   */
  static hasProductPronounOrReference(text) {
    const clean = String(text || '').toLowerCase().trim();
    return /\b(iski|iska|is\s*ki|is\s*ka|iss\s*ki|iss\s*ka|ye|yeh|this|that|item|product|cover|belt|shoes|kursi|chair|wall\s*max|dilator|snoring)\b/i.test(clean);
  }

  /**
   * Detects customer intent from message text with Pakistani language engine
   */
  static detectIntent(text, context = {}) {
    return IntentResolver.resolveIntent(text, context);
  }

  /**
   * Main entry point to process incoming WhatsApp messages (Text and Voice)
   */
  static async handleIncomingMessage(params) {
    const startTime = Date.now();
    const {
      shopId,
      shopDomain,
      sessionId,
      messageId = null,
      isVoiceInbound = false
    } = params;

    let { fromPhone, messageText } = params;

    if (!fromPhone) {
      throw new Error('fromPhone (customer JID) is required');
    }
    if (!messageText || String(messageText).trim() === '') {
      return { success: true, replyText: '', action: 'ignored_empty', isVoiceResponse: false };
    }

    messageText = String(messageText).trim();

    // 1. Resolve Tenant Context
    let shop = null;
    if (shopId) {
      shop = await prisma.shop.findUnique({ where: { id: shopId } });
    }
    if (!shop && shopDomain) {
      shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });
    }
    if (!shop) {
      throw new Error(`Shop not found for id: ${shopId || 'N/A'}, domain: ${shopDomain || 'N/A'}`);
    }

    const cleanPhone = PhoneNormalizer.normalize(fromPhone)?.e164 || fromPhone.replace(/[^0-9]/g, '');

    // 2. WhatsApp Client Initialization
    const waClient = new WhatsAppClient({
      baseUrl: process.env.WA_AKG_BASE_URL,
      apiKey: process.env.WA_AKG_API_KEY,
      sessionId: String(sessionId),
      shopId: shop.id
    });

    if (typeof waClient?.sendPresence === 'function') {
      try {
        await waClient.sendPresence(fromPhone, isVoiceInbound ? 'recording' : 'composing');
      } catch (_) {}
    }

    // 3. Customer Identity Mapping
    const customer = await PhoneNormalizer.resolveCustomer(shop.id, fromPhone);

    // 4. Conversation Thread Management
    let conversation = await prisma.conversation.findFirst({
      where: {
        shopId: shop.id,
        customerId: customer?.id || undefined,
        channel: 'WHATSAPP',
        status: 'ACTIVE'
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 8
        }
      }
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          shopId: shop.id,
          customerId: customer?.id || null,
          channel: 'WHATSAPP',
          status: 'ACTIVE'
        },
        include: { messages: true }
      });
    }

    // Canonical Key across Text, Voice, Image & Sessions
    const conversationKey = `${shop.id}:${cleanPhone}`;
    ConversationStateService.registerAlias(conversation.id, conversationKey);

    // 5. Human Takeover Check
    if (conversation.isTakeover) {
      console.log(`👤 [WhatsAppAgent] Human takeover active for Conversation ${conversation.id}. AI agent will not respond.`);
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          sender: 'customer',
          text: messageText
        }
      }).catch(() => {});
      return {
        success: true,
        handledByHuman: true,
        isTakeover: true,
        conversationId: conversation.id,
        replyText: undefined,
        action: 'suppressed_takeover',
        isVoiceResponse: false
      };
    }

    // 6. Record Inbound Message
    if (messageId) {
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          sender: 'customer',
          text: messageText
        }
      }).catch(() => {});
    }

    // 7. Resolve Customer Orders & Persistent Conversation State
    const orders = await PhoneNormalizer.resolveOrders(shop.id, customer?.id, fromPhone);
    const recentOrder = orders[0] || null;

    const state = await ConversationStateService.getState(conversationKey);
    let activeProduct = await ConversationStateService.resolveActiveProduct(conversationKey);

    // STRICT: Only set activeOrder if explicitly resolved previously or in this turn
    let activeOrder = null;
    if (state?.activeOrderNumber) {
      const exactMatch = await this.resolveOrderByNumber(shop.id, state.activeOrderNumber);
      if (exactMatch) {
        activeOrder = exactMatch;
      }
    }

    // Keep activeOrder in state in sync with latest DB order
    const contextSnapshot = {
      ...state,
      activeProduct,
      activeOrder
    };

    // 8. Context & Pronoun Reference Resolution
    const ref = ConversationContextResolver.resolveReference(messageText, contextSnapshot, { orders });
    if (ref.entityType === ResolvedEntityType.PRODUCT && ref.entity) {
      activeProduct = ref.entity;
    } else if (ref.entityType === ResolvedEntityType.ORDER && ref.entity) {
      activeOrder = ref.entity;
    }

    const candidateProduct = activeProduct || (await ConversationStateService.resolveProductReference(conversationKey, messageText));
    const contextBefore = ConversationContextResolver.buildContextObject(state, ref, customer);

    // 9. Intent Resolution
    const detected = IntentResolver.resolveIntent(messageText, {
      activeProduct: candidateProduct,
      activeOrder,
      state,
      recentOrders: orders
    });

    await ConversationStateService.recordTurn(conversationKey, {
      sender: 'customer',
      text: messageText,
      intent: detected.intent
    });

    const storeName = shop.name || shop.domain.replace('.myshopify.com', '');
    const shouldGreet = await ConversationStateService.shouldGreet(conversationKey, conversation.messages ? conversation.messages.length : 0);

    let replyText = '';
    let executedAction = null;
    let usedLLM = false;

    // Structured diagnostics & turn tracing for ZARA_DEBUG_CONTEXT
    const stateBefore = {
      activeTopic: state?.recentTopic || null,
      activeProduct: activeProduct ? (activeProduct.title || activeProduct.name) : null,
      activeOrder: activeOrder?.orderNumber || state?.activeOrderNumber || null,
      customer: customer?.firstName || cleanPhone,
      pendingAction: state?.pendingAction || null,
      recentEntities: state?.recentEntities || []
    };

    const toolsCalled = [];
    const toolResults = [];
    const routingDecision = {
      catalogSearch: false,
      orderLookup: false,
      customerLookup: false,
      checkout: false,
      LLM: false,
      other: false
    };
    let responseSource = 'rule_engine';

    // =========================================================================
    // 10. DETERMINISTIC ACTION DISPATCHER
    // =========================================================================

    // CASE A: Standalone Order Number Input (e.g. "123", "1643", "#1643")
    if (detected.intent === 'ORDER_NUMBER_INPUT') {
      executedAction = 'order_number_lookup';
      routingDecision.orderLookup = true;
      responseSource = 'order_resolver';
      const orderNum = detected.orderNumber;
      toolsCalled.push(`OrderResolver.resolveOrderByNumber("${orderNum}")`);
      const orderFound = await this.resolveOrderByNumber(shop.id, orderNum);

      if (orderFound) {
        toolResults.push(`Found Order #${orderFound.orderNumber}`);
        activeOrder = orderFound;
        await ConversationStateService.setActiveOrder(conversationKey, orderFound);
        const cleanItem = ProductSummaryService.normalizeProductName(orderFound.items || 'item').customerFriendlyName;
        const status = orderFound.status || 'Pending Confirmation';

        if (/dispatch|transit|shipped|courier/i.test(status)) {
          replyText = `Ji, order #${orderFound.orderNumber} ${cleanItem} ka hai. Ye dispatch ho chuka hai aur courier ke paas hai. Expected delivery 3–5 working days hai.`;
        } else {
          replyText = `Ji, order #${orderFound.orderNumber} ${cleanItem} ka hai. Iska status "${status}" hai. Kul COD total Rs. ${Number(orderFound.totalAmount).toLocaleString()} hai.`;
        }
      } else {
        toolResults.push(`No match for Order #${orderNum}`);
        // STRICT: Order does not exist. Never fall back to another order!
        activeOrder = null;
        await ConversationStateService.clearActiveOrder(conversationKey);
        await ConversationStateService.updateState(conversationKey, {
          activeOrderNumber: null,
          recentTopic: 'order',
          pendingAction: null
        });
        replyText = `Maazrat, order #${orderNum} record mein nahi mila. Baraye meharbani check kar ke dobara batayein ya apna registered phone number share karein.`;
      }
    }

    // CASE B: Customer Identity & Order Lookup
    else if (
      detected.intent === 'ORDER_LOOKUP_BY_DETAILS' ||
      detected.intent === 'ORDER_STATUS' ||
      detected.intent === 'ORDER_SUMMARY'
    ) {
      executedAction = detected.intent === 'ORDER_STATUS' ? 'order_status_fastpath' : 'order_summary_fastpath';
      routingDecision.orderLookup = true;
      if (detected.intent === 'ORDER_LOOKUP_BY_DETAILS') {
        routingDecision.customerLookup = true;
      }
      responseSource = 'order_resolver';
      await ConversationStateService.updateState(conversationKey, { recentTopic: 'order' });

      const extracted = CheckoutStateMachine.extractCustomerInfo(messageText);
      const cleanMsg = messageText.toLowerCase();
      let productHint = null;
      if (cleanMsg.includes('chair') || cleanMsg.includes('cover')) productHint = 'chair';
      if (cleanMsg.includes('snoring') || cleanMsg.includes('dilator')) productHint = 'snoring';

      toolsCalled.push(`OrderResolver.resolveCustomerOrders({ customerName: "${extracted.name || ''}", city: "${extracted.city || ''}", product: "${productHint || ''}" })`);
      const orderLookup = await OrderResolver.resolveCustomerOrders({
        shopId: shop.id,
        fromPhone,
        customerName: extracted.name || customer?.firstName,
        city: extracted.city || customer?.city,
        address: extracted.address,
        productQuery: productHint,
        orderNumber: detected.orderNumber || null,
        rawMessage: messageText
      });

      if (orderLookup.found && !orderLookup.multiple) {
        toolResults.push(`Matched single Order #${orderLookup.order.orderNumber}`);
        const ord = orderLookup.order;
        activeOrder = ord;
        await ConversationStateService.setActiveOrder(conversationKey, ord);
        const cleanItem = ProductSummaryService.normalizeProductName(ord.items || 'item').customerFriendlyName;
        const status = ord.status || 'Pending Confirmation';

        if (/dispatch|transit|shipped|courier/i.test(status)) {
          replyText = `Ji, order #${ord.orderNumber} ${cleanItem} ka hai. Ye dispatch ho chuka hai aur courier ke paas hai. Expected delivery 3–5 working days hai.`;
        } else {
          replyText = `Aapke order #${ord.orderNumber} (${cleanItem}) ka current status "${status}" hai. Kul COD total Rs. ${Number(ord.totalAmount).toLocaleString()} hai.`;
        }
      } else if (orderLookup.found && orderLookup.multiple) {
        toolResults.push(`Matched ${orderLookup.count} orders`);
        const list = orderLookup.orders.slice(0, 3).map(o => {
          const cleanItem = ProductSummaryService.normalizeProductName(o.items || 'item').customerFriendlyName;
          return `#${o.orderNumber} — ${cleanItem}`;
        }).join('\n');
        replyText = `Aapke ${orderLookup.count} orders record mein hain:\n\n${list}\n\nAap kis order ke baare mein maloomat chahtay hain?`;
        await ConversationStateService.setPendingAction(conversationKey, 'AWAITING_ORDER_NUMBER');
      } else {
        toolResults.push(`No matching orders found`);
        const detailParts = [];
        if (extracted.name) detailParts.push(`naam: ${extracted.name}`);
        if (extracted.city) detailParts.push(`shehar: ${extracted.city}`);
        const detailsStr = detailParts.length > 0 ? ` (${detailParts.join(', ')})` : '';
        replyText = `Maazrat, aapki details${detailsStr} se koi matching order record mein nahi mila. Baraye meharbani apna order number share karein ya phone number check kar lein.`;
        await ConversationStateService.setPendingAction(conversationKey, 'AWAITING_ORDER_NUMBER');
      }
    }

    // CASE C: Order Cancellation or Product Dismissal
    else if (detected.intent === 'CANCEL') {
      const targetOrder = activeOrder || recentOrder;
      if (targetOrder && (state?.recentTopic === 'order' || state?.activeOrderNumber || !activeProduct)) {
        if (IntentResolver.isNegated(messageText, 'cancel')) {
          replyText = `Ji, aapka order cancel nahi kiya gaya hai aur confirmed hi rahe ga.`;
        } else {
          if (targetOrder.orderId) {
            await ToolDispatcher.dispatch('cancel_order', {
              orderId: targetOrder.orderId,
              reason: 'customer_whatsapp_cancellation'
            }, {
              shopDomain: shop.domain,
              orderId: targetOrder.orderId
            });
          }
          executedAction = 'cancel_order';
          await ConversationStateService.updateState(conversationKey, {
            activeOrderStatus: 'Cancelled',
            recentTopic: 'order'
          });
          replyText = `Aapka order #${targetOrder.orderNumber} cancel kar diya gaya hai. Agar aapko koi aur cheez dekhni ho to zaroor batayein.`;
        }
      } else {
        executedAction = 'product_rejected';
        await ConversationStateService.rejectProduct(conversationKey, activeProduct || null);
        replyText = `Theek hai, koi baat nahi! Agar aap kuch aur dekhna chahein to product ka naam ya category bata dein, main madad kar deti hoon.`;
      }
    }

    // CASE D: Product Rejection
    else if (detected.intent === 'PRODUCT_REJECTION') {
      executedAction = 'product_rejected';
      await ConversationStateService.rejectProduct(conversationKey, activeProduct || null);
      replyText = `Theek hai, koi baat nahi! Agar aap kuch aur dekhna chahein to product ka naam ya category bata dein, main madad kar deti hoon.`;
    }

    // CASE D2: Negated Confirmation
    else if (detected.intent === 'CONFIRM_NEGATED') {
      executedAction = 'confirm_negated_suppressed';
      replyText = 'Aapka order confirm nahi kiya gaya hai. Agar aap cancel karna chahtay hain to reply "2" ya "Cancel" likhein.';
    }

    // CASE D3: Negated Cancellation
    else if (detected.intent === 'CANCEL_NEGATED') {
      executedAction = 'cancel_negated_suppressed';
      replyText = 'Theek hai, aapka order cancel nahi kiya gaya. Yeh safe hai aur confirmed hi rahe ga.';
    }

    // CASE E: Confirmation Flow (Existing Order vs New Product Purchase)
    else if (detected.intent === 'CONFIRM') {
      const targetOrder = activeOrder || (state?.recentTopic === 'order' ? recentOrder : null);
      if (targetOrder && targetOrder.orderNumber && (state?.recentTopic === 'order' || state?.activeOrderNumber || !activeProduct)) {
        routingDecision.orderLookup = true;
        responseSource = 'order_confirmation';
        if (IntentResolver.isNegated(messageText, 'confirm')) {
          replyText = `Aapka order confirm nahi kiya gaya hai. Agar aap cancel karna chahtay hain to reply "2" ya "Cancel" likhein.`;
        } else if (targetOrder.status === 'Confirmed') {
          replyText = `Aapka order #${targetOrder.orderNumber} pehle hi confirm ho chuka hai aur dispatch ke liye tayyar hai!`;
        } else {
          if (targetOrder.orderId) {
            toolsCalled.push(`confirm_order(${targetOrder.orderId})`);
            await ToolDispatcher.dispatch('confirm_order', { orderId: targetOrder.orderId }, {
              shopDomain: shop.domain,
              orderId: targetOrder.orderId
            });
            toolResults.push(`Confirmed order #${targetOrder.orderNumber}`);
          }
          executedAction = 'confirm_order';
          await ConversationStateService.updateState(conversationKey, {
            activeOrderStatus: 'Confirmed',
            recentTopic: 'order'
          });
          const cleanItem = ProductSummaryService.normalizeProductName(targetOrder.items || 'item').customerFriendlyName;
          replyText = `Bohat shukriya! Aapka order #${targetOrder.orderNumber} — ${cleanItem} — confirm kar diya gaya hai aur jald dispatch kar diya jaye ga. Agar mazeed koi rehnumai chahiye ho to zaroor batayein.`;
        }
      } else if (activeProduct || candidateProduct) {
        executedAction = 'confirm_product_booking';
        routingDecision.checkout = true;
        responseSource = 'checkout_engine';
        toolsCalled.push('CheckoutStateMachine.processTurn');
        const prod = activeProduct || candidateProduct;
        const checkoutResult = CheckoutStateMachine.processTurn(
          state.checkoutState || {},
          messageText,
          { activeProduct: prod, customer, senderPhone: cleanPhone }
        );

        const names = ProductSummaryService.normalizeProductName(prod.title);
        const quote = await DeliveryService.getDeliveryQuote({ shopDomain: shop.domain, subtotal: prod.numericPrice });
        const calc = DeliveryService.calculateTotal(prod.numericPrice, quote.deliveryCharge);
        toolResults.push(`Initiated booking for ${prod.title}`);

        await ConversationStateService.updateState(conversationKey, {
          checkoutState: checkoutResult.checkout,
          currentProduct: prod,
          activeProduct: prod,
          activeProductPrice: prod.numericPrice,
          activeDeliveryCharge: quote.deliveryCharge,
          activeProductTotal: calc.total,
          pendingAction: 'AWAITING_ADDRESS',
          recentTopic: 'checkout'
        });

        replyText = `Ji, aap naya order book karna chahte hain *${names.customerFriendlyName}* (Rs. ${prod.numericPrice} + Rs. ${quote.deliveryCharge} delivery, kul total Rs. ${calc.total}, quantity 1) ka? Naya order book karne ke liye baraye meharbani apna poora naam, phone number, complete delivery address aur city share kar dein.`;
      } else {
        replyText = `Mujhe aapka koi pending order ya product nahi mila confirm karne ke liye. Agar aapke paas order number hai to zaroor batayein.`;
      }
    }

    // CASE F: Inbound Checkout Details (Address, Name, City)
    else if (
      (state.recentTopic === 'checkout' ||
       state.pendingAction === 'COLLECTING_ADDRESS' ||
       state.pendingAction === 'AWAITING_ADDRESS' ||
       state.pendingAction === 'COLLECTING_CHECKOUT_DETAILS') &&
      ![
        'COLLECTION',
        'CATALOG',
        'STORE_LINK',
        'MORE',
        'HUMAN_TRANSFER',
        'OWNER_INFO',
        'BOT_IDENTITY',
        'CUSTOMER_FRUSTRATION',
        'CUSTOMER_COMPLAINT',
        'SOCIAL_FRIENDSHIP',
        'SOCIAL_CLOSING',
        'SOCIAL_THANKYOU',
        'SOCIAL_CASUAL',
        'PRODUCT_INQUIRY',
        'PRODUCT_DETAIL',
        'ORDER_STATUS',
        'ORDER_SUMMARY',
        'ORDER_LOOKUP_BY_DETAILS'
      ].includes(detected.intent)
    ) {
      if (activeProduct) {
        executedAction = 'checkout_details_update';
        routingDecision.checkout = true;
        responseSource = 'checkout_engine';
        toolsCalled.push('CheckoutStateMachine.processTurn');
        const checkoutResult = CheckoutStateMachine.processTurn(
          state.checkoutState || {},
          messageText,
          { activeProduct, customer, senderPhone: cleanPhone }
        );
        toolResults.push(`Checkout state updated: ready=${checkoutResult.isReadyForConfirmation}`);

        await ConversationStateService.updateState(conversationKey, {
          checkoutState: checkoutResult.checkout,
          pendingAction: checkoutResult.isReadyForConfirmation ? 'AWAITING_FINAL_CONFIRMATION' : 'COLLECTING_ADDRESS'
        });

        replyText = checkoutResult.prompt;
      }
    }

    // CASE G: First-Class Product Link Request
    else if (detected.intent === 'PRODUCT_LINK' || (detected.intent === 'ORDINAL_REFERENCE' && /\b(link|url)\b/i.test(messageText))) {
      executedAction = 'product_link_resolution';
      const refProduct = ref.entity || activeProduct || candidateProduct;
      if (refProduct && refProduct.url) {
        replyText = `Ji, yeh raha direct link:\n🔗 ${refProduct.url}`;
      } else {
        const storeInfo = await ShopifyCatalogService.getStoreInfo(shop.domain);
        replyText = `Aap hamari website yahan visit kar saktay hain:\n🔗 ${storeInfo.storefrontUrl}`;
      }
    }

    // CASE H: Delivery Inquiry
    else if (detected.intent === 'DELIVERY_INQUIRY' || detected.intent === 'ORDER_DELIVERY_CHARGES') {
      const explicitOrderMatch = messageText.match(/(?:order|#)\s*(\d{3,7})/i);
      const isExplicitOrderText = /\b(mera|mere|meri)?\s*(order|parcel|booking)\b/i.test(messageText);
      let targetOrderForDelivery = null;
      if (explicitOrderMatch) {
        targetOrderForDelivery = await this.resolveOrderByNumber(shop.id, explicitOrderMatch[1]);
      } else if (isExplicitOrderText || ref.type === 'ORDER' || (!activeProduct && !candidateProduct && ref.type !== 'PRODUCT')) {
        targetOrderForDelivery = activeOrder || (await this.resolveOrderByPhone(shop.id, fromPhone));
      }

      if (targetOrderForDelivery) {
        executedAction = 'order_delivery_charges_fastpath';
        let delFee = 199;
        try {
          const payload = typeof targetOrderForDelivery.payload === 'string' ? JSON.parse(targetOrderForDelivery.payload) : targetOrderForDelivery.payload;
          const sl = payload?.shipping_lines?.[0];
          if (sl?.price) delFee = Number(sl.price);
        } catch (_) {}
        replyText = `Ji, aapke order #${targetOrderForDelivery.orderNumber} ke delivery charges Rs. ${delFee} hain.`;
      } else {
        executedAction = 'delivery_quote_fastpath';
        let prod = ref.entity || activeProduct || candidateProduct;
        if (!prod) {
          const cleanQuery = messageText
            .replace(/\b(mera|meri|mere|ka|ki|ke|price|rate|delivery|charges|charges\?|batao|btao|bhi|kitne|hai|hain)\b/gi, '')
            .trim();
          if (cleanQuery) {
            const searchRes = await ShopifyCatalogService.searchProducts(shop.domain, cleanQuery, { limit: 1 });
            prod = searchRes.products?.[0] || null;
          }
        }
        if (prod) {
          executedAction = 'delivery_quote_fastpath';
          const names = ProductSummaryService.normalizeProductName(prod.title);
          const fee = prod.deliveryCharge || 199;
          const price = prod.numericPrice || prod.price || 499;
          const total = price + fee;
          const urlPart = prod.url ? `\n\nProduct dekhne ke liye:\n🔗 ${prod.url}` : '';
          if (/\b(price|rate|kitne)\b/i.test(messageText)) {
            replyText = `Ji, *${names.customerFriendlyName || prod.title}* ki price Rs. ${price} aur delivery charges Rs. ${fee} hain (tamam Pakistan mein 3–5 working days).\nTotal: Rs. ${total}${urlPart}`;
          } else {
            replyText = `Ji, *${names.customerFriendlyName || prod.title}* ke delivery charges Rs. ${fee} hain (tamam Pakistan mein 3–5 working days).\nTotal: Rs. ${total}${urlPart}`;
          }
        } else {
          replyText = `Sunday Bazaaar ke standard COD delivery charges Rs. 199 hain tamam Pakistan mein.`;
        }
      }
    }

    // CASE I: Total Inquiry
    else if (detected.intent === 'TOTAL_INQUIRY' || detected.intent === 'ORDER_TOTAL') {
      executedAction = 'total_inquiry_fastpath';
      const explicitOrderMatch = messageText.match(/(?:order|#)\s*(\d{3,7})/i);
      let targetOrderForTotal = null;
      if (explicitOrderMatch) {
        targetOrderForTotal = await this.resolveOrderByNumber(shop.id, explicitOrderMatch[1]);
      } else if (!activeProduct && !candidateProduct && ref.type !== 'PRODUCT') {
        targetOrderForTotal = activeOrder || (await this.resolveOrderByPhone(shop.id, fromPhone));

      }
      if (targetOrderForTotal) {
        executedAction = 'order_total_fastpath';
        replyText = `Ji, order #${targetOrderForTotal.orderNumber} ka kul total Rs. ${Number(targetOrderForTotal.totalAmount).toLocaleString()} hai.`;
      } else {
        let prod = ref.entity || activeProduct || candidateProduct;
        if (!prod) {
          const cleanQuery = messageText
            .replace(/\b(iska\s*total|total|bill|kitna|kitne|paise|amount|cod|kul|delivery\s*ke\s*sath|shipping\s*ke\s*sath|mila\s*k|mila\s*ke|hai|kya)\b/gi, '')
            .trim();
          if (cleanQuery) {
            routingDecision.catalogSearch = true;
            toolsCalled.push(`ShopifyCatalogService.searchProducts("${cleanQuery}")`);
            const searchRes = await ShopifyCatalogService.searchProducts(shop.domain, cleanQuery, { limit: 1 });
            prod = searchRes.products?.[0] || null;
            toolResults.push(prod ? `Found ${prod.title}` : 'No products found');
            if (prod) {
              await ConversationStateService.setActiveProduct(conversationKey, prod);
            }
          }
        }
        if (prod) {
          executedAction = 'total_inquiry_fastpath';
          responseSource = 'total_inquiry';
          const names = ProductSummaryService.normalizeProductName(prod.title);
          const price = Number(prod.numericPrice || prod.price || 0);
          const delivery = Number(prod.deliveryCharge || 199);
          const total = price + delivery;
          const urlPart = prod.url ? `\n\nProduct dekhne ke liye:\n🔗 ${prod.url}` : '';
          replyText = `Ji, *${names.customerFriendlyName || prod.title}* ki price Rs. ${price} aur delivery Rs. ${delivery} mila kar kul total Rs. ${total} banta hai.${urlPart}`;
        } else if (activeOrder && (state?.recentTopic === 'order' || state?.activeOrderNumber)) {
          replyText = `Order #${activeOrder.orderNumber} ka total bill Rs. ${Number(activeOrder.totalAmount).toLocaleString()} hai.`;
        } else {
          replyText = `Delivery Rs. 199 hai. Aap kis product ka total bill maloom karna chahtay hain?`;
        }
      }
    }

    // CASE J: Product Price / Details
    else if (detected.intent === 'PRODUCT_DETAIL' || detected.intent === 'ORDINAL_REFERENCE') {
      responseSource = 'product_detail';
      let prod = ref.entity || activeProduct || candidateProduct;
      if (!prod) {
        const cleanQuery = messageText
          .replace(/\b(ki\s*price|ka\s*rate|kitne\s*ka\s*hai|kitn[ey]\s*ka|price|rate|details|detail|batao|btao|bata\s*dein|hai|kya|mujhe|chahiye)\b/gi, '')
          .trim();
        const isPronounQuery = /^(iski|iska|is\s*ki|is\s*ka|iss\s*ki|iss\s*ka|ye|yeh|this|item|product|wo|woh)$/i.test(cleanQuery);
        if (cleanQuery && !isPronounQuery) {
          routingDecision.catalogSearch = true;
          toolsCalled.push(`ShopifyCatalogService.searchProducts("${cleanQuery}")`);
          const searchRes = await ShopifyCatalogService.searchProducts(shop.domain, cleanQuery, { limit: 1 });
          prod = searchRes.products?.[0] || null;
          toolResults.push(prod ? `Found ${prod.title}` : 'No products found');
        }
      }
      if (prod) {
        executedAction = (ref.type === 'ORDINAL' || /\b(pehle|doosre|dusre|teesre|ye\s*wala|wo\s*wala|1st|2nd)\b/i.test(messageText)) ? 'ordinal_reference_resolution' : 'product_detail_resolution';
        const names = ProductSummaryService.normalizeProductName(prod.title);
        await ConversationStateService.setActiveProduct(conversationKey, prod);
        await ConversationStateService.updateState(conversationKey, {
          currentProduct: prod,
          activeProduct: prod,
          recentTopic: 'product'
        });

        if (/\b(price|kitne|rate|paisa|cost|prize)\b/i.test(messageText)) {
          const displayPrice = prod.formattedPrice || (prod.numericPrice ? `Rs. ${prod.numericPrice}` : '');
          replyText = `Ji, *${prod.title}* ki price ${displayPrice} hai.\n\nProduct details:\n🔗 ${prod.url}`;
        } else if (/\b(link|url|website)\b/i.test(messageText)) {
          replyText = `Ji, yeh raha direct link:\n🔗 ${prod.url}`;
        } else {
          const quote = await DeliveryService.getDeliveryQuote({ shopDomain: shop.domain, subtotal: prod.numericPrice });
          const calc = DeliveryService.calculateTotal(prod.numericPrice, quote.deliveryCharge);
          const cleanSummary = ProductSummaryService.cleanProductSummary(prod.title, prod.description);
          replyText = `Ji, *${names.customerFriendlyName}* ${prod.formattedPrice} ka hai.\n\nDelivery charges: Rs. ${quote.deliveryCharge}\nTotal: Rs. ${calc.total}\n\n${cleanSummary ? `${cleanSummary}\n\n` : ''}🔗 ${prod.url}`;
        }
      } else {
        replyText = `Aap kis product ki price ya details maloom karna chahtay hain? Product ka naam bata dein.`;
      }
    }

    // CASE K: Product Inquiry (Keyword Catalog Search)
    else if (detected.intent === 'PRODUCT_INQUIRY') {
      executedAction = 'product_inquiry_complete';
      routingDecision.catalogSearch = true;
      responseSource = 'product_inquiry';
      const cleanQuery = messageText
        .replace(/\b(mujhe|chahiye|chaiye|chahye|dikhao|batao|bhejo|hai|kya|aapke\s*paas|available|in\s*stock|stock|price|rate|kitne\s*ka|ki\s*price|ka\s*rate|details|detail|se\s*pareshani\s*hoti\s*hai|pareshani|masla|kitna|total|bata\s*dein)\b/gi, '')
        .trim();
      const targetQuery = cleanQuery || (candidateProduct ? candidateProduct.title : messageText);
      toolsCalled.push(`ShopifyCatalogService.searchProducts("${targetQuery}")`);
      const searchRes = await ShopifyCatalogService.searchProducts(shop.domain, targetQuery, { limit: 1 });
      const foundProduct = searchRes.products?.[0] || candidateProduct;
      toolResults.push(foundProduct ? `Found ${foundProduct.title}` : 'No products found');

      if (foundProduct) {
        const names = ProductSummaryService.normalizeProductName(foundProduct.title);
        const cleanSummary = ProductSummaryService.cleanProductSummary(foundProduct.title, foundProduct.description);
        await ConversationStateService.setActiveProduct(conversationKey, foundProduct);

        const quote = await DeliveryService.getDeliveryQuote({ shopDomain: shop.domain, subtotal: foundProduct.numericPrice });
        const calc = DeliveryService.calculateTotal(foundProduct.numericPrice, quote.deliveryCharge);
        const customerName = customer?.firstName ? `${customer.firstName} bhai` : '';
        const greetingPart = shouldGreet ? `Ji${customerName ? ' ' + customerName : ''}, ` : 'Ji, ';

        replyText = `${greetingPart}*${names.customerFriendlyName}* available hai.\n\n` +
          `Product price: Rs. ${foundProduct.numericPrice}\n` +
          `Delivery charges: Rs. ${quote.deliveryCharge}\n` +
          `Total: Rs. ${calc.total}\n\n` +
          `${cleanSummary ? `${cleanSummary}\n\n` : ''}` +
          `Product dekhne ke liye:\n` +
          `🔗 ${foundProduct.url}\n\n` +
          `Agar aap chahen to main iske bare mein mazeed details bhi bata deti hoon ya order book karne mein madad karoon?`;
      }
    }

    // CASE L: Informational Queries (Owner, Bot Identity, Human Support)
    else if (detected.intent === 'OWNER_INFO') {
      executedAction = 'owner_info';
      replyText = `Sunday Bazaaar Official hamari management team operate karti hai. Main Zara hoon, unki official AI customer support representative. Main aapki kis cheez mein madad kar sakti hoon?`;
    } else if (detected.intent === 'BOT_IDENTITY') {
      executedAction = 'bot_identity';
      replyText = `Mera naam Zara hai aur main Sunday Bazaaar ki official customer support representative hoon. Main aapki orders, delivery aur product details mein madad ke liye hazir hoon!`;
    } else if (detected.intent === 'HUMAN_TRANSFER') {
      const isAlreadyEscalated = Boolean(
        state.humanEscalation?.notificationSent ||
        state.escalationState?.notificationSent ||
        conversation.isEscalated
      );

      if (isAlreadyEscalated) {
        executedAction = 'human_transfer_already_notified';
        replyText = `Aapki request hamari human support team ko pehle hi bhej di gayi hai, woh jald rabta karegi. Tab tak main aapki madad ke liye yahin hoon — aap kya poochna chahte hain?`;
      } else {
        executedAction = 'request_human_transfer';
        await ToolDispatcher.dispatch('request_human_transfer', {
          orderId: (activeOrder?.id || recentOrder?.id),
          reason: 'Customer requested human support via WhatsApp'
        }, {
          shopDomain: shop.domain,
          orderId: (activeOrder?.id || recentOrder?.id)
        }).catch(() => {});

        await HumanEscalationService.escalateToHuman({
          shopDomain: shop.domain,
          reason: 'Customer explicitly requested to speak with owner / live human agent',
          customerPhone: cleanPhone,
          customerName: customer ? `${customer.firstName || ''} ${customer.lastName || ''}`.trim() : null,
          conversationId: conversation.id
        }).catch(() => ({ escalated: true, alreadyEscalated: false }));

        await ConversationStateService.markHumanEscalation(conversationKey, {
          notificationSent: true,
          notifiedAt: Date.now()
        });

        replyText = `Maine aapki request hamari customer support team ko forward kar di hai aur human support team ko inform kar diya hai. Aapki request note kar li gayi hai aur team jald rabta karegi. Main bhi yahin hoon agar aapko mazeed kisi cheez mein madad chahiye ho.`;
      }
    }

    // CASE M: Social Closing / Chitchat
    else if (detected.intent === 'CUSTOMER_COMPLAINT') {
      executedAction = 'customer_complaint_retention';
      replyText = `Mujhe intehai afsos hai ke aapko hamari service se itni disappointment hui. Main aapki baat ko bohat sanjeedgi se le rahi hoon. Humari human support team jald aap se rabta karegi.`;
    } else if (detected.intent === 'CUSTOMER_FRUSTRATION') {
      executedAction = 'customer_frustration_resolution';
      replyText = `Mujhe intehai afsos hai agar meri kisi baat se pareshani hui. Main behtar samajhne ki poori koshish kar rahi hoon. Agar aap chahein to main live human support team ko inform kar doon taake woh aapse direct rabta kar lein?`;
    } else if (detected.intent === 'SOCIAL_FRIENDSHIP') {
      executedAction = 'social_friendship';
      replyText = `Haha, bilkul! Main Sunday Bazaaar ki taraf se aapki digital dost hi hoon. Batayein main aaj aapki kya madad karoon?`;
    } else if (detected.intent === 'CONVERSATIONAL_CLARIFICATION') {
      executedAction = 'conversational_clarification';
      replyText = `Ji theek hai, aap aaram se check kar lein. Main yahin hoon jab bhi aapko zaroorat ho!`;
    } else if (detected.intent === 'COLLECTION') {
      executedAction = 'collection_view';
      let categoryMatch = null;
      if (/clean/i.test(messageText)) categoryMatch = 'cleaning';
      else if (/kitchen/i.test(messageText)) categoryMatch = 'kitchen';
      else if (/mobile/i.test(messageText)) categoryMatch = 'mobile';
      else if (/women/i.test(messageText)) categoryMatch = 'women';
      
      const cols = await ShopifyCatalogService.getCollections(shop.domain, categoryMatch);
      const col = cols[0];
      if (col) {
        replyText = `Ji, hamari ${col.title} yahan dekh sakte hain:\n🔗 ${col.url}\n\nAap collection mein tamam available products, prices aur details dekh sakte hain.`;
      } else {
        replyText = `Sunday Bazaaar ke collections dekhne ke liye:\n🔗 https://${shop.domain || 'sundaybazaaar.store'}/collections/all-products`;
      }
    } else if (detected.intent === 'CATALOG') {
      executedAction = 'catalog_view';
      replyText = `Sunday Bazaaar ke tamam products hamari website par available hain:\n🔗 https://sundaybazaaar.store`;
    } else if (detected.intent === 'STORE_LINK') {
      executedAction = 'store_link';
      replyText = `Sunday Bazaaar Official store link:\n🔗 https://sundaybazaaar.store`;
    } else if (detected.intent === 'PURCHASE_INTENT') {
      executedAction = 'purchase_intent';
      let prod = ref.entity || activeProduct || candidateProduct;
      if (prod) {
        const names = ProductSummaryService.normalizeProductName(prod.title);
        const fee = prod.deliveryCharge || 199;
        const total = (Number(prod.numericPrice || prod.price || 0) + fee);
        replyText = `Ji bilkul, main *${names.customerFriendlyName}* ka order book kar deti hoon. Price Rs. ${prod.numericPrice || prod.price}, delivery Rs. ${fee} mila kar kul total Rs. ${total} hai. Baraye meharbani apna complete delivery address aur city confirm kar dein.`;
      } else {
        replyText = `Ji zaroor, aap konsa product order karna chahtay hain? Product ka naam bata dein.`;
      }
    } else if (detected.intent === 'SOCIAL_CLOSING') {
      executedAction = 'social_closing';
      await ConversationStateService.updateState(conversationKey, { isClosed: true });
      replyText = `Allah Hafiz! Apna khayal rakhiye ga. Agar ainda koi bhi zaroorat ho to hum hazir hain!`;
    } else if (detected.intent === 'SOCIAL_THANKYOU') {
      executedAction = 'social_thankyou';
      replyText = `Aapka bohat shukriya! Agar mazeed kisi cheez mein madad chahiye ho to zaroor batayein.`;
    } else if (detected.intent === 'SOCIAL_CASUAL') {
      executedAction = 'social_casual';
      if (/neend/i.test(messageText)) {
        replyText = `Aray, aisa hota hai! Kabhi kabhi neend nahi aati. Thora relax karein ya koi achi si kitab parhein, inshaAllah neend aa jaye gi.`;
      } else if (/girlfriend/i.test(messageText)) {
        replyText = `Aray, girlfriend ko manana to bohat zaroori hai! Koi acha sa gift ya unki pasand ki cheez dekh lein, mood foran theek ho jaye ga. Agar aap hamare store se kuch dekhna chahein to batayein!`;
      } else {
        replyText = `Main bilkul theek hoon, shukriya! Aap sunayein, main aapki kya madad kar sakti hoon?`;
      }
    } else if (detected.intent === 'MORE') {
      executedAction = 'catalog_pagination_more';
      const searchRes = await ShopifyCatalogService.searchProducts(shop.domain, '', { page: 2, limit: 3 });
      const rejectedTitles = (state.rejectedProducts || []).map(rp => (rp.title || rp).toLowerCase());
      const filtered = (searchRes.products || []).filter(p => !rejectedTitles.some(rt => p.title.toLowerCase().includes(rt)));
      if (filtered.length === 0) {
        replyText = `Is category mein mazeed items nahi hain. Hamari mukammal collection website par check kar saktay hain:\n🔗 https://sundaybazaaar.store/collections/all-products`;
      } else {
        const list = filtered.map((p, idx) => `${idx + 1}. *${p.title}* — ${p.formattedPrice}\n🔗 ${p.url}`).join('\n\n');
        replyText = `Yeh mazeed products hain:\n\n${list}\n\nMukammal collection dekhne ke liye:\n🔗 https://sundaybazaaar.store/collections/all-products`;
      }
    }

    // =========================================================================
    // 11. FALLBACK CONVERSATIONAL AI (GEMINI) — IF NOT HANDLED DETERMINISTICALLY
    // =========================================================================
    const isOrderQuery =
      detected.intent.startsWith('ORDER_') ||
      detected.intent === 'CANCEL' ||
      detected.intent === 'CONFIRM' ||
      /\b(order|parcel|booking|tracking|delivery\s*status)\b/i.test(messageText);

    if (!replyText) {
      try {
        const aiClient = getAIClient();
        const availableTools = [
          AITools.get_delivery_quote,
          AITools.get_store_info,
          AITools.confirm_order,
          AITools.cancel_order,
          AITools.request_human_transfer
        ];

        // AUTHORITATIVE ROUTING: NEVER provide catalog tools when customer asked for order lookup/status
        if (!isOrderQuery) {
          availableTools.unshift(
            AITools.search_shopify_products,
            AITools.get_shopify_product_details,
            AITools.get_shopify_collections
          );
        }

        const systemInstruction = (
`You are Zara, the courteous, intelligent AI customer support assistant for "${storeName}".
You are communicating with a customer in Pakistan on WhatsApp.
Speak natural, helpful Roman Urdu and English. Be concise, polite, and human-like.

Customer & Store Context:
- Store: ${storeName}
- Customer Phone: ${cleanPhone}
${activeOrder && activeOrder.orderNumber ? `- Active Order #${activeOrder.orderNumber} (Rs. ${activeOrder.totalAmount}) - Items: ${activeOrder.items} - Status: ${activeOrder.status}` : '- No active order.'}
${activeProduct ? `- Active/Discussed Product: ${activeProduct.title} (${activeProduct.formattedPrice}) - Link: ${activeProduct.url}` : '- No active product.'}
${state.rejectedProducts && state.rejectedProducts.length > 0 ? `- Rejected Products: ${state.rejectedProducts.map(p => p.title || p).join(', ')}` : ''}

CRITICAL OPERATING RULES:
1. Grounded Answers: Do NOT hallucinate order status or product prices.
2. Contextual Resolution: "iski", "iska", "ye" refers to ${activeProduct?.title || 'active product'}.
3. Authoritative Order Scope: If the customer asks about an order, NEVER recommend or search unrelated products from the catalog.
4. Human Assistance: If asked for real human or owner, call request_human_transfer.`
        );

        const prompt = `Customer: ${messageText}\nZara:`;
        const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
        const timeoutMs = parseInt(process.env.GEMINI_TIMEOUT_MS || '8000', 10);

        const geminiCall = aiClient.models.generateContent({
          model: geminiModel,
          contents: prompt,
          config: {
            systemInstruction,
            tools: [{ functionDeclarations: availableTools }]
          }
        });

        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`Gemini API timed out after ${timeoutMs}ms`)), timeoutMs);
        });

        const response = await Promise.race([geminiCall, timeoutPromise]);
        usedLLM = true;
        routingDecision.LLM = true;
        responseSource = 'gemini';

        const candidate = response.candidates?.[0];
        const functionCalls = candidate?.content?.parts?.filter(p => p.functionCall).map(p => p.functionCall) || [];

        if (functionCalls.length > 0) {
          const call = functionCalls[0];
          executedAction = call.name;
          toolsCalled.push(`gemini_tool_call:${call.name}`);

          if (call.name === 'search_shopify_products' && isOrderQuery) {
            toolResults.push('Rejected catalog search on order query');
            replyText = `Aapke order ke hawalay se mujhe koi record nahi mila. Baraye meharbani apna order number share karein.`;
          } else {
            const toolResult = await ToolDispatcher.dispatch(call.name, call.args || {}, {
              shopDomain: shop.domain,
              orderId: activeOrder?.orderId,
              customerPhone: cleanPhone,
              conversationId: conversation.id,
              activeProduct
            });
            toolResults.push(typeof toolResult === 'object' ? JSON.stringify(toolResult) : String(toolResult));

            if (call.name === 'search_shopify_products' && toolResult?.products?.length > 0) {
              const prod = toolResult.products[0];
              await ConversationStateService.setActiveProduct(conversationKey, prod);
              replyText = `Ji, *${prod.title}* available hai (${prod.formattedPrice}).\n🔗 ${prod.url}`;
            } else {
              replyText = toolResult?.message || `Ji, main samajh gayi hoon.`;
            }
          }
        } else {
          replyText = (candidate?.content?.parts?.[0]?.text || '').trim();
        }
      } catch (geminiErr) {
        console.warn(`⚠️ [WhatsAppAgent] Gemini fallback note: ${geminiErr.message}.`);
        if (activeOrder && activeOrder.orderNumber) {
          replyText = `Ji, main Zara hoon ${storeName} se. Main aapke order #${activeOrder.orderNumber} aur delivery details ke hawalay se madad ke liye hazir hoon! Aap kya poochna chahtay hain?`;
        } else {
          replyText = `Ji, main Zara hoon ${storeName} se. Main aapki kya madad kar sakti hoon?`;
        }
      }
    }

    replyText = this.sanitizeResponse(replyText);

    // =========================================================================
    // 12. RESPONSE PLANNER & VOICE OUTPUT HANDLING
    // =========================================================================
    const plannedResponse = ResponsePlanner.planResponse({
      intent: detected.intent,
      resolvedEntity: ref,
      context: {
        activeProduct,
        activeOrder,
        customer: { name: customer?.firstName }
      },
      userMessage: messageText,
      isVoiceInbound,
      extra: { defaultReply: replyText, executedAction }
    });

    // Run Pre-Dispatch Response Quality Control & Truth Validation
    const qcResult = ResponseQualityControlService.validateAndRepair({
      replyText: plannedResponse.replyText || replyText,
      spokenText: plannedResponse.spokenText,
      intent: detected.intent,
      activeProduct,
      activeOrder,
      userMessage: messageText,
      isVoiceInbound,
      rejectedProducts: state?.rejectedProducts || [],
      storeDomain: shop.domain || 'sundaybazaaar.store'
    });

    const finalReplyText = qcResult.replyText;
    const finalSpokenText = qcResult.spokenText;

    if (qcResult.repaired) {
      console.log(`🛡️ [QC:REPAIRED] Outbound response repaired: ${qcResult.issues.join(' | ')}`);
    }

    // Safe outbound dispatch
    try {
      if (isVoiceInbound) {
        console.log(`🎙️ [WhatsApp:VOICE_IN] Voice note received. Generating spoken voice response.`);
        const ttsResult = await TextToSpeechService.synthesize(finalSpokenText);
        if (ttsResult.success && ttsResult.buffer && ttsResult.buffer.length > 0) {
          const fileName = 'zara_voice_note.ogg';
          if (typeof waClient?.sendMediaMessage === 'function') {
            await waClient.sendMediaMessage(fromPhone, ttsResult.buffer, 'voice', fileName, '', {
              quotedMessageId: messageId || undefined
            });
          } else {
            await this.sendWhatsAppVoiceNote(
              sessionId,
              fromPhone,
              ttsResult.buffer,
              'audio/ogg; codecs=opus',
              { shopId: shop.id }
            );
          }
          console.log(`✅ [WhatsApp:VOICE_OUT] Voice reply delivered to ${fromPhone}`);

          if (plannedResponse.sendTextLink && plannedResponse.textLinkMessage) {
            if (typeof waClient?.sendMessage === 'function') {
              await waClient.sendMessage(fromPhone, plannedResponse.textLinkMessage);
              console.log(`🔗 [WhatsApp:VOICE_LINK_DELIVERED] Sent companion text link to ${fromPhone}`);
            }
          }
        } else {
          if (typeof waClient?.sendMessage === 'function') {
            await waClient.sendMessage(fromPhone, finalReplyText, { quotedMessageId: messageId || undefined });
          }
        }
      } else {
        if (typeof waClient?.sendMessage === 'function') {
          await waClient.sendMessage(fromPhone, finalReplyText, { quotedMessageId: messageId || undefined });
        }
      }
    } catch (sendErr) {
      console.warn(`⚠️ [WhatsAppAgent] Notice on sending WhatsApp message: ${sendErr.message}`);
    }

    // Telemetry Observability
    const contextAfter = ConversationContextResolver.buildContextObject(
      await ConversationStateService.getState(conversationKey),
      ref,
      customer
    );

    ResponsePlanner.logTurnTelemetry({
      modality: isVoiceInbound ? 'voice' : 'text',
      inboundMessage: messageText,
      contextBefore,
      resolvedIntent: detected.intent,
      confidence: detected.confidence,
      resolvedEntity: ref,
      actionExecuted: executedAction,
      contextAfter,
      outboundModality: isVoiceInbound ? 'voice' : 'text',
      replyText: finalReplyText
    });

    // Record interaction log for SaaS analytics & observability
    await prisma.aIInteractionLog.create({
      data: {
        shopId: shop.id,
        customerId: customer?.id || null,
        conversationId: conversation.id,
        userMessage: messageText,
        detectedAgent: 'Zara',
        intent: detected.intent,
        action: executedAction || 'REPLY',
        modelUsed: usedLLM ? (process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite') : 'rule_engine',
        usedLLM: Boolean(usedLLM),
        responseTimeMs: Date.now() - startTime,
        status: 'SUCCESS'
      }
    }).catch(() => {});

    if (process.env.ZARA_DEBUG_CONTEXT === 'true') {
      const stateAfterRaw = await ConversationStateService.getState(conversationKey);
      const finalStateAfter = {
        activeTopic: stateAfterRaw?.recentTopic || null,
        activeProduct: stateAfterRaw?.currentProduct ? (stateAfterRaw.currentProduct.title || stateAfterRaw.currentProduct.name) : null,
        activeOrder: stateAfterRaw?.activeOrderNumber || null,
        customer: customer?.firstName || cleanPhone,
        pendingAction: stateAfterRaw?.pendingAction || null,
        recentEntities: stateAfterRaw?.recentEntities || []
      };

      console.log(`
------------------------------------------------------
TURN DEBUG
------------------------------------------------------

messageId: ${messageId || 'N/A'}
sender: ${fromPhone}
inputType: ${isVoiceInbound ? 'voice' : 'text'}
rawMessage: ${messageText}
transcript: ${isVoiceInbound ? messageText : 'N/A'}
normalizedMessage: ${messageText.toLowerCase().trim()}

CONVERSATION STATE BEFORE:
activeTopic: ${stateBefore.activeTopic || 'none'}
activeProduct: ${stateBefore.activeProduct || 'none'}
activeOrder: ${stateBefore.activeOrder || 'none'}
customer: ${stateBefore.customer || 'none'}
pendingAction: ${stateBefore.pendingAction || 'none'}
recentEntities: ${JSON.stringify(stateBefore.recentEntities)}

INTENT RESULT:
intent: ${detected.intent}
confidence: ${detected.confidence}
resolver: ${executedAction || 'rule_engine'}

ENTITY RESULT:
entityType: ${ref?.entityType || ref?.type || 'none'}
entityId: ${ref?.entity?.id || ref?.entity?.orderNumber || 'none'}
entityTitle: ${ref?.entity?.title || ref?.entity?.items || 'none'}
resolutionSource: ${ref?.strategy || ref?.type || 'context'}

ROUTING DECISION:
catalogSearch: ${routingDecision.catalogSearch}
orderLookup: ${routingDecision.orderLookup}
customerLookup: ${routingDecision.customerLookup}
checkout: ${routingDecision.checkout}
LLM: ${routingDecision.LLM}
other: ${routingDecision.other}

SELECTED HANDLER: ${executedAction || 'default'}

TOOLS CALLED:
${toolsCalled.length > 0 ? toolsCalled.map((t, i) => `${i + 1}. ${t}`).join('\n') : 'None'}

TOOL RESULTS:
${toolResults.length > 0 ? toolResults.join('\n') : 'None'}

RESPONSE SOURCE: ${plannedResponse?.source || responseSource}

CONVERSATION STATE AFTER:
activeTopic: ${finalStateAfter.activeTopic || 'none'}
activeProduct: ${finalStateAfter.activeProduct || 'none'}
activeOrder: ${finalStateAfter.activeOrder || 'none'}
customer: ${finalStateAfter.customer || 'none'}
pendingAction: ${finalStateAfter.pendingAction || 'none'}
recentEntities: ${JSON.stringify(finalStateAfter.recentEntities)}

FINAL RESPONSE:
${isVoiceInbound && plannedResponse.spokenText ? plannedResponse.spokenText : replyText}

------------------------------------------------------
`);
    }

    return {
      success: true,
      replyText: finalReplyText,
      intent: detected.intent,
      action: executedAction,
      usedLLM,
      spokenText: finalSpokenText,
      isVoiceResponse: Boolean(isVoiceInbound)
    };
  }

  /**
   * Helper to send voice notes via WA-AKG
   */
  static async sendWhatsAppVoiceNote(sessionId, to, audioBuffer, mimeType = 'audio/ogg; codecs=opus', options = {}) {
    if (!audioBuffer || audioBuffer.length === 0) return null;
    const waClient = new WhatsAppClient({
      baseUrl: process.env.WA_AKG_BASE_URL,
      apiKey: process.env.WA_AKG_API_KEY,
      sessionId: String(sessionId),
      shopId: options.shopId || 'default'
    });
    if (typeof waClient.sendVoiceNote === 'function') {
      return waClient.sendVoiceNote(to, audioBuffer, {
        ...options,
        mimeType
      });
    }
    return waClient.sendMediaMessage(to, audioBuffer, 'voice', 'zara_voice_note.ogg', '', options);
  }
}

export default WhatsAppAgentService;
