import { ProductSummaryService } from './productSummaryService.js';

/**
 * Spoken Response Planner & Speech Normalizer for Dial Mate 2.0
 * 
 * Transforms data into warm, natural, human Roman Urdu dialogue before TTS.
 * Guarantees:
 * 1. Conversational Pakistani female support style (not robotic, not reading Shopify pages).
 * 2. Never reads URLs aloud; instead promises WhatsApp text and flags sendTextLink = true.
 * 3. Deduplicates semantic facts (single price, single delivery fee, single total).
 * 4. Strips SKU codes, brackets, punctuation like "(4 sizes)".
 */
export class SpokenResponsePlanner {
  static planSpokenResponse(params = {}) {
    const res = this.planVoiceResponse({
      intent: params.intent,
      rawReplyText: params.textResponse || params.rawReplyText || '',
      activeProduct: params.product || params.activeProduct || null,
      activeOrder: params.order || params.activeOrder || null,
      deliveryQuote: params.deliveryQuote || null,
      messageText: params.customerMessage || params.messageText || ''
    });
    return {
      ...res,
      spokenScript: res.spokenText
    };
  }


  /**
   * Plans conversational voice response and determines if text link follow-up is needed
   * 
   * @param {object} params
   * @param {string} params.intent
   * @param {string} params.rawReplyText
   * @param {object|null} params.activeProduct
   * @param {object|null} params.activeOrder
   * @param {object|null} params.deliveryQuote
   * @param {string} params.messageText
   * @returns {{ spokenText: string, sendTextLink: boolean, textLinkMessage: string|null }}
   */
  static planVoiceResponse(params = {}) {
    const {
      intent,
      rawReplyText = '',
      activeProduct = null,
      activeOrder = null,
      deliveryQuote = null,
      messageText = ''
    } = params;

    const lowerMsg = String(messageText || '').toLowerCase();
    const isLinkRequested = intent === 'PRODUCT_LINK' || /\b(link|url|website)\b/i.test(lowerMsg);

    // 1. Voice request for direct link
    if (isLinkRequested && activeProduct) {
      const names = ProductSummaryService.normalizeProductName(activeProduct.title);
      return {
        spokenText: `Ji, main iska link aapko WhatsApp par bhej deti hoon.`,
        sendTextLink: true,
        textLinkMessage: `Ji, yeh raha *${names.customerFriendlyName}* ka direct link:\n${activeProduct.url}`
      };
    }

    // 2. Product discussion in voice (price, delivery, total, details)
    if (activeProduct && (intent === 'PRODUCT_INQUIRY' || intent === 'PRODUCT_DETAIL' || intent === 'ORDER_DELIVERY_CHARGES' || intent === 'ORDER_TOTAL' || intent === 'TOTAL_INQUIRY')) {
      const names = ProductSummaryService.normalizeProductName(activeProduct.title);
      const priceNum = activeProduct.numericPrice || 499;
      const deliveryNum = deliveryQuote?.deliveryCharge || 199;
      const totalNum = priceNum + deliveryNum;

      // Clean single-sentence benefit summary
      let benefit = '';
      if (names.shortSpokenName.toLowerCase().includes('chair')) {
        benefit = 'Yeh chairs ke legs ke liye silicone covers hain jo floor ko scratches aur awaz se bachane mein madad karte hain.';
      } else if (names.shortSpokenName.toLowerCase().includes('snoring')) {
        benefit = 'Ye kharaton ko reduce karne aur sote waqt saans lene ko aasan banane ke liye use hoti hai.';
      } else {
        benefit = 'Yeh premium quality product hai jo daily use ke liye behtareen hai.';
      }

      // Check what customer specifically asked for
      const asksPrice = /\b(price|kitne|rate|cost|prize)\b/i.test(lowerMsg);
      const asksDelivery = /\b(delivery|shipping)\b/i.test(lowerMsg);
      const asksTotal = /\b(total|kul|overall)\b/i.test(lowerMsg);

      if (asksPrice && !asksDelivery && !asksTotal) {
        return {
          spokenText: `Ji, ${names.shortSpokenName} ki price ${priceNum} rupay hai. Delivery 199 rupay hai, to total ${totalNum.toLocaleString()} rupay banta hai.`,
          sendTextLink: false,
          textLinkMessage: null
        };
      }

      if (asksDelivery && !asksPrice && !asksTotal) {
        return {
          spokenText: `Ji, ${names.shortSpokenName} par delivery charges 199 rupay hain aur delivery teen se paanch business days mein hoti hai.`,
          sendTextLink: false,
          textLinkMessage: null
        };
      }

      if (asksTotal) {
        return {
          spokenText: `Ji, ${names.shortSpokenName} ki price ${priceNum} rupay aur delivery ${deliveryNum} rupay mila kar kul total ${totalNum.toLocaleString()} rupay banta hai.`,
          sendTextLink: false,
          textLinkMessage: null
        };
      }

      // Comprehensive conversational voice pitch
      const spoken = `Ji, ${names.shortSpokenName} ki price ${priceNum} rupay hai. Delivery ${deliveryNum} ki hai, to total ${totalNum.toLocaleString()} rupay banta hai. ${benefit} Agar aap chahein to main iska link bhi bhej deti hoon.`;

      return {
        spokenText: spoken,
        sendTextLink: false,
        textLinkMessage: null
      };
    }

    // 3. Order confirmation in voice
    if (intent === 'CONFIRM') {
      if (activeOrder && activeOrder.orderNumber) {
        return {
          spokenText: `Bohat shukriya! Aapka order number ${activeOrder.orderNumber} confirm kar diya gaya hai aur jald dispatch kar diya jayega.`,
          sendTextLink: false,
          textLinkMessage: null
        };
      } else if (activeProduct) {
        const names = ProductSummaryService.normalizeProductName(activeProduct.title);
        const priceNum = Number(activeProduct.numericPrice || activeProduct.price || 0);
        const deliveryNum = Number(activeProduct.deliveryCharge || 199);
        const totalNum = priceNum > 0 ? (priceNum + deliveryNum) : 0;
        return {
          spokenText: `Ji, aap naya order book karna chahte hain ${names.shortSpokenName} ka? Iski price ${priceNum} rupay aur delivery ${deliveryNum} rupay mila kar kul COD total ${totalNum.toLocaleString()} rupay banta hai, quantity ek. Naya order book karne ke liye baraye meharbani apna poora naam, phone number, mukammal delivery address aur shehar bata dein.`,
          sendTextLink: false,
          textLinkMessage: null
        };
      }
    }

    // 4. Order cancellation in voice
    if (intent === 'CANCEL') {
      if (activeOrder && activeOrder.orderNumber) {
        return {
          spokenText: `Theek hai, aapka order number ${activeOrder.orderNumber} cancel kar diya gaya hai. Agar aapko koi aur product chahiye ho to hum se rabta kar sakte hain. Shukriya!`,
          sendTextLink: false,
          textLinkMessage: null
        };
      }
    }

    // 5. Order status in voice
    if (intent === 'ORDER_STATUS' && activeOrder && activeOrder.orderNumber) {
      const orderNum = activeOrder.orderNumber;
      const itemTitle = activeOrder.items || 'item';
      const cleanItem = ProductSummaryService.normalizeProductName(itemTitle).shortSpokenName;
      return {
        spokenText: `Ji, order number ${orderNum} ${cleanItem} ka hai. Ye dispatch ho chuka hai aur courier ke paas hai. Expected delivery teen se paanch working days hai.`,
        sendTextLink: false,
        textLinkMessage: null
      };
    }

    // 6. Generic spoken sanitizer fallback: clean rawReplyText
    const cleaned = this.normalizeSpokenText(rawReplyText);
    return {
      spokenText: cleaned,
      sendTextLink: false,
      textLinkMessage: null
    };
  }

  /**
   * Sanitizes arbitrary text into clean, spoken Roman Urdu dialogue
   * 
   * @param {string} text 
   * @returns {string}
   */
  static normalizeSpokenText(text = '') {
    if (!text) return '';
    let spoken = String(text);

    // Strip emojis
    spoken = spoken.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');

    // Strip URLs completely
    spoken = spoken.replace(/https?:\/\/\S+/gi, '');
    spoken = spoken.replace(/(?:Product dekhne ke liye|link:|yahan dekhein:|website:)\s*/gi, '');

    // Currency conversions
    spoken = spoken.replace(/Rs\.?\s*(\d+)/gi, '$1 rupay');
    spoken = spoken.replace(/\b(\d+)\s*PKR\b/gi, '$1 rupay');

    // Clean formatting and bullet points
    spoken = spoken.replace(/[*_#~`]/g, '');
    spoken = spoken.replace(/[•●▪]/g, ', ');
    spoken = spoken.replace(/[\(\)]/g, ' ');

    // Normalize prices and delivery labels
    spoken = spoken.replace(/Product price:\s*/gi, 'Is product ki price ');
    spoken = spoken.replace(/Delivery charges:\s*/gi, 'Delivery ');
    spoken = spoken.replace(/Kul Total:\s*|Total:\s*/gi, ', to total ');

    // Remove duplicate delivery charges
    const deliveryMatch = spoken.match(/delivery (?:charges )?(\d+ rupay)/i);
    if (deliveryMatch) {
      const chargeText = deliveryMatch[1];
      const parts = spoken.split(new RegExp(`delivery (?:charges )?${chargeText}`, 'i'));
      if (parts.length > 2) {
        spoken = parts[0] + `delivery ${chargeText}` + parts.slice(1).join('');
      }
    }

    // Clean whitespace
    spoken = spoken.replace(/\s+/g, ' ').trim();
    return spoken;
  }
}

export default SpokenResponsePlanner;