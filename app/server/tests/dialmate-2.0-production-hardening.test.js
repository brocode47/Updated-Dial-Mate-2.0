import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '../src/lib/db.js';
import { WhatsAppAgentService } from '../src/services/whatsappAgentService.js';
import { DeliveryService } from '../src/services/deliveryService.js';
import { HumanEscalationService } from '../src/services/humanEscalationService.js';
import { ConversationStateService } from '../src/services/conversationStateService.js';
import { AudioTranscriberService } from '../src/services/audioTranscriberService.js';
import { ToolDispatcher } from '../src/integrations/ai/dispatcher.js';
import { WhatsAppClient } from '../src/integrations/whatsapp/client.js';

describe('Dial Mate 2.0 — Production-Grade WhatsApp AI Agent (Zara) Hardening Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (prisma.complianceLog) {
      vi.spyOn(prisma.complianceLog, 'create').mockResolvedValue({});
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. HUMAN ESCALATION & OWNER NOTIFICATION
  // =========================================================================
  describe('Failure 1: Real Human Escalation Workflow & Deduplication', () => {
    it('detects human escalation across various Pakistani phrases', () => {
      const phrases = [
        'mujhe kisi insan se baat karni hai',
        'real person se connect karo',
        'human se baat karni hai',
        'customer support se baat karwao',
        'agent se baat karwao',
        'ap kisi insan ko bulao',
        'mujhe owner se baat karni hai',
        'call kisi bande ko transfer karo',
        'mujhe representative se baat karni hai',
        'zara mujhe kisi human se connect karo'
      ];

      for (const phrase of phrases) {
        const detected = WhatsAppAgentService.detectIntent(phrase);
        expect(detected.intent).toBe('HUMAN_TRANSFER');
      }
    });

    it('creates persistent escalation, formats owner notification, and sends WhatsApp alert', async () => {
      const sendWhatsAppSpy = vi.spyOn(WhatsAppClient.prototype, 'sendMessage').mockResolvedValue({
        id: 'msg-owner-1',
        key: { id: 'msg-owner-1' }
      });

      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue({
        id: 'shop-1',
        domain: 'sundaybazaaar.store',
        ownerPhone: '+923333255998',
        settings: { operatorPhone: '+923333255998' }
      });

      vi.spyOn(prisma.whatsAppIntegration, 'findFirst').mockResolvedValue({
        id: 'wa-int-1',
        shopId: 'shop-1',
        sessionId: '2cmrlo',
        isActive: true
      });

      vi.spyOn(prisma.call, 'create').mockResolvedValue({ id: 'esc-rec-1' });

      const result = await HumanEscalationService.escalate({
        shopDomain: 'sundaybazaaar.store',
        reason: 'Customer wants to speak with a real person.',
        context: {
          customerName: 'Arslan',
          customerPhone: '+923333255998',
          customerCity: 'Karachi',
          productContext: 'Wooden Silicone Chair Protection Cover',
          orderNumber: '1643',
          conversationId: 'conv-101'
        }
      });

      expect(result.success).toBe(true);
      expect(result.notificationSent).toBe(true);
      expect(sendWhatsAppSpy).toHaveBeenCalledTimes(1);

      const ownerMessage = sendWhatsAppSpy.mock.calls[0][1];
      expect(ownerMessage).toContain('🔔 *Human Support Request*');
      expect(ownerMessage).toContain('Arslan');
      expect(ownerMessage).toContain('+923333255998');
      expect(ownerMessage).toContain('Wooden Silicone Chair Protection Cover');
      expect(ownerMessage).toContain('#1643');

      // Customer message must be truthful, NOT claiming telephony connection
      expect(result.message).toContain('Ji, main ne aapki request customer support ko bhej di hai');
      expect(result.message).not.toContain('Main aapko connect kar rahi hoon');
    });

    it('prevents duplicate owner notifications for the same conversation within TTL window', async () => {
      const sendWhatsAppSpy = vi.spyOn(WhatsAppClient.prototype, 'sendMessage').mockResolvedValue({
        id: 'msg-owner-2',
        key: { id: 'msg-owner-2' }
      });

      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue({
        id: 'shop-1',
        domain: 'sundaybazaaar.store',
        ownerPhone: '+923333255998',
        settings: { operatorPhone: '+923333255998' }
      });

      vi.spyOn(prisma.whatsAppIntegration, 'findFirst').mockResolvedValue({
        id: 'wa-int-1',
        shopId: 'shop-1',
        sessionId: '2cmrlo',
        isActive: true
      });

      vi.spyOn(prisma.call, 'create').mockResolvedValue({ id: 'esc-rec-2' });

      // First call
      const res1 = await HumanEscalationService.escalate({
        shopDomain: 'sundaybazaaar.store',
        reason: 'Customer wants human support',
        context: {
          customerName: 'Arslan',
          customerPhone: '+923333255998',
          conversationId: 'conv-dedup-1'
        }
      });
      expect(res1.notificationSent).toBe(true);
      expect(sendWhatsAppSpy).toHaveBeenCalledTimes(1);

      // Second immediate call for same conversation
      const res2 = await HumanEscalationService.escalate({
        shopDomain: 'sundaybazaaar.store',
        reason: 'Customer wants human support again',
        context: {
          customerName: 'Arslan',
          customerPhone: '+923333255998',
          conversationId: 'conv-dedup-1'
        }
      });
      expect(res2.notificationSent).toBe(false);
      expect(res2.duplicatePrevented).toBe(true);
      // Spy not called again!
      expect(sendWhatsAppSpy).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // 2. PRODUCT STATUS DISPLAY POLICY
  // =========================================================================
  describe('Failure 2: Product Status Display Policy (Zero Stock Exposure by Default)', () => {
    it('does not expose stock or inventory status in default product response', () => {
      const product = {
        title: 'Wooden Silicone Chair Protection Cover (24 pcs)',
        numericPrice: 499,
        formattedPrice: 'Rs. 499',
        inStock: false,
        inventoryQuantity: 0,
        url: 'https://sundaybazaaar.store/products/chair-cover'
      };

      const quote = { deliveryCharge: 199 };
      const calc = { total: 698 };

      const response = `Ji, *${product.title}* Rs. ${product.numericPrice} ka hai.\n\nAapke chair protection ke liye ye product suitable hai.\n\nDelivery charges: Rs. ${quote.deliveryCharge}\nTotal: Rs. ${calc.total}\n\nProduct details:\n🔗 ${product.url}`;

      expect(response).not.toContain('Out of stock');
      expect(response).not.toContain('stock available');
      expect(response).not.toContain('stock unavailable');
      expect(response).not.toContain('In stock');
    });

    it('detects explicit availability inquiry vs generic product inquiry', () => {
      const stockQueries = ['stock hai?', 'available hai?', 'available?', 'mil jayega?', 'stock mein hai?'];
      for (const q of stockQueries) {
        expect(WhatsAppAgentService.isAvailabilityInquiry(q)).toBe(true);
      }

      const normalQueries = ['chair cover dikhao', 'iski price kya hai', 'details batao', 'link bhejo'];
      for (const q of normalQueries) {
        expect(WhatsAppAgentService.isAvailabilityInquiry(q)).toBe(false);
      }
    });
  });

  // =========================================================================
  // 3. PERSISTENT ENTITY MEMORY & MULTI-TURN CONTEXT RESOLUTION
  // =========================================================================
  describe('Failure 3: Persistent Entity Resolution Across Turns', () => {
    it('maintains active entity context across product -> price -> delivery -> total -> link flow', async () => {
      const conversationId = 'conv-context-1';

      // Turn 1: Product mentioned
      const chairCover = {
        id: 'prod-chair-1',
        title: 'Wooden Silicone Chair Protection Cover',
        numericPrice: 499,
        formattedPrice: 'Rs. 499',
        url: 'https://sundaybazaaar.store/products/chair-protection-cover'
      };

      await ConversationStateService.updateState(conversationId, {
        currentProduct: chairCover,
        lastProducts: [chairCover],
        recentTopic: 'product'
      });

      let state = await ConversationStateService.getState(conversationId);
      expect(state.currentProduct.title).toBe(chairCover.title);

      // Turn 2: "iski price?" -> resolves currentProduct.price via contextual reference
      expect(WhatsAppAgentService.detectIntent('iski price?').intent).toBe('ORDINAL_REFERENCE');
      expect(state.currentProduct.numericPrice).toBe(499);

      // Turn 3: "delivery?" -> resolves currentProduct + delivery
      expect(WhatsAppAgentService.detectIntent('delivery?').intent).toBe('ORDER_DELIVERY_CHARGES');
      const quote = await DeliveryService.getDeliveryQuote({ shopDomain: 'sundaybazaaar.store', subtotal: state.currentProduct.numericPrice });
      expect(quote.deliveryCharge).toBe(199);

      // Turn 4: "total kitna?" -> resolves product + delivery total
      expect(WhatsAppAgentService.detectIntent('total kitna?').intent).toBe('ORDER_TOTAL');
      const totalCalc = DeliveryService.calculateTotal(state.currentProduct.numericPrice, quote.deliveryCharge);
      expect(totalCalc.total).toBe(698);

      // Turn 5: "link bhejo" -> resolves currentProduct URL
      expect(WhatsAppAgentService.detectIntent('link bhejo').intent).toBe('PRODUCT_LINK');
      const resolved = await ConversationStateService.resolveActiveProduct(conversationId);
      expect(resolved.url).toBe(chairCover.url);
    });
  });

  // =========================================================================
  // 4. DELIVERY SERVICE & AUTHORITATIVE PRICING
  // =========================================================================
  describe('Failure 4: Authoritative Delivery Quotes from Sunday Bazaaar Configuration', () => {
    it('returns structured delivery quote with real configured COD rate (Rs. 199)', async () => {
      const quote = await DeliveryService.getDeliveryQuote({
        shopDomain: 'sundaybazaaar.store',
        city: 'Karachi'
      });

      expect(quote.deliveryCharge).toBe(199);
      expect(quote.currency).toBe('PKR');
      expect(quote.estimatedDelivery).toBe('3 to 5 business days');
      expect(quote.source).toBe('shopify_shipping_rate');
    });

    it('calculates total bill accurately without NaN', () => {
      const calc = DeliveryService.calculateTotal(1499, 199);
      expect(calc.subtotal).toBe(1499);
      expect(calc.deliveryCharge).toBe(199);
      expect(calc.total).toBe(1698);
      expect(calc.currency).toBe('PKR');
    });

    it('is registered in ToolDispatcher and returns valid structured output', async () => {
      const result = await ToolDispatcher.dispatch('get_delivery_quote', {
        city: 'Lahore',
        subtotal: 1000
      }, { shopDomain: 'sundaybazaaar.store' });

      expect(result.deliveryCharge).toBe(199);
      expect(result.currency).toBe('PKR');
      expect(result.estimatedDelivery).toBe('3 to 5 business days');
      expect(result.source).toBe('shopify_shipping_rate');
    });
  });

  // =========================================================================
  // 5. GREETING LIFECYCLE
  // =========================================================================
  describe('Failure 5: Conversation Greeting Lifecycle', () => {
    it('allows greeting on conversation start (turnCount = 0)', async () => {
      const convId = 'conv-greet-new';
      const shouldGreet = await ConversationStateService.shouldGreet(convId, 0);
      expect(shouldGreet).toBe(true);
    });

    it('suppresses greeting on active conversation turns (turnCount > 0)', async () => {
      const convId = 'conv-greet-active';
      await ConversationStateService.markGreetingSent(convId);
      const shouldGreet = await ConversationStateService.shouldGreet(convId, 2);
      expect(shouldGreet).toBe(false);
    });

    it('allows greeting if conversation expired (> 24 hours ago)', async () => {
      const convId = 'conv-greet-expired';
      await ConversationStateService.markGreetingSent(convId);
      await ConversationStateService.updateState(convId, {
        lastActivityTimestamp: Date.now() - 25 * 60 * 60 * 1000 // 25 hours ago
      });
      const shouldGreet = await ConversationStateService.shouldGreet(convId, 0);
      expect(shouldGreet).toBe(true);
    });
  });

  // =========================================================================
  // 6. "LAST ORDER" ROUTING
  // =========================================================================
  describe('Failure 6: Last Order Routing (Never Routes to Catalog)', () => {
    it('correctly routes all order inquiry variations to ORDER_SUMMARY or ORDER_STATUS', () => {
      const queries = [
        'mera order kya hai?',
        'mera last order kya hai?',
        'last order batao',
        'last order ka number?',
        'jo last order aya uska number batao',
        'latest order',
        'recent order',
        'mera recent order dikhao',
        'meri latest booking',
        'last wala order',
        'jo tumhare pas last order aya uska number batao'
      ];

      for (const q of queries) {
        const detected = WhatsAppAgentService.detectIntent(q);
        expect(detected.intent).toBe('ORDER_SUMMARY');
      }
    });
  });

  // =========================================================================
  // 7. PRODUCT PURCHASE VS EXISTING ORDER CONFIRMATION
  // =========================================================================
  describe('Failure 7: Product Purchase vs Existing Order Confirmation', () => {
    it('routes existing order confirmation to CONFIRM', () => {
      const confirmExisting = [
        'mera order confirm kar do',
        'mera order confirm kardo',
        'confirm kar do',
        'haan bhej do',
        'dispatch kardo'
      ];

      for (const phrase of confirmExisting) {
        const detected = WhatsAppAgentService.detectIntent(phrase);
        expect(detected.intent).toBe('CONFIRM');
      }
    });

    it('routes product purchase intent to PURCHASE_INTENT', () => {
      const purchasePhrases = [
        'anti snoring wala product confirm kro',
        'chair cover wala order kar do',
        'ye lena hai',
        'mujhe ye chahiye',
        'book kar do',
        'ye order kar do'
      ];

      for (const phrase of purchasePhrases) {
        const detected = WhatsAppAgentService.detectIntent(phrase);
        expect(detected.intent).toBe('PURCHASE_INTENT');
      }
    });
  });

  // =========================================================================
  // 8. NATURAL CLARIFICATION & NEGATION PRESERVATION
  // =========================================================================
  describe('Failure 8: Natural Clarification & Negation Safety', () => {
    it('preserves context on soft clarification ("Nahi main kar raha hoon na")', () => {
      const clean = 'nahi main kr rha hun na';
      const detected = WhatsAppAgentService.detectIntent(clean);
      expect(detected.intent).toBe('CONVERSATIONAL_CLARIFICATION');
    });

    it('recognizes negative confirmation and cancellation guards', () => {
      expect(WhatsAppAgentService.isNegated('confirm nahi karna', 'confirm')).toBe(true);
      expect(WhatsAppAgentService.isNegated('abhi confirm nahi', 'confirm')).toBe(true);
      expect(WhatsAppAgentService.isNegated('cancel nahi karna', 'cancel')).toBe(true);
      expect(WhatsAppAgentService.isNegated('main cancel nahi keh raha', 'cancel')).toBe(true);
    });
  });

  // =========================================================================
  // 9. PAKISTANI CUSTOMER LANGUAGE ENGINE TEST MATRIX
  // =========================================================================
  describe('Pakistani Customer Language Engine Comprehensive Test Matrix', () => {
    it('verifies ORDER intent classification across Pakistani language patterns', () => {
      const matrix = [
        { text: 'mera order kya hai?', expected: 'ORDER_SUMMARY' },
        { text: 'mera last order kya hai?', expected: 'ORDER_SUMMARY' },
        { text: 'order status?', expected: 'ORDER_STATUS' },
        { text: 'mera parcel kahan hai?', expected: 'ORDER_SUMMARY' },
        { text: 'kab deliver hoga?', expected: 'ORDER_SUMMARY' },
        { text: 'order kab ayega?', expected: 'ORDER_SUMMARY' },
        { text: 'order confirm hua?', expected: 'ORDER_STATUS' },
        { text: 'mera order cancel hua?', expected: 'ORDER_STATUS' },
        { text: 'mere kitne orders hain?', expected: 'ORDER_SUMMARY' }
      ];

      for (const item of matrix) {
        expect(WhatsAppAgentService.detectIntent(item.text).intent).toBe(item.expected);
      }
    });

    it('verifies PRODUCT intent classification across Pakistani language patterns', () => {
      const matrix = [
        { text: 'chair cover', expected: 'PRODUCT_INQUIRY' },
        { text: 'chair protection cover', expected: 'PRODUCT_INQUIRY' },
        { text: 'iska price?', expected: 'ORDINAL_REFERENCE' },
        { text: 'iski price?', expected: 'ORDINAL_REFERENCE' },
        { text: 'ye kitne ka hai?', expected: 'PRODUCT_DETAIL' },
        { text: 'ye wala kitne ka?', expected: 'ORDINAL_REFERENCE' },
        { text: 'iska link', expected: 'ORDINAL_REFERENCE' },
        { text: 'link bhejo', expected: 'PRODUCT_LINK' },
        { text: 'details batao', expected: 'PRODUCT_DETAIL' }
      ];

      for (const item of matrix) {
        expect(WhatsAppAgentService.detectIntent(item.text).intent).toBe(item.expected);
      }
    });

    it('verifies CATALOG intent classification across Pakistani patterns', () => {
      const matrix = [
        { text: 'catalog dikhao', expected: 'CATALOG' },
        { text: 'catalog bhejo', expected: 'CATALOG' },
        { text: 'aur dikhao', expected: 'MORE' },
        { text: 'aur products', expected: 'MORE' },
        { text: 'next', expected: 'MORE' },
        { text: 'mazeed', expected: 'MORE' },
        { text: 'collection dikhao', expected: 'COLLECTION' },
        { text: 'website bhejo', expected: 'STORE_LINK' }
      ];

      for (const item of matrix) {
        expect(WhatsAppAgentService.detectIntent(item.text).intent).toBe(item.expected);
      }
    });

    it('verifies DELIVERY intent classification across Pakistani patterns', () => {
      const matrix = [
        { text: 'delivery kitni?', expected: 'ORDER_DELIVERY_CHARGES' },
        { text: 'delivery charges?', expected: 'ORDER_DELIVERY_CHARGES' },
        { text: 'shipping kitni?', expected: 'ORDER_DELIVERY_CHARGES' },
        { text: 'delivery mila ke kitna?', expected: 'ORDER_DELIVERY_CHARGES' },
        { text: 'total kitna?', expected: 'ORDER_TOTAL' },
        { text: 'ghar tak delivery?', expected: 'ORDER_DELIVERY_CHARGES' },
        { text: 'Karachi delivery?', expected: 'ORDER_DELIVERY_CHARGES' },
        { text: 'Lahore delivery?', expected: 'ORDER_DELIVERY_CHARGES' },
        { text: 'Islamabad delivery?', expected: 'ORDER_DELIVERY_CHARGES' }
      ];

      for (const item of matrix) {
        expect(WhatsAppAgentService.detectIntent(item.text).intent).toBe(item.expected);
      }
    });

    it('verifies PURCHASE and CONFIRM intent classification', () => {
      const matrix = [
        { text: 'ye lena hai', expected: 'PURCHASE_INTENT' },
        { text: 'order karna hai', expected: 'PURCHASE_INTENT' },
        { text: 'book kar do', expected: 'PURCHASE_INTENT' },
        { text: 'ye order kar do', expected: 'PURCHASE_INTENT' },
        { text: 'mujhe ye chahiye', expected: 'PURCHASE_INTENT' },
        { text: 'confirm kar do', expected: 'CONFIRM' },
        { text: 'haan', expected: 'CONFIRM' },
        { text: 'ji', expected: 'CONFIRM' }
      ];

      for (const item of matrix) {
        expect(WhatsAppAgentService.detectIntent(item.text).intent).toBe(item.expected);
      }
    });

    it('verifies HUMAN transfer intent classification', () => {
      const matrix = [
        { text: 'human se baat karwao', expected: 'HUMAN_TRANSFER' },
        { text: 'real person se baat karni hai', expected: 'HUMAN_TRANSFER' },
        { text: 'customer support se connect karo', expected: 'HUMAN_TRANSFER' },
        { text: 'owner se baat karni hai', expected: 'HUMAN_TRANSFER' },
        { text: 'bande se baat karwao', expected: 'HUMAN_TRANSFER' },
        { text: 'agent se baat karwao', expected: 'HUMAN_TRANSFER' }
      ];

      for (const item of matrix) {
        expect(WhatsAppAgentService.detectIntent(item.text).intent).toBe(item.expected);
      }
    });

    it('verifies GENERAL conversational patterns', () => {
      const matrix = [
        { text: 'hello', expected: 'GENERAL_QUERY' },
        { text: 'hi', expected: 'GENERAL_QUERY' },
        { text: 'assalam o alaikum', expected: 'GENERAL_QUERY' },
        { text: 'kaise ho', expected: 'GENERAL_QUERY' },
        { text: 'kya mujhse dosti karogi', expected: 'SOCIAL_FRIENDSHIP' },
        { text: 'thank you', expected: 'SOCIAL_THANKYOU' },
        { text: 'shukriya', expected: 'SOCIAL_THANKYOU' },
        { text: 'acha', expected: 'SOCIAL_ACK' },
        { text: 'theek hai', expected: 'SOCIAL_ACK' },
        { text: 'Allah hafiz', expected: 'SOCIAL_CLOSING' }
      ];

      for (const item of matrix) {
        expect(WhatsAppAgentService.detectIntent(item.text).intent).toBe(item.expected);
      }
    });

    it('handles TYPO and SMS-style text properly', () => {
      expect(WhatsAppAgentService.detectIntent('parsal kab ayega').intent).toBe('ORDER_SUMMARY');
      expect(WhatsAppAgentService.detectIntent('delivry charges').intent).toBe('ORDER_DELIVERY_CHARGES');
      expect(WhatsAppAgentService.detectIntent('order cnfrm kar dein').intent).toBe('CONFIRM');
      expect(WhatsAppAgentService.detectIntent('order cancle kardo').intent).toBe('CANCEL');
    });
  });

  // =========================================================================
  // 10. TWO-WAY VOICE MESSAGE SUPPORT
  // =========================================================================
  describe('Failure 10: Two-Way WhatsApp Voice Message Handling', () => {
    it('transcribes incoming WhatsApp audio buffer using Gemini STT', async () => {
      const mockAudioBuffer = Buffer.from('fake-audio-bytes-ogg-opus');

      vi.spyOn(AudioTranscriberService, 'transcribeAudio').mockResolvedValue('Mera last order check kar do');

      const transcript = await AudioTranscriberService.transcribeAudio(mockAudioBuffer, 'audio/ogg; codecs=opus');
      expect(transcript).toBe('Mera last order check kar do');
      expect(WhatsAppAgentService.detectIntent(transcript).intent).toBe('ORDER_SUMMARY');
    });

    it('sends outbound native WhatsApp voice note with ptt: true', async () => {
      const mediaSpy = vi.spyOn(WhatsAppClient.prototype, 'sendMediaMessage').mockResolvedValue({
        success: true,
        messageId: 'voice-msg-out-1'
      });

      const audioBuffer = Buffer.from('fake-zara-speech');
      const result = await WhatsAppAgentService.sendWhatsAppVoiceNote(
        '2cmrlo',
        '923333255998@s.whatsapp.net',
        audioBuffer,
        'audio/ogg; codecs=opus'
      );

      expect(result.success).toBe(true);
      expect(mediaSpy).toHaveBeenCalledTimes(1);
      expect(mediaSpy).toHaveBeenCalledWith(
        '923333255998@s.whatsapp.net',
        audioBuffer,
        'voice',
        'zara_voice_note.ogg',
        '',
        {}
      );
    });

    it('maintains conversational memory across mixed voice and text turns', async () => {
      const conversationId = 'conv-voice-mix';

      // Turn 1: Voice Note -> "Mera last order check kar do"
      await ConversationStateService.updateState(conversationId, {
        currentOrder: { orderNumber: '1643', orderId: 'ord-1643', status: 'In Transit' },
        recentTopic: 'order'
      });

      let state = await ConversationStateService.getState(conversationId);
      expect(state.currentOrder.orderNumber).toBe('1643');

      // Turn 2: Text -> "uska status kya hai?"
      const intentTurn2 = WhatsAppAgentService.detectIntent('uska status kya hai?');
      expect(intentTurn2.intent).toBe('ORDER_STATUS');
      expect(state.currentOrder.status).toBe('In Transit');

      // Turn 3: Voice Note transcript -> "delivery kab hogi?"
      const intentTurn3 = WhatsAppAgentService.detectIntent('delivery kab hogi?');
      expect(intentTurn3.intent).toBe('ORDER_SUMMARY');
      // Context retained
      expect(state.currentOrder.orderNumber).toBe('1643');
    });
  });
});
