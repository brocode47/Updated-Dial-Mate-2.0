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

    const state = await ConversationStateService.getState(conversation.id);
    let activeProduct = await ConversationStateService.resolveActiveProduct(conversation.id);

    let activeOrder = recentOrder;
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

    const candidateProduct = activeProduct || (await ConversationStateService.resolveProductReference(conversation.id, messageText));
    const contextBefore = ConversationContextResolver.buildContextObject(state, ref, customer);

    // 9. Intent Resolution
    const detected = IntentResolver.resolveIntent(messageText, {
      activeProduct: candidateProduct,
      activeOrder,
      state,
      recentOrders: orders
    });

    await ConversationStateService.recordTurn(conversation.id, {
      sender: 'customer',
      text: messageText,
      intent: detected.intent
    });

    const storeName = shop.name || shop.domain.replace('.myshopify.com', '');
    const shouldGreet = await ConversationStateService.shouldGreet(conversation.id, conversation.messages ? conversation.messages.length : 0);

    let replyText = '';
    let executedAction = null;
    let usedLLM = false;

    // =========================================================================
    // 10. DETERMINISTIC ACTION DISPATCHER
    // =========================================================================

    // CASE A: Standalone Order Number Input (e.g. "123", "1643", "#1643")
    if (detected.intent === 'ORDER_NUMBER_INPUT') {
      executedAction = 'order_number_lookup';
      const orderNum = detected.orderNumber;
      const orderFound = await this.resolveOrderByNumber(shop.id, orderNum);

      if (orderFound) {
        activeOrder = orderFound;
        await ConversationStateService.setActiveOrder(conversation.id, orderFound);
        const cleanItem = ProductSummaryService.normalizeProductName(orderFound.items || 'item').customerFriendlyName;
        const status = orderFound.status || 'Pending Confirmation';

        if (/dispatch|transit|shipped|courier/i.test(status)) {
          replyText = `Ji, order #${orderFound.orderNumber} ${cleanItem} ka hai. Ye dispatch ho chuka hai aur courier ke paas hai. Expected delivery 3–5 working days hai.`;
        } else {
          replyText = `Ji, order #${orderFound.orderNumber} ${cleanItem} ka hai. Iska status "${status}" hai. Kul COD total Rs. ${Number(orderFound.totalAmount).toLocaleString()} hai.`;
        }
      } else {
        await ConversationStateService.updateState(conversation.id, {
          activeOrderNumber: orderNum,
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
      await ConversationStateService.updateState(conversation.id, { recentTopic: 'order' });

      const extracted = CheckoutStateMachine.extractCustomerInfo(messageText);
      const cleanMsg = messageText.toLowerCase();
      let productHint = null;
      if (cleanMsg.includes('chair') || cleanMsg.includes('cover')) productHint = 'chair';
      if (cleanMsg.includes('snoring') || cleanMsg.includes('dilator')) productHint = 'snoring';

      const orderLookup = await OrderResolver.resolveCustomerOrders({
        shopId: shop.id,
        fromPhone,
        customerName: extracted.name || customer?.firstName,
        city: extracted.city || customer?.city,
        address: extracted.address,
        productQuery: productHint,
        orderNumber: detected.orderNumber || null
      });

      if (orderLookup.found && !orderLookup.multiple) {
        const ord = orderLookup.order;
        activeOrder = ord;
        await ConversationStateService.setActiveOrder(conversation.id, ord);
        const cleanItem = ProductSummaryService.normalizeProductName(ord.items || 'item').customerFriendlyName;
        const status = ord.status || 'Pending Confirmation';

        if (/dispatch|transit|shipped|courier/i.test(status)) {
          replyText = `Ji, order #${ord.orderNumber} ${cleanItem} ka hai. Ye dispatch ho chuka hai aur courier ke paas hai. Expected delivery 3–5 working days hai.`;
        } else {
          replyText = `Aapke order #${ord.orderNumber} (${cleanItem}) ka current status "${status}" hai. Kul COD total Rs. ${Number(ord.totalAmount).toLocaleString()} hai.`;
        }
      } else if (orderLookup.found && orderLookup.multiple) {
        const list = orderLookup.orders.slice(0, 3).map(o => {
          const cleanItem = ProductSummaryService.normalizeProductName(o.items || 'item').customerFriendlyName;
          return `#${o.orderNumber} — ${cleanItem}`;
        }).join('\n');
        replyText = `Aapke ${orderLookup.count} orders record mein hain:\n\n${list}\n\nAap kis order ke baare mein maloomat chahtay hain?`;
        await ConversationStateService.setPendingAction(conversation.id, 'AWAITING_ORDER_NUMBER');
      } else {
        replyText = `Mujhe aapke number se koi order nahi mila. Kya aap apna order number (jaise #1643) share kar saktay hain taake main check kar sakoon?`;
        await ConversationStateService.setPendingAction(conversation.id, 'AWAITING_ORDER_NUMBER');
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
          await ConversationStateService.updateState(conversation.id, {
            activeOrderStatus: 'Cancelled',
            recentTopic: 'order'
          });
          replyText = `Aapka order #${targetOrder.orderNumber} cancel kar diya gaya hai. Agar aapko koi aur cheez dekhni ho to zaroor batayein.`;
        }
      } else {
        executedAction = 'product_rejected';
        await ConversationStateService.rejectProduct(conversation.id, activeProduct || null);
        replyText = `Theek hai, koi baat nahi! Agar aap kuch aur dekhna chahein to product ka naam ya category bata dein, main madad kar deti hoon.`;
      }
    }

    // CASE D: Product Rejection
    else if (detected.intent === 'PRODUCT_REJECTION') {
      executedAction = 'product_rejected';
      await ConversationStateService.rejectProduct(conversation.id, activeProduct || null);
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
      const targetOrder = activeOrder || recentOrder;
      if (targetOrder && (state?.recentTopic === 'order' || state?.activeOrderNumber || !activeProduct)) {
        if (IntentResolver.isNegated(messageText, 'confirm')) {
          replyText = `Aapka order confirm nahi kiya gaya hai. Agar aap cancel karna chahtay hain to reply "2" ya "Cancel" likhein.`;
        } else if (targetOrder.status === 'Confirmed') {
          replyText = `Aapka order #${targetOrder.orderNumber} pehle hi confirm ho chuka hai aur dispatch ke liye tayyar hai!`;
        } else {
          if (targetOrder.orderId) {
            await ToolDispatcher.dispatch('confirm_order', { orderId: targetOrder.orderId }, {
              shopDomain: shop.domain,
              orderId: targetOrder.orderId
            });
          }
          executedAction = 'confirm_order';
          await ConversationStateService.updateState(conversation.id, {
            activeOrderStatus: 'Confirmed',
            recentTopic: 'order'
          });
          const cleanItem = ProductSummaryService.normalizeProductName(targetOrder.items || 'item').customerFriendlyName;
          replyText = `Bohat shukriya! Aapka order #${targetOrder.orderNumber} — ${cleanItem} — confirm kar diya gaya hai aur jald dispatch kar diya jaye ga. Agar mazeed koi rehnumai chahiye ho to zaroor batayein.`;
        }
      } else if (activeProduct || candidateProduct) {
        executedAction = 'confirm_product_booking';
        const prod = activeProduct || candidateProduct;
        const checkoutResult = CheckoutStateMachine.processTurn(
          state.checkoutState || {},
          messageText,
          { activeProduct: prod, customer, senderPhone: cleanPhone }
        );

        const names = ProductSummaryService.normalizeProductName(prod.title);
        const quote = await DeliveryService.getDeliveryQuote({ shopDomain: shop.domain, subtotal: prod.numericPrice });
        const calc = DeliveryService.calculateTotal(prod.numericPrice, quote.deliveryCharge);

        await ConversationStateService.updateState(conversation.id, {
          checkoutState: checkoutResult.checkout,
          currentProduct: prod,
          activeProduct: prod,
          activeProductPrice: prod.numericPrice,
          activeDeliveryCharge: quote.deliveryCharge,
          activeProductTotal: calc.total,
          pendingAction: 'AWAITING_ADDRESS',
          recentTopic: 'product'
        });

        replyText = `Ji, aap *${names.customerFriendlyName}* (Rs. ${prod.numericPrice} + Rs. ${quote.deliveryCharge} delivery, kul total Rs. ${calc.total}) confirm karna chahte hain? Main aapka order book karne mein madad kar deti hoon. Baraye meharbani apna mukammal delivery address aur city share kar dein.`;
      } else {
        replyText = `Mujhe aapka koi pending order ya product nahi mila confirm karne ke liye. Agar aapke paas order number hai to zaroor batayein.`;
      }
    }

    // CASE F: Inbound Checkout Details (Address, Name, City)
    else if (
      state.recentTopic === 'checkout' ||
      state.pendingAction === 'COLLECTING_ADDRESS' ||
      state.pendingAction === 'AWAITING_ADDRESS' ||
      state.pendingAction === 'COLLECTING_CHECKOUT_DETAILS'
    ) {
      if (activeProduct) {
        executedAction = 'checkout_details_update';
        const checkoutResult = CheckoutStateMachine.processTurn(
          state.checkoutState || {},
          messageText,
          { activeProduct, customer, senderPhone: cleanPhone }
        );

        await ConversationStateService.updateState(conversation.id, {
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
            const searchRes = await ShopifyCatalogService.searchProducts(shop.domain, cleanQuery, { limit: 1 });
            prod = searchRes.products?.[0] || null;
            if (prod) {
              await ConversationStateService.setActiveProduct(conversation.id, prod);
            }
          }
        }
        if (prod) {
          executedAction = 'total_inquiry_fastpath';
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
      let prod = ref.entity || activeProduct || candidateProduct;
      if (!prod) {
        const cleanQuery = messageText
          .replace(/\b(ki\s*price|ka\s*rate|kitne\s*ka\s*hai|kitn[ey]\s*ka|price|rate|details|detail|batao|btao|bata\s*dein|hai|kya|mujhe|chahiye)\b/gi, '')
          .trim();
        if (cleanQuery) {
          const searchRes = await ShopifyCatalogService.searchProducts(shop.domain, cleanQuery, { limit: 1 });
          prod = searchRes.products?.[0] || null;
        }
      }
      if (prod) {
        executedAction = (ref.type === 'ORDINAL' || /\b(pehle|doosre|dusre|teesre|ye\s*wala|wo\s*wala|1st|2nd)\b/i.test(messageText)) ? 'ordinal_reference_resolution' : 'product_detail_resolution';
        const names = ProductSummaryService.normalizeProductName(prod.title);
        await ConversationStateService.setActiveProduct(conversation.id, prod);
        await ConversationStateService.updateState(conversation.id, {
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
      }
    }

    // CASE K: Product Inquiry (Keyword Catalog Search)
    else if (detected.intent === 'PRODUCT_INQUIRY') {
      executedAction = 'product_inquiry_complete';
      const cleanQuery = messageText
        .replace(/\b(mujhe|chahiye|chaiye|chahye|dikhao|batao|bhejo|hai|kya|aapke\s*paas|available|in\s*stock|stock|price|rate|kitne\s*ka|ki\s*price|ka\s*rate|details|detail|se\s*pareshani\s*hoti\s*hai|pareshani|masla|kitna|total|bata\s*dein)\b/gi, '')
        .trim();
      const targetQuery = cleanQuery || (candidateProduct ? candidateProduct.title : messageText);
      const searchRes = await ShopifyCatalogService.searchProducts(shop.domain, targetQuery, { limit: 1 });
      const foundProduct = searchRes.products?.[0] || candidateProduct;

      if (foundProduct) {
        const names = ProductSummaryService.normalizeProductName(foundProduct.title);
        const cleanSummary = ProductSummaryService.cleanProductSummary(foundProduct.title, foundProduct.description);
        await ConversationStateService.setActiveProduct(conversation.id, foundProduct);

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

        await ConversationStateService.markHumanEscalation(conversation.id, {
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
    } else if (detected.intent === 'SOCIAL_FRIENDSHIP') {
      executedAction = 'social_friendship';
      replyText = `Haha, bilkul! Main Sunday Bazaaar ki taraf se aapki digital dost hi hoon. Batayein main aaj aapki kya madad karoon?`;
    } else if (detected.intent === 'CONVERSATIONAL_CLARIFICATION') {
      executedAction = 'conversational_clarification';
      replyText = `Ji theek hai, aap aaram se check kar lein. Main yahin hoon jab bhi aapko zaroorat ho!`;
    } else if (detected.intent === 'COLLECTION') {
      executedAction = 'collection_view';
      replyText = `Sunday Bazaaar ke collections dekhne ke liye:\n🔗 https://sundaybazaaar.store/collections/kitchen-collections`;
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
      await ConversationStateService.updateState(conversation.id, { isClosed: true });
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
    if (!replyText) {
      try {
        const aiClient = getAIClient();
        const availableTools = [
          AITools.search_shopify_products,
          AITools.get_shopify_product_details,
          AITools.get_delivery_quote,
          AITools.get_shopify_collections,
          AITools.get_store_info,
          AITools.confirm_order,
          AITools.cancel_order,
          AITools.request_human_transfer
        ];

        const systemInstruction = (
`You are Zara, the courteous, intelligent AI customer support assistant for "${storeName}".
You are communicating with a customer in Pakistan on WhatsApp.
Speak natural, helpful Roman Urdu and English. Be concise, polite, and human-like.

Customer & Store Context:
- Store: ${storeName}
- Customer Phone: ${cleanPhone}
${activeOrder ? `- Active Order #${activeOrder.orderNumber} (Rs. ${activeOrder.totalAmount}) - Items: ${activeOrder.items} - Status: ${activeOrder.status}` : '- No active order.'}
${activeProduct ? `- Active/Discussed Product: ${activeProduct.title} (${activeProduct.formattedPrice}) - Link: ${activeProduct.url}` : '- No active product.'}
${state.rejectedProducts && state.rejectedProducts.length > 0 ? `- Rejected Products: ${state.rejectedProducts.map(p => p.title || p).join(', ')}` : ''}

CRITICAL OPERATING RULES:
1. Grounded Answers: Do NOT hallucinate order status or product prices.
2. Contextual Resolution: "iski", "iska", "ye" refers to ${activeProduct?.title || 'active product'}.
3. Human Assistance: If asked for real human or owner, call request_human_transfer.`
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

        const candidate = response.candidates?.[0];
        const functionCalls = candidate?.content?.parts?.filter(p => p.functionCall).map(p => p.functionCall) || [];

        if (functionCalls.length > 0) {
          const call = functionCalls[0];
          executedAction = call.name;
          const toolResult = await ToolDispatcher.dispatch(call.name, call.args || {}, {
            shopDomain: shop.domain,
            orderId: activeOrder?.orderId,
            customerPhone: cleanPhone,
            conversationId: conversation.id,
            activeProduct
          });

          if (call.name === 'search_shopify_products' && toolResult?.products?.length > 0) {
            const prod = toolResult.products[0];
            await ConversationStateService.setActiveProduct(conversation.id, prod);
            replyText = `Ji, *${prod.title}* available hai (${prod.formattedPrice}).\n🔗 ${prod.url}`;
          } else {
            replyText = toolResult?.message || `Ji, main samajh gayi hoon.`;
          }
        } else {
          replyText = (candidate?.content?.parts?.[0]?.text || '').trim();
        }
      } catch (geminiErr) {
        console.warn(`⚠️ [WhatsAppAgent] Gemini fallback note: ${geminiErr.message}.`);
        if (recentOrder || activeOrder) {
          const ord = recentOrder || activeOrder;
          replyText = `Ji, main Zara hoon ${storeName} se. Main aapke order #${ord.orderNumber} aur delivery details ke hawalay se madad ke liye hazir hoon! Aap kya poochna chahtay hain?`;
        } else {
          replyText = `Ji, main aapki request samajh gayi hoon. Kya aap mazeed details share kar sakte hain taake main sahi rehnumai kar sakoon?`;
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

    // Safe outbound dispatch
    try {
      if (isVoiceInbound) {
        console.log(`🎙️ [WhatsApp:VOICE_IN] Voice note received. Generating spoken voice response.`);
        const ttsResult = await TextToSpeechService.synthesize(plannedResponse.spokenText);
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
            await waClient.sendMessage(fromPhone, replyText, { quotedMessageId: messageId || undefined });
          }
        }
      } else {
        if (typeof waClient?.sendMessage === 'function') {
          await waClient.sendMessage(fromPhone, replyText, { quotedMessageId: messageId || undefined });
        }
      }
    } catch (sendErr) {
      console.warn(`⚠️ [WhatsAppAgent] Notice on sending WhatsApp message: ${sendErr.message}`);
    }

    // Telemetry Observability
    const contextAfter = ConversationContextResolver.buildContextObject(
      await ConversationStateService.getState(conversation.id),
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
      replyText
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

    return {
      success: true,
      replyText,
      intent: detected.intent,
      action: executedAction,
      usedLLM,
      spokenText: plannedResponse.spokenText,
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
