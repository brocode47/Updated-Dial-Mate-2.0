import { SpokenResponsePlanner } from './spokenResponsePlanner.js';
import { ProductSummaryService } from './productSummaryService.js';

/**
 * Centralized, Modality-Aware Response Planner for Dial Mate 2.0 / Zara
 */
export class ResponsePlanner {
  /**
   * Plans the text and spoken response for a given conversational turn
   *
   * @param {object} params
   * @returns {{ textReply: string, spokenText: string, sendTextLink?: boolean, textLinkMessage?: string, executedAction?: string }}
   */
  static planResponse(params = {}) {
    const {
      intent,
      resolvedEntity,
      context = {},
      userMessage = '',
      isVoiceInbound = false,
      extra = {}
    } = params;

    let textReply = '';
    let executedAction = extra.executedAction || intent;

    switch (intent) {
      case 'PRODUCT_DETAIL':
      case 'ORDINAL_REFERENCE':
      case 'PRODUCT_PRICE': {
        const prod = resolvedEntity?.entity || context.activeProduct;
        if (prod) {
          const names = ProductSummaryService.normalizeProductName(prod.title);
          const price = prod.numericPrice || prod.price;
          if (/\b(link|url)\b/i.test(userMessage) && prod.url) {
            textReply = `Ji, yeh raha direct link:\n🔗 ${prod.url}`;
          } else if (extra.defaultReply) {
            textReply = extra.defaultReply;
          } else {
            textReply = `Ji, *${names.customerFriendlyName}* ki price Rs. ${price} hai.`;
          }
        } else {
          textReply = extra.defaultReply || `Aap kis product ki price maloom karna chahtay hain? Product ka naam bata dein.`;
        }
        break;
      }

      case 'DELIVERY_INQUIRY': {
        const prod = resolvedEntity?.entity || context.activeProduct;
        const fee = prod?.deliveryCharge || 199;
        if (prod) {
          const names = ProductSummaryService.normalizeProductName(prod.title);
          textReply = `Ji, *${names.customerFriendlyName}* ke delivery charges Rs. ${fee} hain (tamam Pakistan mein 3–5 working days).`;
        } else {
          textReply = `Hamare standard delivery charges Rs. ${fee} hain tamam Pakistan mein.`;
        }
        break;
      }

      case 'TOTAL_INQUIRY': {
        const prod = resolvedEntity?.entity || context.activeProduct;
        if (prod) {
          const names = ProductSummaryService.normalizeProductName(prod.title);
          const price = Number(prod.numericPrice || prod.price || 0);
          const delivery = Number(prod.deliveryCharge || 199);
          const total = price + delivery;
          textReply = `Ji, *${names.customerFriendlyName}* ki price Rs. ${price} aur delivery Rs. ${delivery} mila kar kul total Rs. ${total} banta hai.`;
        } else {
          textReply = `Delivery charges Rs. 199 hain. Aap kis product ka total bill maloom karna chahtay hain?`;
        }
        break;
      }

      case 'PRODUCT_LINK': {
        const prod = resolvedEntity?.entity || context.activeProduct;
        if (prod && prod.url) {
          textReply = `Ji, yeh raha direct link:\n🔗 ${prod.url}`;
        } else {
          textReply = `Aap hamari website yahan visit kar saktay hain:\n🔗 https://sundaybazaaar.store`;
        }
        break;
      }

      case 'ORDER_PRICE': {
        const ord = resolvedEntity?.entity || context.activeOrder;
        if (ord) {
          textReply = `Order #${ord.orderNumber} ka total bill Rs. ${Number(ord.totalAmount).toLocaleString()} hai (delivery charges Rs. ${ord.shippingFee || 199} shamil hain).`;
        }
        break;
      }

      case 'CONFIRM_NEGATED': {
        textReply = `Theek hai, order confirm nahi kiya gaya. Jab bhi aapka irada ho, aap batayein to main confirm kar doon gi.`;
        break;
      }

      case 'CANCEL_NEGATED': {
        textReply = `Theek hai, aapka order cancel nahi kiya gaya hai aur confirmed hi rahe ga.`;
        break;
      }

      case 'OWNER_INFO': {
        textReply = `Sunday Bazaaar Official hamari management team operate karti hai. Main Zara hoon, unki official AI customer support representative. Main aapki kis cheez mein madad kar sakti hoon?`;
        break;
      }

      case 'BOT_IDENTITY': {
        textReply = `Mera naam Zara hai aur main Sunday Bazaaar ki official customer support representative hoon. Main aapki orders, delivery aur product details mein madad ke liye hazir hoon!`;
        break;
      }

      case 'SOCIAL_CLOSING': {
        textReply = `Allah Hafiz! Apna khayal rakhiye ga. Agar ainda koi bhi zaroorat ho to hum hazir hain!`;
        break;
      }

      case 'SOCIAL_THANKYOU': {
        textReply = `Aapka bohat shukriya! Agar mazeed kisi cheez mein madad chahiye ho to zaroor batayein.`;
        break;
      }

      case 'SOCIAL_CASUAL': {
        if (/girlfriend/i.test(userMessage)) {
          textReply = `Aray, girlfriend ko manana to bohat zaroori hai! Koi acha sa gift ya unki pasand ki cheez dekh lein, mood foran theek ho jaye ga. Agar aap hamare store se kuch dekhna chahein to batayein!`;
        } else {
          textReply = `Main bilkul theek hoon, shukriya! Aap sunayein, main aapki kya madad kar sakti hoon?`;
        }
        break;
      }

      default: {
        textReply = extra.defaultReply || `Ji, main samajh gayi hoon. Kya aap mazeed details bata saktay hain?`;
      }
    }

    // Voice Plan
    const voicePlan = SpokenResponsePlanner.planSpokenResponse({
      textResponse: textReply,
      intent,
      activeProduct: context.activeProduct || null,
      activeOrder: context.activeOrder || null,
      customerName: context.customer?.name || null,
      messageText: userMessage
    });

    if ((intent === 'PRODUCT_LINK' || /\b(link|url)\b/i.test(userMessage)) && context.activeProduct && context.activeProduct.url) {
      voicePlan.sendTextLink = true;
      voicePlan.textLinkMessage = `Ji, yeh raha *${context.activeProduct.title}* ka direct link:\n🔗 ${context.activeProduct.url}`;
    }

    return {
      textReply,
      spokenText: voicePlan.spokenText || voicePlan.spokenScript || voicePlan.spokenDialogue || textReply,
      sendTextLink: voicePlan.sendTextLink,
      textLinkMessage: voicePlan.textLinkMessage,
      executedAction
    };
  }

  /**
   * Structured Turn Telemetry Observability logger
   */
  static logTurnTelemetry(telemetry = {}) {
    try {
      console.log('📊 [TURN_TELEMETRY]', JSON.stringify({
        timestamp: new Date().toISOString(),
        modality: telemetry.modality || 'text',
        inboundMessage: telemetry.inboundMessage || '',
        transcript: telemetry.transcript || null,
        contextBefore: {
          topic: telemetry.contextBefore?.activeTopic || null,
          product: telemetry.contextBefore?.activeProduct?.title || null,
          order: telemetry.contextBefore?.activeOrder?.orderNumber || null
        },
        resolvedIntent: telemetry.resolvedIntent || null,
        confidence: telemetry.confidence || null,
        resolvedEntity: telemetry.resolvedEntity?.entityType || 'NONE',
        entityId: telemetry.resolvedEntity?.entity?.id || telemetry.resolvedEntity?.entity?.orderNumber || null,
        actionExecuted: telemetry.actionExecuted || null,
        contextAfter: {
          topic: telemetry.contextAfter?.activeTopic || null,
          product: telemetry.contextAfter?.activeProduct?.title || null,
          order: telemetry.contextAfter?.activeOrder?.orderNumber || null
        },
        outboundModality: telemetry.outboundModality || 'text',
        replyLength: telemetry.replyText?.length || 0
      }));
    } catch (_) {}
  }
}

export default ResponsePlanner;
