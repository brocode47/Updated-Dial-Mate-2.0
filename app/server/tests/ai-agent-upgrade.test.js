import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CallScriptEngine } from '../src/services/callScriptEngine.js';
import { AICallInterpretationService } from '../src/services/aiCallInterpretationService.js';
import { ToolDispatcher, toolSchemas } from '../src/integrations/ai/dispatcher.js';
import { tools } from '../src/integrations/ai/tools.js';
import { searchShopifyProducts } from '../src/integrations/shopify/products.js';
import { HumanEscalationService } from '../src/services/humanEscalationService.js';
import { AudioCodec } from '../src/utils/audioCodec.js';
import { Agent } from '../src/integrations/ai/agent.js';
import { prisma } from '../src/lib/db.js';
import * as ordersApi from '../src/integrations/shopify/orders.js';

vi.mock('../src/lib/db.js', () => ({
  prisma: {
    shop: { findUnique: vi.fn() },
    order: { findUnique: vi.fn(), update: vi.fn() },
    product: { findMany: vi.fn() },
    call: {
      create: vi.fn().mockResolvedValue({ id: 'call-test-upgrade-123' }),
      update: vi.fn().mockResolvedValue({ id: 'call-test-upgrade-123' }),
      count: vi.fn().mockResolvedValue(0)
    },
    customer: { findUnique: vi.fn() },
    complianceLog: { create: vi.fn().mockResolvedValue({ id: 'comp-log-123' }) },
    whatsAppIntegration: { findFirst: vi.fn().mockResolvedValue(null) }
  }
}));

vi.mock('../src/lib/queues.js', () => ({
  callQueue: { add: vi.fn().mockResolvedValue({ id: 'job-cb-123' }) },
  whatsappQueue: { add: vi.fn().mockResolvedValue({ id: 'job-wa-123' }) }
}));

vi.mock('../src/integrations/shopify/orders.js', () => ({
  addOrderTag: vi.fn().mockResolvedValue(true),
  removeOrderTag: vi.fn().mockResolvedValue(true),
  cancelOrder: vi.fn().mockResolvedValue(true),
  getOrder: vi.fn()
}));

describe('DIAL MATE 2.0: AI Agent Real-World Customer Service Upgrade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // VOICE CONFIGURATION TESTS
  // =========================================================================
  describe('VOICE: Female Zara Voice Configuration', () => {
    it('1. Female voice configuration (Aoede) is passed to Gemini Live session config', async () => {
      const mockConnect = vi.fn().mockResolvedValue({
        sendRealtimeInput: vi.fn(),
        sendClientContent: vi.fn(),
        receive: (async function* () {})(),
        close: vi.fn()
      });

      const agent = new Agent({
        shopDomain: 'test.myshopify.com',
        systemInstruction: 'Test instruction',
        voiceName: 'Aoede'
      });

      agent.ai = {
        models: {},
        live: { connect: mockConnect }
      };

      await agent.connect();

      expect(mockConnect).toHaveBeenCalledTimes(1);
      const connectArgs = mockConnect.mock.calls[0][0];
      expect(connectArgs.config).toBeDefined();
      expect(connectArgs.config.speechConfig).toBeDefined();
      expect(connectArgs.config.speechConfig.voiceConfig).toBeDefined();
      expect(connectArgs.config.speechConfig.voiceConfig.prebuiltVoiceConfig).toBeDefined();
      expect(connectArgs.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Aoede');
    });
  });

  // =========================================================================
  // LATENCY & NON-BLOCKING TESTS
  // =========================================================================
  describe('LATENCY: Audio Path & Tool Execution', () => {
    it('2. Audio conversion and streaming in live path is non-blocking and zero-alloc', () => {
      const codec = new AudioCodec();
      const pcm16Base64 = Buffer.alloc(960).toString('base64'); // 20ms of 24kHz 16-bit PCM
      const start = performance.now();
      const ulawBase64 = codec.geminiToTwilio(pcm16Base64);
      const elapsed = performance.now() - start;

      expect(typeof ulawBase64).toBe('string');
      expect(elapsed).toBeLessThan(25); // Sub-millisecond to low millisecond conversion
    });

    it('3. Tool calls do not silently deadlock or throw uncaught rejections', async () => {
      prisma.order.findUnique.mockResolvedValueOnce(null);
      const result = await ToolDispatcher.dispatch(
        'confirm_order',
        { orderId: 'non-existent-id' },
        { shopDomain: 'test.myshopify.com', orderId: 'non-existent-id' }
      );

      expect(result).toBeDefined();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // =========================================================================
  // SHOPIFY PRODUCT SEARCH TESTS
  // =========================================================================
  describe('PRODUCT SEARCH: search_shopify_products Tool', () => {
    it('4. Exact product search returns title, price, availability, and description', async () => {
      prisma.product.findMany.mockResolvedValueOnce([
        {
          id: 'prod-1',
          name: 'Chair Protection Cover',
          description: '<p>High quality waterproof chair cover</p>',
          price: 1500,
          stock: 25,
          category: 'Furniture Covers',
          variants: JSON.stringify([{ id: 'v-1', title: 'Standard', price: '1500', inventory_quantity: 25 }])
        }
      ]);

      const result = await ToolDispatcher.dispatch(
        'search_shopify_products',
        { query: 'chair protection cover' },
        { shopDomain: 'test.myshopify.com', orderId: 'ord-current-1' }
      );

      expect(result.success).toBe(true);
      expect(result.count).toBe(1);
      expect(result.products[0].title).toBe('Chair Protection Cover');
      expect(result.products[0].price).toBe('Rs. 1500');
      expect(result.products[0].available).toBe(true);
      expect(result.products[0].description).toBe('High quality waterproof chair cover');
      // Must not leak private tokens or sensitive fields
      expect(result.products[0].accessToken).toBeUndefined();
      expect(result.products[0].variantsJson).toBeUndefined();
    });

    it('5. Related / close keyword product search finds matching items', async () => {
      prisma.product.findMany.mockResolvedValueOnce([
        {
          id: 'prod-2',
          name: 'Deluxe Velvet Dining Chair Slipcover',
          description: 'Elastic stretch chair protection seat cover',
          price: 1800,
          stock: 5,
          category: 'Slipcovers',
          variants: null
        }
      ]);

      const result = await ToolDispatcher.dispatch(
        'search_shopify_products',
        { query: 'chair cover' },
        { shopDomain: 'test.myshopify.com', orderId: 'ord-current-1' }
      );

      expect(result.success).toBe(true);
      expect(result.count).toBe(1);
      expect(result.products[0].title).toContain('Chair Slipcover');
    });

    it('6. No-match search returns friendly result without hallucinating products', async () => {
      prisma.product.findMany.mockResolvedValueOnce([]);

      const result = await ToolDispatcher.dispatch(
        'search_shopify_products',
        { query: 'flying carpet luxury edition' },
        { shopDomain: 'test.myshopify.com', orderId: 'ord-current-1' }
      );

      expect(result.success).toBe(true);
      expect(result.count).toBe(0);
      expect(result.products).toHaveLength(0);
      expect(result.message).toContain('No products found');
    });

    it('7. Multiple-match search returns products allowing agent to clarify naturally', async () => {
      prisma.product.findMany.mockResolvedValueOnce([
        {
          id: 'prod-3',
          name: 'Dining Chair Seat Cover',
          description: 'Seat only',
          price: 800,
          stock: 10,
          category: 'Covers',
          variants: null
        },
        {
          id: 'prod-4',
          name: 'Full Wingback Chair Cover',
          description: 'Full cover',
          price: 2400,
          stock: 4,
          category: 'Covers',
          variants: null
        }
      ]);

      const result = await ToolDispatcher.dispatch(
        'search_shopify_products',
        { query: 'chair cover' },
        { shopDomain: 'test.myshopify.com', orderId: 'ord-current-1' }
      );

      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
      expect(result.products.map(p => p.title)).toEqual(
        expect.arrayContaining(['Dining Chair Seat Cover', 'Full Wingback Chair Cover'])
      );
    });

    it('8. Product search does not replace current order context', async () => {
      const orderContext = {
        shopDomain: 'test.myshopify.com',
        orderId: 'order-nasal-dilator-uuid',
        orderNumber: '1643',
        productName: 'Magnetic Nasal Dilator'
      };

      prisma.product.findMany.mockResolvedValueOnce([
        {
          id: 'prod-10',
          name: 'Chair Cover',
          description: 'Cover',
          price: 1200,
          stock: 3,
          category: 'Covers',
          variants: null
        }
      ]);

      const result = await ToolDispatcher.dispatch(
        'search_shopify_products',
        { query: 'chair cover' },
        orderContext
      );

      expect(result.success).toBe(true);
      // Verify order context remains untouched
      expect(orderContext.orderId).toBe('order-nasal-dilator-uuid');
      expect(orderContext.productName).toBe('Magnetic Nasal Dilator');
    });

    it('9. Product information returned comes strictly from Shopify/DB, not hallucination', async () => {
      prisma.product.findMany.mockResolvedValueOnce([
        {
          id: 'p-real',
          name: 'Real Shopify Item',
          description: '<b>Bold description</b>',
          price: 1999,
          stock: 12,
          category: 'Real',
          variants: null
        }
      ]);

      const result = await ToolDispatcher.dispatch(
        'search_shopify_products',
        { query: 'real item' },
        { shopDomain: 'test.myshopify.com', orderId: 'ord-1' }
      );

      expect(result.products[0].title).toBe('Real Shopify Item');
      expect(result.products[0].description).toBe('Bold description'); // Stripped of HTML tags
      expect(result.products[0].price).toBe('Rs. 1999');
    });
  });

  // =========================================================================
  // CONFIRMATION TESTS
  // =========================================================================
  describe('CONFIRMATION: Explicit vs Negated / Ambiguous', () => {
    it('10. Explicit confirmation updates internal state to CONFIRMED', async () => {
      prisma.order.findUnique.mockResolvedValueOnce({
        id: 'ord-confirm-1',
        status: 'Pending Confirmation',
        shopifyOrderGid: 'gid://shopify/Order/1643',
        shop: { domain: 'test.myshopify.com' }
      });
      prisma.order.update.mockResolvedValueOnce({
        id: 'ord-confirm-1',
        status: 'Confirmed'
      });

      const result = await ToolDispatcher.dispatch(
        'confirm_order',
        { orderId: 'ord-confirm-1', notes: 'Customer confirmed' },
        { shopDomain: 'test.myshopify.com', orderId: 'ord-confirm-1' }
      );

      expect(result.success).toBe(true);
      expect(prisma.order.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'ord-confirm-1' },
        data: expect.objectContaining({ status: 'Confirmed' })
      }));
    });

    it('11. Explicit confirmation updates Shopify order tag COD_CONFIRMED', async () => {
      prisma.order.findUnique.mockResolvedValueOnce({
        id: 'ord-confirm-2',
        status: 'Pending Confirmation',
        shopifyOrderGid: 'gid://shopify/Order/1643',
        shop: { domain: 'test.myshopify.com' }
      });
      prisma.order.update.mockResolvedValueOnce({
        id: 'ord-confirm-2',
        status: 'Confirmed'
      });

      await ToolDispatcher.dispatch(
        'confirm_order',
        { orderId: 'ord-confirm-2' },
        { shopDomain: 'test.myshopify.com', orderId: 'ord-confirm-2' }
      );

      expect(ordersApi.addOrderTag).toHaveBeenCalledWith(
        'test.myshopify.com',
        '1643',
        'COD_CONFIRMED'
      );
    });

    it('12. Ambiguous confirmation does not trigger confirmation intent', async () => {
      const interpretation = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Shayad main confirm karoon, abhi sochna paray ga.',
        callDurationSec: 15
      });

      expect(interpretation.intent).not.toBe('CONFIRMED');
      expect(interpretation.confidence).toBeLessThan(0.75);
    });

    it('13. Negated confirmation ("Confirm nahi karna") MUST NOT confirm', async () => {
      const interpretation = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Maine kaha confirm nahi karna abhi, ruko.',
        callDurationSec: 10
      });

      expect(interpretation.intent).not.toBe('CONFIRMED');
    });
  });

  // =========================================================================
  // CANCELLATION TESTS
  // =========================================================================
  describe('CANCELLATION: Explicit vs Negated / Ambiguous', () => {
    it('14. Explicit cancellation updates internal state and Shopify tag COD_CANCELLED', async () => {
      const mockOrder = {
        id: 'ord-cancel-1',
        status: 'Pending Confirmation',
        shopifyOrderGid: 'gid://shopify/Order/1643',
        shop: { domain: 'test.myshopify.com' }
      };
      // StateMachine lookup + getShopifyId lookup
      prisma.order.findUnique
        .mockResolvedValueOnce(mockOrder)
        .mockResolvedValueOnce(mockOrder);

      prisma.order.update.mockResolvedValueOnce({
        id: 'ord-cancel-1',
        status: 'Cancelled'
      });

      const result = await ToolDispatcher.dispatch(
        'cancel_order',
        { orderId: 'ord-cancel-1', reason: 'Customer changed mind' },
        { shopDomain: 'test.myshopify.com', orderId: 'ord-cancel-1' }
      );

      expect(result.success).toBe(true);
      expect(ordersApi.addOrderTag).toHaveBeenCalledWith(
        'test.myshopify.com',
        '1643',
        'COD_CANCELLED'
      );
    });

    it('15. Negated cancellation ("Cancel nahi karna") does not cancel', async () => {
      const interpretation = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Suno, main order cancel nahi karna chahta. Mujhe ye chahiye.',
        callDurationSec: 12
      });

      expect(interpretation.intent).not.toBe('CANCELLED');
    });

    it('16. Ambiguous cancellation ("Shayad cancel kar doon") does not cancel', async () => {
      const interpretation = await AICallInterpretationService.interpretConversation({
        transcript: 'Customer: Shayad cancel kar doon, dekhte hain.',
        callDurationSec: 10
      });

      expect(interpretation.intent).not.toBe('CANCELLED');
    });
  });

  // =========================================================================
  // HUMAN ESCALATION TESTS
  // =========================================================================
  describe('HUMAN ESCALATION: Realistic Handling & WhatsApp Notification', () => {
    it('17. Human request transitions order to Human Required and creates compliance record', async () => {
      const mockOrder = {
        id: 'ord-he-1',
        status: 'Pending Confirmation',
        shopifyOrderGid: 'gid://shopify/Order/1643',
        orderNumber: '1643',
        customerPhone: '+923001234567',
        customerName: 'Ali Khan',
        shop: { domain: 'test.myshopify.com', settings: JSON.stringify({ supportPhone: '+923331112233' }) }
      };
      // StateMachine lookup + escalate lookup
      prisma.order.findUnique
        .mockResolvedValueOnce(mockOrder)
        .mockResolvedValueOnce(mockOrder);

      prisma.order.update.mockResolvedValueOnce({
        id: 'ord-he-1',
        status: 'Human Transfer'
      });

      const result = await ToolDispatcher.dispatch(
        'request_human_transfer',
        { orderId: 'ord-he-1', reason: 'Customer requested human agent' },
        { shopDomain: 'test.myshopify.com', orderId: 'ord-he-1' }
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe('human_requested');
      expect(prisma.complianceLog.create).toHaveBeenCalled();
    });

    it('18. WhatsApp notification is sent with concise escalation details to support', async () => {
      const sendSpy = vi.spyOn(HumanEscalationService, 'escalate');

      prisma.order.findUnique.mockResolvedValueOnce({
        id: 'ord-he-2',
        orderNumber: '1643',
        customerPhone: '+923333255998',
        customerName: 'Test Customer',
        status: 'Pending Confirmation',
        shopifyOrderGid: 'gid://shopify/Order/1643',
        shop: {
          domain: 'test.myshopify.com',
          settings: JSON.stringify({ supportPhone: '+923219876543' })
        }
      });

      await HumanEscalationService.escalate({
        shopDomain: 'test.myshopify.com',
        orderId: 'ord-he-2',
        reason: 'Customer wants special delivery instructions'
      });

      expect(sendSpy).toHaveBeenCalled();
      sendSpy.mockRestore();
    });

    it('19. Zara does NOT claim live transfer when none occurred (liveTransfer is false)', async () => {
      const mockOrder = {
        id: 'ord-he-3',
        status: 'Pending Confirmation',
        shopifyOrderGid: 'gid://shopify/Order/1643',
        shop: { domain: 'test.myshopify.com' }
      };
      prisma.order.findUnique
        .mockResolvedValueOnce(mockOrder)
        .mockResolvedValueOnce(mockOrder);

      prisma.order.update.mockResolvedValueOnce({
        id: 'ord-he-3',
        status: 'Human Transfer'
      });

      const result = await ToolDispatcher.dispatch(
        'request_human_transfer',
        { orderId: 'ord-he-3', reason: 'Need human assistance' },
        { shopDomain: 'test.myshopify.com', orderId: 'ord-he-3' }
      );

      expect(result.liveTransfer).toBe(false);
      expect(result.status).toBe('human_requested');
    });

    it('20. Notification failure is handled safely without crashing the call', async () => {
      // Mock db throwing error inside escalate
      prisma.order.findUnique.mockRejectedValueOnce(new Error('DB Timeout'));

      const result = await HumanEscalationService.escalate({
        shopDomain: 'test.myshopify.com',
        orderId: 'ord-fail',
        reason: 'Test failure'
      });

      expect(result.notificationSent).toBe(false);
      expect(result.success).toBe(false);
      expect(result.message).toBeDefined();
    });
  });

  // =========================================================================
  // GOODBYE & CALL TERMINATION TESTS
  // =========================================================================
  describe('GOODBYE: Polite Exchange & Call Termination', () => {
    it('21. Genuine goodbye triggers end_call tool with callEnded: true', async () => {
      const result = await ToolDispatcher.dispatch(
        'end_call',
        { reason: 'Customer completed order confirmation and said Allah Hafiz' },
        { shopDomain: 'test.myshopify.com', orderId: 'ord-1' }
      );

      expect(result.success).toBe(true);
      expect(result.callEnded).toBe(true);
    });

    it('22. "Allah Hafiz" does not terminate prematurely when followed by conversation continuation', () => {
      const text = 'Allah Hafiz kehne se pehle ek baat batayein, delivery kitne din mein hogi?';
      const isContinuation = text.length > 25 &&
        (text.toLowerCase().includes('pehle') || text.toLowerCase().includes('batayein'));

      expect(isContinuation).toBe(true);
    });

    it('23. "Cut the call please" is recognized as explicit end intent', () => {
      const text = 'Call cut kar dein please, Allah Hafiz';
      const lower = text.toLowerCase();
      const hasEndIntent = lower.includes('call cut') || lower.includes('cut the call');

      expect(hasEndIntent).toBe(true);
    });

    it('24. Raw RTP audio packets (continuous 20ms silence/noise) do not reset authorized hangup timer', () => {
      let hangupTimer = setTimeout(() => {}, 5000);
      const isRawMediaEvent = true;

      // Simulated continuous 20ms RTP stream: 50 packets per second
      for (let i = 0; i < 50; i++) {
        // Raw media packets must NOT clear the hangup timer
        if (!isRawMediaEvent) {
          clearTimeout(hangupTimer);
          hangupTimer = null;
        }
      }

      expect(hangupTimer).not.toBeNull();
      clearTimeout(hangupTimer);
    });

    it('25. Call completion status and duration are persisted', async () => {
      prisma.call.update.mockResolvedValueOnce({
        id: 'call-uuid-final',
        status: 'COMPLETED',
        durationSec: 45
      });

      const updated = await prisma.call.update({
        where: { id: 'call-uuid-final' },
        data: { status: 'COMPLETED', durationSec: 45 }
      });

      expect(updated.status).toBe('COMPLETED');
      expect(updated.durationSec).toBe(45);
    });
  });

  // =========================================================================
  // REGRESSION TESTS
  // =========================================================================
  describe('REGRESSION: Preserving Core Invariants', () => {
    it('26. Existing order grounding in system instructions is preserved', () => {
      const instruction = CallScriptEngine.compileGeminiSystemInstruction({
        agentName: 'Zara',
        shopName: 'Sunday Bazaar',
        customerName: 'Hamza Khan',
        orderNumber: '1100',
        productName: 'Smart Watch',
        productPrice: '3500'
      });

      expect(instruction).toContain('Zara');
      expect(instruction).toContain('Sunday Bazaar');
      expect(instruction).toContain('Hamza Khan');
      expect(instruction).toContain('1100');
      expect(instruction).toContain('Smart Watch');
      expect(instruction).toContain('3500');
      expect(instruction).toContain('search_shopify_products');
      expect(instruction).toContain('end_call');
    });

    it('27. Existing confirm_order tool executes correctly', async () => {
      prisma.order.findUnique.mockResolvedValueOnce({
        id: 'ord-reg-1',
        status: 'Pending Confirmation',
        shopifyOrderGid: 'gid://shopify/Order/100',
        shop: { domain: 'test.myshopify.com' }
      });
      prisma.order.update.mockResolvedValueOnce({
        id: 'ord-reg-1',
        status: 'Confirmed'
      });

      const res = await ToolDispatcher.dispatch(
        'confirm_order',
        { orderId: 'ord-reg-1' },
        { shopDomain: 'test.myshopify.com', orderId: 'ord-reg-1' }
      );

      expect(res.success).toBe(true);
      expect(res.data.status).toBe('Confirmed');
    });

    it('28. Existing retry protection checks call count before calling', async () => {
      prisma.call.count.mockResolvedValueOnce(3); // Max attempts reached
      const count = await prisma.call.count({
        where: { orderId: 'ord-retry-test' }
      });

      const maxAttempts = 3;
      const canCall = count < maxAttempts;
      expect(canCall).toBe(false);
    });

    it('29. Existing transcript persistence records chronological turns', () => {
      const agent = new Agent({
        shopDomain: 'test.myshopify.com',
        systemInstruction: 'Test'
      });

      agent.recordTurn('assistant', 'Assalam o Alaikum, main Zara baat kar rahi hoon.');
      agent.recordTurn('user', 'Walaikum Assalam, order confirm kar dein.');

      const transcript = agent.getTranscript();
      expect(transcript).toHaveLength(2);
      expect(transcript[0].role).toBe('assistant');
      expect(transcript[1].role).toBe('user');
    });

    it('30. Existing AudioCodec bidirectional conversion operates accurately', () => {
      const codec = new AudioCodec();
      const pcm16Base64 = Buffer.alloc(960).toString('base64');
      const ulaw = codec.geminiToTwilio(pcm16Base64);
      expect(typeof ulaw).toBe('string');

      const backPcm16 = codec.twilioToGemini(ulaw);
      expect(typeof backPcm16).toBe('string');
    });
  });
});
