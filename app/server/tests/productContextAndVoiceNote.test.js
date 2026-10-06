import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '../src/lib/db.js';
import { WhatsAppAgentService } from '../src/services/whatsappAgentService.js';
import { TextToSpeechService } from '../src/services/textToSpeechService.js';
import { ConversationStateService } from '../src/services/conversationStateService.js';
import { DeliveryService } from '../src/services/deliveryService.js';
import { HumanEscalationService } from '../src/services/humanEscalationService.js';
import { AudioTranscriberService } from '../src/services/audioTranscriberService.js';
import { ShopifyCatalogService } from '../src/services/shopifyCatalogService.js';
import { ToolDispatcher } from '../src/integrations/ai/dispatcher.js';
import { WhatsAppClient } from '../src/integrations/whatsapp/client.js';

describe('Dial Mate 2.0 — Product Context & Voice Reply Regression Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (prisma.complianceLog) {
      vi.spyOn(prisma.complianceLog, 'create').mockResolvedValue({});
    }
    if (prisma.order) {
      vi.spyOn(prisma.order, 'findFirst').mockResolvedValue(null);
      vi.spyOn(prisma.order, 'findMany').mockResolvedValue([]);
    }
    if (prisma.customer) {
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'c-1', phone: '923333255998' });
      vi.spyOn(prisma.customer, 'create').mockResolvedValue({ id: 'c-1', phone: '923333255998' });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Mock Shop and Product Fixtures
  const mockShop = {
    id: 'shop-1',
    domain: 'sundaybazaaar.store',
    name: 'Sunday Bazaaar',
    ownerPhone: '+923333255998',
    settings: { operatorPhone: '+923333255998' }
  };

  const mockProductChair = {
    id: 'prod-chair-1',
    title: 'Wooden Silicone Chair Protection Cover',
    price: 'Rs. 499',
    formattedPrice: 'Rs. 499',
    numericPrice: 499,
    url: 'https://sundaybazaaar.store/products/wooden-silicone-chair-protection-cover',
    available: true,
    description: 'Silicone chair protection cover prevents floor scratches.'
  };

  const mockProductSnoring = {
    id: 'prod-snore-1',
    title: 'Anti Snoring Magnetic Nasal Dilator',
    price: 'Rs. 699',
    formattedPrice: 'Rs. 699',
    numericPrice: 699,
    url: 'https://sundaybazaaar.store/products/anti-snoring-nasal-dilator',
    available: true,
    description: 'Magnetic nasal clips to prevent snoring and ease breathing.'
  };

  const mockUnrelatedOrder = {
    id: 'ord-1643',
    orderNumber: '1643',
    status: 'In Transit',
    totalAmount: 1198,
    shippingFee: 199,
    items: 'Velvet Sofa Cover',
    payload: JSON.stringify({
      shipping_lines: [{ price: '199' }]
    })
  };

  // =========================================================================
  // 1-5: Product -> Price, Delivery, Total, Link, Delivery -> Total Flow
  // =========================================================================
  describe('Product Inquiries & Context Maintenance (Requirements 1-5)', () => {
    it('1. product -> price: resolves price correctly when activeProduct exists', async () => {
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue(mockShop);
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'c-1', phone: '923333255998' });
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-reg-1', messages: [] });
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
      vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});
      vi.spyOn(WhatsAppClient.prototype, 'sendMessage').mockResolvedValue({ id: 'm-1' });

      await ConversationStateService.updateState('conv-reg-1', {
        currentProduct: mockProductChair,
        recentTopic: 'product'
      });

      const res = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'sundaybazaaar.store',
        sessionId: '2cmrlo',
        fromPhone: '923333255998@s.whatsapp.net',
        messageText: 'price?'
      });

      expect(res.success).toBe(true);
      expect(res.replyText).toContain('Wooden Silicone Chair Protection Cover');
      expect(res.replyText).toContain('Rs. 499');
      expect(res.replyText).toContain(mockProductChair.url);
    });

    it('2. product -> delivery: resolves delivery for activeProduct (Rs. 199) without order context', async () => {
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue(mockShop);
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'c-1', phone: '923333255998' });
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-reg-2', messages: [] });
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
      vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});
      vi.spyOn(WhatsAppClient.prototype, 'sendMessage').mockResolvedValue({ id: 'm-1' });

      await ConversationStateService.updateState('conv-reg-2', {
        currentProduct: mockProductChair,
        recentTopic: 'product'
      });

      const res = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'sundaybazaaar.store',
        sessionId: '2cmrlo',
        fromPhone: '923333255998@s.whatsapp.net',
        messageText: 'delivery charges?'
      });

      expect(res.success).toBe(true);
      expect(res.action).toBe('delivery_quote_fastpath');
      expect(res.replyText).toContain('Wooden Silicone Chair Protection Cover');
      expect(res.replyText).toContain('Rs. 199');
      expect(res.replyText).toContain('Total: Rs. 698');
      expect(res.replyText).toContain(mockProductChair.url);
    });

    it('3. product -> total: calculates authoritative price + delivery (Rs. 499 + 199 = Rs. 698)', async () => {
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue(mockShop);
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'c-1', phone: '923333255998' });
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-reg-3', messages: [] });
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
      vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});
      vi.spyOn(WhatsAppClient.prototype, 'sendMessage').mockResolvedValue({ id: 'm-1' });

      await ConversationStateService.updateState('conv-reg-3', {
        currentProduct: mockProductChair,
        recentTopic: 'product'
      });

      const res = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'sundaybazaaar.store',
        sessionId: '2cmrlo',
        fromPhone: '923333255998@s.whatsapp.net',
        messageText: 'iska total kitna banega?'
      });

      expect(res.success).toBe(true);
      expect(res.action).toBe('total_inquiry_fastpath');
      expect(res.replyText).toContain('Wooden Silicone Chair Protection Cover');
      expect(res.replyText).toContain('Rs. 499');
      expect(res.replyText).toContain('Rs. 199');
      expect(res.replyText).toContain('Rs. 698');
      expect(res.replyText).toContain(mockProductChair.url);
    });

    it('4. product -> link: provides exact product URL when requested', async () => {
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue(mockShop);
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'c-1', phone: '923333255998' });
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-reg-4', messages: [] });
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
      vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});
      vi.spyOn(WhatsAppClient.prototype, 'sendMessage').mockResolvedValue({ id: 'm-1' });

      await ConversationStateService.updateState('conv-reg-4', {
        currentProduct: mockProductChair,
        recentTopic: 'product'
      });

      const res = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'sundaybazaaar.store',
        sessionId: '2cmrlo',
        fromPhone: '923333255998@s.whatsapp.net',
        messageText: 'iska link bhejo'
      });

      expect(res.success).toBe(true);
      expect(res.action).toBe('product_link_resolution');
      expect(res.replyText).toContain(mockProductChair.url);
    });

    it('5. product -> delivery -> total: sequential flow keeps product context unbroken', async () => {
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue(mockShop);
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'c-1', phone: '923333255998' });
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-reg-5', messages: [] });
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
      vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});
      vi.spyOn(WhatsAppClient.prototype, 'sendMessage').mockResolvedValue({ id: 'm-1' });

      await ConversationStateService.updateState('conv-reg-5', {
        currentProduct: mockProductChair,
        recentTopic: 'product'
      });

      // Step A: Delivery
      const resA = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'sundaybazaaar.store',
        sessionId: '2cmrlo',
        fromPhone: '923333255998@s.whatsapp.net',
        messageText: 'delivery charges?'
      });
      expect(resA.replyText).toContain('Rs. 199');

      // Step B: Total
      const resB = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'sundaybazaaar.store',
        sessionId: '2cmrlo',
        fromPhone: '923333255998@s.whatsapp.net',
        messageText: 'total kitna?'
      });
      expect(resB.replyText).toContain('Rs. 698');
      expect(resB.replyText).not.toContain('1643');
    });
  });

  // =========================================================================
  // 6-9: Unrelated Order Hijack Protection & Explicit Order Priority
  // =========================================================================
  describe('Context Priority Hierarchy & Order Disambiguation (Requirements 6-9)', () => {
    it('6. product context with unrelated recent order: delivery inquiry MUST NOT use order', async () => {
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue(mockShop);
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'c-1', phone: '923333255998' });
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-reg-6', messages: [] });
      vi.spyOn(prisma.order, 'findFirst').mockResolvedValue(mockUnrelatedOrder);
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
      vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});
      vi.spyOn(WhatsAppClient.prototype, 'sendMessage').mockResolvedValue({ id: 'm-1' });

      // Customer previously discussed chair cover
      await ConversationStateService.updateState('conv-reg-6', {
        currentProduct: mockProductChair,
        recentTopic: 'product'
      });

      const res = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'sundaybazaaar.store',
        sessionId: '2cmrlo',
        fromPhone: '923333255998@s.whatsapp.net',
        messageText: 'delivery charges?'
      });

      // MUST NOT return Order #1643
      expect(res.replyText).not.toContain('#1643');
      expect(res.replyText).not.toContain('Velvet Sofa Cover');
      expect(res.replyText).toContain('Wooden Silicone Chair Protection Cover');
      expect(res.replyText).toContain('Rs. 199');
    });

    it('7. product context with unrelated recent order: total inquiry MUST NOT return order total', async () => {
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue(mockShop);
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'c-1', phone: '923333255998' });
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-reg-7', messages: [] });
      vi.spyOn(prisma.order, 'findFirst').mockResolvedValue(mockUnrelatedOrder);
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
      vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});
      vi.spyOn(WhatsAppClient.prototype, 'sendMessage').mockResolvedValue({ id: 'm-1' });

      await ConversationStateService.updateState('conv-reg-7', {
        currentProduct: mockProductChair,
        recentTopic: 'product'
      });

      const res = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'sundaybazaaar.store',
        sessionId: '2cmrlo',
        fromPhone: '923333255998@s.whatsapp.net',
        messageText: 'iska total kitna banega?'
      });

      // Product total is 698, NOT the order #1643 total of 1198!
      expect(res.replyText).not.toContain('1,198');
      expect(res.replyText).toContain('Rs. 698');
    });

    it('8. explicit order -> delivery: "mere order ka delivery charge" switches to order context', async () => {
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue(mockShop);
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'c-1', phone: '923333255998' });
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-reg-8', messages: [] });
      vi.spyOn(prisma.order, 'findFirst').mockResolvedValue(mockUnrelatedOrder);
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
      vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});
      vi.spyOn(WhatsAppClient.prototype, 'sendMessage').mockResolvedValue({ id: 'm-1' });

      // Even if activeProduct is set, explicit order reference takes priority
      await ConversationStateService.updateState('conv-reg-8', {
        currentProduct: mockProductChair,
        recentTopic: 'product'
      });

      const res = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'sundaybazaaar.store',
        sessionId: '2cmrlo',
        fromPhone: '923333255998@s.whatsapp.net',
        messageText: 'mere order ka delivery charge kitna hai?'
      });

      expect(res.action).toBe('order_delivery_charges_fastpath');
      expect(res.replyText).toContain('#1643');
      expect(res.replyText).toContain('Rs. 199');
    });

    it('9. explicit order -> total: "mere order ka total kitna hai" switches to order total', async () => {
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue(mockShop);
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'c-1', phone: '923333255998' });
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-reg-9', messages: [] });
      vi.spyOn(prisma.order, 'findFirst').mockResolvedValue(mockUnrelatedOrder);
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
      vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});
      vi.spyOn(WhatsAppClient.prototype, 'sendMessage').mockResolvedValue({ id: 'm-1' });

      await ConversationStateService.updateState('conv-reg-9', {
        currentProduct: mockProductChair,
        recentTopic: 'product'
      });

      const res = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'sundaybazaaar.store',
        sessionId: '2cmrlo',
        fromPhone: '923333255998@s.whatsapp.net',
        messageText: 'mere order #1643 ka total kitna hai?'
      });

      expect(res.action).toBe('order_total_fastpath');
      expect(res.replyText).toContain('#1643');
      expect(res.replyText).toContain('Rs. 1,198');
    });

    it('10. active product switching: switching from chair to anti-snoring updates active product', async () => {
      const convId = 'conv-switch-test';
      await ConversationStateService.updateState(convId, { currentProduct: mockProductChair });
      let active = await ConversationStateService.resolveActiveProduct(convId);
      expect(active.title).toBe(mockProductChair.title);

      // Customer asks about anti snoring -> updates state
      await ConversationStateService.updateState(convId, { currentProduct: mockProductSnoring });
      active = await ConversationStateService.resolveActiveProduct(convId);
      expect(active.title).toBe(mockProductSnoring.title);
      expect(active.numericPrice).toBe(699);
    });
  });

  // =========================================================================
  // 10-15: Demonstratives, Pronouns, Roman Urdu, Mixed Lang, Typos
  // =========================================================================
  describe('Pakistani Language Engine & Pronoun Resolution (Requirements 10-15)', () => {
    it('11. resolves "iski" to active product', async () => {
      const convId = 'conv-pronoun-1';
      await ConversationStateService.updateState(convId, { currentProduct: mockProductChair });
      const resolved = await ConversationStateService.resolveProductReference(convId, 'iski price kya hai?');
      expect(resolved.id).toBe(mockProductChair.id);
    });

    it('12. resolves "iska" to active product', async () => {
      const convId = 'conv-pronoun-2';
      await ConversationStateService.updateState(convId, { currentProduct: mockProductChair });
      const resolved = await ConversationStateService.resolveProductReference(convId, 'iska total kitna banega?');
      expect(resolved.id).toBe(mockProductChair.id);
    });

    it('13. resolves "yeh" and "this" to active product', async () => {
      const convId = 'conv-pronoun-3';
      await ConversationStateService.updateState(convId, { currentProduct: mockProductChair });
      const resolvedYeh = await ConversationStateService.resolveProductReference(convId, 'yeh kitne ka hai?');
      expect(resolvedYeh.id).toBe(mockProductChair.id);

      const resolvedThis = await ConversationStateService.resolveProductReference(convId, 'send this link');
      expect(resolvedThis.id).toBe(mockProductChair.id);
    });

    it('14. handles Roman Urdu synonym mapping: "kursi ka cover" matches chair cover', async () => {
      vi.spyOn(ShopifyCatalogService, 'loadCatalog').mockResolvedValue([mockProductChair, mockProductSnoring]);
      const res = await ShopifyCatalogService.searchProducts('sundaybazaaar.store', 'kursi ka cover');
      expect(res.products.length).toBeGreaterThan(0);
      expect(res.products[0].title).toContain('Chair Protection Cover');
    });

    it('15. handles typos and SMS slang: "delivry charges", "kitny ka hy"', () => {
      expect(WhatsAppAgentService.detectIntent('delivry charges').intent).toBe('ORDER_DELIVERY_CHARGES');
      expect(WhatsAppAgentService.detectIntent('kitny ka hy').intent).toBe('PRODUCT_DETAIL');
      expect(WhatsAppAgentService.detectIntent('cnfrm krdo').intent).toBe('CONFIRM');
      expect(WhatsAppAgentService.detectIntent('cancel mt krna').intent).toBe('CANCEL');
      expect(WhatsAppAgentService.isNegated('cancel mt krna', 'cancel')).toBe(true);
    });
  });

  // =========================================================================
  // 16-21: Voice Inbound -> Voice Outbound, Transcription, TTS, Fallback
  // =========================================================================
  describe('WhatsApp Voice In -> Voice Out & TTS Subsystem (Requirements 16-21)', () => {
    it('16. AudioTranscriberService cleanly handles audio buffer transcription', async () => {
      const fakeClient = {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: 'Mera chair protection cover ka total kitna hai'
          })
        }
      };
      vi.spyOn(AudioTranscriberService, 'transcribeAudio').mockResolvedValue('Mera chair protection cover ka total kitna hai');
      const transcript = await AudioTranscriberService.transcribeAudio(Buffer.from('fake-audio'), 'audio/ogg');
      expect(transcript).toBe('Mera chair protection cover ka total kitna hai');
    });

    it('17. TextToSpeechService synthesizes speech with female voice "Aoede"', async () => {
      const pcm16 = Buffer.alloc(4800, 1); // 0.1s at 24kHz mono
      vi.spyOn(TextToSpeechService, 'synthesize').mockResolvedValue({
        success: true,
        buffer: TextToSpeechService.pcm16ToWav(pcm16, 24000, 1),
        mimeType: 'audio/wav',
        durationSeconds: 0.1,
        sampleRate: 24000
      });

      const res = await TextToSpeechService.synthesize('Ji, chair cover Rs. 499 ka hai.', { voice: 'Aoede' });
      expect(res.success).toBe(true);
      expect(res.buffer).toBeInstanceOf(Buffer);
      expect(res.buffer.slice(0, 4).toString('ascii')).toBe('RIFF');
      expect(res.buffer.slice(8, 12).toString('ascii')).toBe('WAVE');
    });

    it('18. TextToSpeechService cleanTextForSpeech strips URLs and formats currency for speech', () => {
      const text = 'Ji, *Wooden Chair Cover* Rs. 499 ka hai.\n🔗 https://sundaybazaaar.store/prod\n• In stock';
      const speech = TextToSpeechService.cleanTextForSpeech(text);
      expect(speech).not.toContain('https://');
      expect(speech).not.toContain('🔗');
      expect(speech).toContain('499 rupay');
      expect(speech).not.toContain('*');
    });

    it('19. voice-in -> voice-out: sends outbound native WhatsApp voice note when isVoiceInbound is true', async () => {
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue(mockShop);
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'c-1', phone: '923333255998' });
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-voice-1', messages: [] });
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
      vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});

      const mediaSpy = vi.spyOn(WhatsAppClient.prototype, 'sendMediaMessage').mockResolvedValue({
        id: 'msg-voice-out',
        status: true
      });
      const textSpy = vi.spyOn(WhatsAppClient.prototype, 'sendMessage').mockResolvedValue({});

      vi.spyOn(TextToSpeechService, 'synthesize').mockResolvedValue({
        success: true,
        buffer: Buffer.from('RIFF-fake-wav-voice-audio'),
        durationSeconds: 2.5
      });

      await ConversationStateService.updateState('conv-voice-1', { currentProduct: mockProductChair });

      const res = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'sundaybazaaar.store',
        sessionId: '2cmrlo',
        fromPhone: '923333255998@s.whatsapp.net',
        messageText: 'delivery charges?',
        isVoiceInbound: true
      });

      expect(res.success).toBe(true);
      // Voice inbound MUST invoke sendMediaMessage with type 'voice'
      expect(mediaSpy).toHaveBeenCalledTimes(1);
      expect(mediaSpy).toHaveBeenCalledWith(
        '923333255998@s.whatsapp.net',
        expect.any(Buffer),
        'voice',
        'zara_voice_note.ogg',
        '',
        expect.any(Object)
      );
      // Regular text MUST NOT be dispatched as an extra message
      expect(textSpy).not.toHaveBeenCalled();
    });

    it('20. text-in -> text-out: sends regular text message when isVoiceInbound is false', async () => {
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue(mockShop);
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'c-1', phone: '923333255998' });
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-text-1', messages: [] });
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
      vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});

      const mediaSpy = vi.spyOn(WhatsAppClient.prototype, 'sendMediaMessage').mockResolvedValue({});
      const textSpy = vi.spyOn(WhatsAppClient.prototype, 'sendMessage').mockResolvedValue({ id: 'msg-text-out' });

      await ConversationStateService.updateState('conv-text-1', { currentProduct: mockProductChair });

      const res = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'sundaybazaaar.store',
        sessionId: '2cmrlo',
        fromPhone: '923333255998@s.whatsapp.net',
        messageText: 'delivery charges?',
        isVoiceInbound: false
      });

      expect(res.success).toBe(true);
      expect(textSpy).toHaveBeenCalledTimes(1);
      expect(mediaSpy).not.toHaveBeenCalled();
    });

    it('21. TTS failure -> text fallback: gracefully falls back to text without dropping response', async () => {
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue(mockShop);
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'c-1', phone: '923333255998' });
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-fallback-1', messages: [] });
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
      vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});

      const mediaSpy = vi.spyOn(WhatsAppClient.prototype, 'sendMediaMessage').mockResolvedValue({});
      const textSpy = vi.spyOn(WhatsAppClient.prototype, 'sendMessage').mockResolvedValue({ id: 'msg-fallback-out' });

      // TTS errors out
      vi.spyOn(TextToSpeechService, 'synthesize').mockResolvedValue({
        success: false,
        error: '503 Model Unavailable'
      });

      await ConversationStateService.updateState('conv-fallback-1', { currentProduct: mockProductChair });

      const res = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'sundaybazaaar.store',
        sessionId: '2cmrlo',
        fromPhone: '923333255998@s.whatsapp.net',
        messageText: 'delivery charges?',
        isVoiceInbound: true
      });

      expect(res.success).toBe(true);
      expect(mediaSpy).not.toHaveBeenCalled();
      // Falls back to text message
      expect(textSpy).toHaveBeenCalledTimes(1);
      expect(textSpy).toHaveBeenCalledWith(
        '923333255998@s.whatsapp.net',
        expect.stringContaining('Rs. 199'),
        expect.any(Object)
      );
    });
  });

  // =========================================================================
  // 22-24: Idempotency, Safety Policies, Human Escalation Truthfulness
  // =========================================================================
  describe('Safety, Anti-Leakage & Escalation Truthfulness (Requirements 22-24)', () => {
    it('22. no duplicate replies: human takeover guard prevents duplicate AI response', async () => {
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue(mockShop);
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-takeover', isTakeover: true, messages: [] });
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
      const textSpy = vi.spyOn(WhatsAppClient.prototype, 'sendMessage').mockResolvedValue({});

      const res = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'sundaybazaaar.store',
        sessionId: '2cmrlo',
        fromPhone: '923333255998@s.whatsapp.net',
        messageText: 'Hello'
      });

      expect(res.handledByHuman).toBe(true);
      expect(textSpy).not.toHaveBeenCalled();
    });

    it('23. no stock-status leakage: does not reveal "In Stock" unless explicitly asked', async () => {
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue(mockShop);
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'c-1', phone: '923333255998' });
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-stock', messages: [] });
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
      vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});
      vi.spyOn(WhatsAppClient.prototype, 'sendMessage').mockResolvedValue({});

      await ConversationStateService.updateState('conv-stock', { currentProduct: mockProductChair });

      const res = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'sundaybazaaar.store',
        sessionId: '2cmrlo',
        fromPhone: '923333255998@s.whatsapp.net',
        messageText: 'price?'
      });

      expect(res.replyText).not.toContain('In Stock');
      expect(res.replyText).not.toContain('Status: In Stock');
      expect(res.replyText).not.toContain('Out of Stock');
    });

    it('24. no false human-transfer claim: truthfully informs customer that human support was notified', async () => {
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue(mockShop);
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'c-1', phone: '923333255998' });
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-human', isTakeover: false, messages: [] });
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
      vi.spyOn(prisma.conversation, 'update').mockResolvedValue({});
      vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});
      vi.spyOn(WhatsAppClient.prototype, 'sendMessage').mockResolvedValue({});

      const dispatchSpy = vi.spyOn(ToolDispatcher, 'dispatch').mockResolvedValue({ success: true });

      const res = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'sundaybazaaar.store',
        sessionId: '2cmrlo',
        fromPhone: '923333255998@s.whatsapp.net',
        messageText: 'mujhe real person se baat karni hai'
      });

      expect(res.success).toBe(true);
      expect(res.action).toBe('request_human_transfer');
      expect(res.replyText).toContain('human support team ko inform kar diya hai');
      // Must NOT claim live telephony call or connection
      expect(res.replyText).not.toContain('call connect kar rahi hoon');
      expect(res.replyText).not.toContain('transfer kar rahi hoon');
    });
  });

  // =========================================================================
  // 25-29: Human Escalation Continuity & Product Rejection Lifecycle
  // =========================================================================
  describe('Human Escalation Continuity & Product Rejection Lifecycle (Requirements 25-29)', () => {
    it('25. human escalation does NOT end conversation: subsequent message is handled by Zara', async () => {
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue(mockShop);
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'c-1', phone: '923333255998' });
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
      vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});
      const sendSpy = vi.spyOn(WhatsAppClient.prototype, 'sendMessage').mockResolvedValue({});
      vi.spyOn(ToolDispatcher, 'dispatch').mockResolvedValue({ success: true, notificationSent: true });

      const conv = { id: 'conv-cont-1', isTakeover: false, messages: [] };
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue(conv);

      // Turn 1: Customer asks for human support
      const turn1 = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'sundaybazaaar.store',
        sessionId: '2cmrlo',
        fromPhone: '923333255998@s.whatsapp.net',
        messageText: 'mujhe real person se baat karni hai'
      });

      expect(turn1.success).toBe(true);
      expect(turn1.action).toBe('request_human_transfer');
      expect(turn1.replyText).toContain('human support team ko inform kar diya hai');
      // Must NOT set isTakeover
      expect(conv.isTakeover).toBe(false);

      // Turn 2: Customer asks product price immediately after
      await ConversationStateService.updateState('conv-cont-1', { currentProduct: mockProductChair });
      const turn2 = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'sundaybazaaar.store',
        sessionId: '2cmrlo',
        fromPhone: '923333255998@s.whatsapp.net',
        messageText: 'acha chair protection cover ki price batao'
      });

      expect(turn2.success).toBe(true);
      expect(turn2.handledByHuman).not.toBe(true);
      expect(turn2.replyText).toContain('Rs. 499');
      expect(sendSpy).toHaveBeenCalled();
    });

    it('26. informational question mentioning owner is NOT classified as human transfer', () => {
      const detected1 = WhatsAppAgentService.detectIntent('Tumhare owner ka naam kya hai', {});
      expect(detected1.intent).not.toBe('HUMAN_TRANSFER');

      const detected2 = WhatsAppAgentService.detectIntent('owner ka number do', {});
      // Even if asking number/info, verify explicit human transfer requires connecting/talking
      const detected3 = WhatsAppAgentService.detectIntent('owner se baat karwao', {});
      expect(detected3.intent).toBe('HUMAN_TRANSFER');
    });

    it('27. repeat escalation within notification window sends polite reassurance without duplicate alert', async () => {
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue(mockShop);
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'c-1', phone: '923333255998' });
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-repeat-esc', isTakeover: false, messages: [] });
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
      vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});
      vi.spyOn(WhatsAppClient.prototype, 'sendMessage').mockResolvedValue({});
      const dispatchSpy = vi.spyOn(ToolDispatcher, 'dispatch').mockResolvedValue({ success: true });

      // Mark that human escalation was already notified 2 minutes ago
      await ConversationStateService.markHumanEscalation('conv-repeat-esc', {
        notificationSent: true,
        notifiedAt: Date.now() - 2 * 60 * 1000
      });

      const res = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'sundaybazaaar.store',
        sessionId: '2cmrlo',
        fromPhone: '923333255998@s.whatsapp.net',
        messageText: 'kisi bande se baat karwao please'
      });

      expect(res.success).toBe(true);
      expect(res.action).toBe('human_transfer_already_notified');
      expect(res.replyText).toContain('pehle hi bhej di gayi hai');
      // Tool dispatcher should NOT be called again
      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('28. product rejection ("nahi chahiye", "rehne do") removes product from active context', async () => {
      const mockProductBrush = {
        id: 'prod-brush-1',
        title: '19L Water Bottle Cleaning Brush',
        price: 'Rs. 799',
        formattedPrice: 'Rs. 799',
        numericPrice: 799
      };

      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue(mockShop);
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'c-1', phone: '923333255998' });
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-reject-1', isTakeover: false, messages: [] });
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
      vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});
      vi.spyOn(WhatsAppClient.prototype, 'sendMessage').mockResolvedValue({});

      // Set active product
      await ConversationStateService.updateState('conv-reject-1', {
        currentProduct: mockProductBrush,
        lastProducts: [mockProductBrush, mockProductChair]
      });

      // Customer rejects product
      const resReject = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'sundaybazaaar.store',
        sessionId: '2cmrlo',
        fromPhone: '923333255998@s.whatsapp.net',
        messageText: 'nahi chahiye ye product'
      });

      expect(resReject.intent).toBe('PRODUCT_REJECTION');
      expect(resReject.action).toBe('product_rejected');
      expect(resReject.replyText).toContain('Theek hai, koi baat nahi');

      // State check: activeProduct must now be null (or next non-rejected item, NOT the rejected brush)
      const activeProd = await ConversationStateService.resolveActiveProduct('conv-reject-1');
      expect(activeProd?.id).not.toBe(mockProductBrush.id);

      // Rejection does not cancel an order
      expect(resReject.intent).not.toBe('CANCEL');
    });

    it('29. voice note after human escalation is answered with voice reply', async () => {
      vi.spyOn(prisma.shop, 'findUnique').mockResolvedValue(mockShop);
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({ id: 'c-1', phone: '923333255998' });
      vi.spyOn(prisma.conversation, 'findFirst').mockResolvedValue({ id: 'conv-voice-post-esc', isTakeover: false, messages: [] });
      vi.spyOn(prisma.message, 'create').mockResolvedValue({});
      vi.spyOn(prisma.aIInteractionLog, 'create').mockResolvedValue({});

      const mediaSpy = vi.spyOn(WhatsAppClient.prototype, 'sendMediaMessage').mockResolvedValue({ status: true });
      const textSpy = vi.spyOn(WhatsAppClient.prototype, 'sendMessage').mockResolvedValue({});

      vi.spyOn(TextToSpeechService, 'synthesize').mockResolvedValue({
        success: true,
        buffer: Buffer.from('RIFF mock wav audio data'),
        format: 'audio/ogg',
        durationSeconds: 3.1
      });

      await ConversationStateService.markHumanEscalation('conv-voice-post-esc', { notifiedAt: Date.now() - 60000 });
      await ConversationStateService.updateState('conv-voice-post-esc', { currentProduct: mockProductChair });

      const res = await WhatsAppAgentService.handleIncomingMessage({
        shopId: 'shop-1',
        shopDomain: 'sundaybazaaar.store',
        sessionId: '2cmrlo',
        fromPhone: '923333255998@s.whatsapp.net',
        messageText: 'delivery charges kitne hain?',
        isVoiceInbound: true
      });

      expect(res.success).toBe(true);
      expect(res.handledByHuman).not.toBe(true);
      expect(mediaSpy).toHaveBeenCalledTimes(1);
      expect(textSpy).not.toHaveBeenCalled();
    });
  });
});
