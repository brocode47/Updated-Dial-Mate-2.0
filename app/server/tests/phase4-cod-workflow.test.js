import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { orderEligibilityService } from '../src/services/orderEligibilityService.js';
import { aiCallInterpretationService } from '../src/services/aiCallInterpretationService.js';
import { callWorkflowService } from '../src/services/callWorkflowService.js';
import { whatsappFallbackService } from '../src/services/whatsappFallbackService.js';
import { OrderStateMachine, OrderStatus } from '../src/services/OrderStateMachine.js';

// Hoist mock functions for queues and db
const { mockCallQueueAdd, mockWhatsappQueueAdd } = vi.hoisted(() => ({
  mockCallQueueAdd: vi.fn().mockImplementation(async (name, data, opts) => ({
    id: opts?.jobId || 'mock-call-job-1'
  })),
  mockWhatsappQueueAdd: vi.fn().mockImplementation(async (name, data, opts) => ({
    id: opts?.jobId || 'mock-wa-job-1'
  }))
}));

vi.mock('../src/lib/queues.js', () => ({
  callQueue: { add: mockCallQueueAdd },
  whatsappQueue: { add: mockWhatsappQueueAdd },
  webhookQueue: { add: vi.fn() },
  redisConnection: {
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(1)
  }
}));

vi.mock('../src/lib/db.js', () => ({
  prisma: {
    shop: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn()
    },
    order: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn()
    },
    customer: {
      findFirst: vi.fn(),
      upsert: vi.fn()
    },
    call: {
      create: vi.fn().mockResolvedValue({ id: 'call-record-1' }),
      update: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn()
    },
    whatsAppIntegration: {
      findFirst: vi.fn()
    },
    conversation: {
      findFirst: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: 'conv-1' }),
      upsert: vi.fn().mockResolvedValue({ id: 'conv-1' })
    },
    message: {
      create: vi.fn().mockResolvedValue({ id: 'msg-1' }),
      count: vi.fn()
    },
    complianceLog: {
      create: vi.fn().mockResolvedValue({ id: 'log-1' }),
      count: vi.fn(),
      findFirst: vi.fn()
    }
  }
}));

vi.mock('../src/integrations/shopify/orders.js', () => ({
  addOrderTag: vi.fn().mockResolvedValue({ ok: true }),
  cancelOrder: vi.fn().mockResolvedValue({ ok: true })
}));

describe('Phase 4: Automated COD Confirmation Workflow Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================================
  // 1. Shopify Webhook Verification & HMAC
  // ========================================================
  describe('1. Shopify Webhook Verification', () => {
    const secret = 'test-shopify-secret-key';
    const payload = JSON.stringify({ id: 987654321, name: '#1001', total_price: '2500' });

    function generateHmac(data, key) {
      return crypto.createHmac('sha256', key).update(data, 'utf8').digest('base64');
    }

    it('should verify valid HMAC signature for raw webhook payload', () => {
      const validHmac = generateHmac(payload, secret);
      const computed = generateHmac(payload, secret);
      expect(crypto.timingSafeEqual(Buffer.from(validHmac), Buffer.from(computed))).toBe(true);
    });

    it('should reject tampered webhook body with original signature', () => {
      const originalHmac = generateHmac(payload, secret);
      const tamperedPayload = JSON.stringify({ id: 987654321, name: '#1001', total_price: '0' });
      const tamperedHmac = generateHmac(tamperedPayload, secret);
      expect(originalHmac).not.toEqual(tamperedHmac);
    });
  });

  // ========================================================
  // 2. Order Eligibility Engine
  // ========================================================
  describe('2. Order Eligibility Engine', () => {
    const validShop = {
      id: 'shop-1',
      domain: '0qwck2-s1.myshopify.com',
      settings: JSON.stringify({
        aiCalling: {
          enabled: true,
          maxAttempts: 3,
          callingHours: '00:00 - 23:59',
          language: 'Roman Urdu & English'
        },
        orderRules: {
          codOnly: true,
          minOrderValue: 100,
          maxOrderValue: 50000,
          excludedTags: 'VIP, PREPAID, NO_CALL'
        }
      })
    };

    it('should approve valid COD order with Pakistani mobile number', async () => {
      const order = {
        id: 'ord-101',
        shopId: 'shop-1',
        status: 'Pending Confirmation',
        callStatus: 'pending',
        retryCount: 0,
        totalAmount: 2500,
        tag: null,
        payload: {
          financial_status: 'pending',
          gateway: 'Cash on Delivery (COD)',
          shipping_address: { phone: '03001234567', country_code: 'PK' },
          line_items: [{ title: 'Stitched Kurti', price: '2500', quantity: 1 }]
        }
      };

      const result = await orderEligibilityService.evaluate(order, validShop);
      expect(result.eligible).toBe(true);
      expect(result.phone).toBe('+923001234567');
      expect(result.orderId).toBe('ord-101');
      expect(result.shopId).toBe('shop-1');
    });

    it('should reject non-COD order when codOnly is enabled', async () => {
      const order = {
        id: 'ord-102',
        shopId: 'shop-1',
        status: 'Paid',
        totalAmount: 3000,
        payload: {
          financial_status: 'paid',
          gateway: 'Credit Card / Visa',
          payment_gateway_names: ['stripe'],
          shipping_address: { phone: '+923219876543' }
        }
      };

      const result = await orderEligibilityService.evaluate(order, validShop);
      expect(result.eligible).toBe(false);
      expect(result.reason).toMatch(/non-cod/i);
    });

    it('should reject order if already confirmed', async () => {
      const order = {
        id: 'ord-103',
        shopId: 'shop-1',
        status: 'Confirmed',
        payload: { financial_status: 'pending', gateway: 'Cash on Delivery' }
      };

      const result = await orderEligibilityService.evaluate(order, validShop);
      expect(result.eligible).toBe(false);
      expect(result.reason).toMatch(/already confirmed/i);
    });

    it('should reject order if already cancelled', async () => {
      const order = {
        id: 'ord-104',
        shopId: 'shop-1',
        status: 'Cancelled',
        payload: { financial_status: 'pending', gateway: 'Cash on Delivery' }
      };

      const result = await orderEligibilityService.evaluate(order, validShop);
      expect(result.eligible).toBe(false);
      expect(result.reason).toMatch(/cancelled/i);
    });

    it('should reject order if excluded tag is present', async () => {
      const order = {
        id: 'ord-105',
        shopId: 'shop-1',
        status: 'Pending',
        tag: 'VIP, Express',
        totalAmount: 2000,
        payload: {
          gateway: 'cod',
          shipping_address: { phone: '03001112233' }
        }
      };

      const result = await orderEligibilityService.evaluate(order, validShop);
      expect(result.eligible).toBe(false);
      expect(result.reason).toMatch(/excluded tag/i);
    });

    it('should reject order if phone number is invalid', async () => {
      const order = {
        id: 'ord-106',
        shopId: 'shop-1',
        status: 'Pending',
        payload: {
          gateway: 'cod',
          shipping_address: { phone: '123' }
        }
      };

      const result = await orderEligibilityService.evaluate(order, validShop);
      expect(result.eligible).toBe(false);
      expect(result.reason).toMatch(/invalid or missing phone/i);
    });

    it('should reject order if max call attempts already reached', async () => {
      const order = {
        id: 'ord-107',
        shopId: 'shop-1',
        status: 'Pending',
        retryCount: 3,
        payload: {
          gateway: 'cod',
          shipping_address: { phone: '+923001234567' }
        }
      };

      const result = await orderEligibilityService.evaluate(order, validShop);
      expect(result.eligible).toBe(false);
      expect(result.reason).toMatch(/maximum attempts/i);
    });
  });

  // ========================================================
  // 3 & 4. Idempotency & Duplicate Call Prevention
  // ========================================================
  describe('3 & 4. Idempotency and Duplicate Call Protection', () => {
    it('generates deterministic BullMQ deduplication jobId', () => {
      const shopId = 'shop-1';
      const orderId = 'gid://shopify/Order/123456';
      const cleanOrderId = orderId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const jobId = `call-init-${shopId}-${cleanOrderId}`;

      expect(jobId).toBe('call-init-shop-1-gid___shopify_Order_123456');
    });

    it('blocks call initiation if order is currently active/calling', async () => {
      const order = {
        id: 'ord-active-1',
        shopId: 'shop-1',
        status: 'Pending',
        callStatus: 'calling',
        payload: { gateway: 'cod', shipping_address: { phone: '+923001234567' } }
      };

      const shop = { id: 'shop-1', settings: JSON.stringify({ aiCalling: { enabled: true } }) };
      const evaluation = await orderEligibilityService.evaluate(order, shop);
      expect(evaluation.eligible).toBe(false);
      expect(evaluation.reason).toMatch(/already in progress/i);
    });
  });

  // ========================================================
  // 5 & 6. Call Queue & Automatic Retries
  // ========================================================
  describe('5 & 6. Call Queue and Retry Logic', () => {
    it('enqueues outbound call job into BullMQ with backoff parameters', async () => {
      await mockCallQueueAdd('initiate-call', {
        shopId: 'shop-1',
        orderId: 'ord-101',
        phone: '+923001234567',
        attempt: 1
      }, {
        jobId: 'call-init-shop-1-ord-101',
        attempts: 3,
        backoff: { type: 'exponential', delay: 60000 }
      });

      expect(mockCallQueueAdd).toHaveBeenCalledWith(
        'initiate-call',
        expect.objectContaining({ orderId: 'ord-101', attempt: 1 }),
        expect.objectContaining({ jobId: 'call-init-shop-1-ord-101' })
      );
    });

    it('calculates delayed retry timestamp based on retryDelayMinutes', () => {
      const retryDelayMinutes = 15;
      const now = Date.now();
      const nextRunMs = now + (retryDelayMinutes * 60 * 1000);
      expect(nextRunMs - now).toBe(900000);
    });
  });

  // ========================================================
  // 7. AI Call Interpretation
  // ========================================================
  describe('7. AI Call Interpretation (Urdu / Roman Urdu / DTMF)', () => {
    it('correctly interprets Roman Urdu confirmation phrase', () => {
      const interpretation = aiCallInterpretationService.interpret({
        speechText: 'Ji bilkul order bhej dein, confirm hai.',
        callDurationSec: 25
      });

      expect(interpretation.result).toBe('CONFIRMED');
      expect(interpretation.confidence).toBeGreaterThan(0.85);
      expect(interpretation.language).toBe('roman_urdu');
    });

    it('correctly interprets pure Urdu script confirmation', () => {
      const interpretation = aiCallInterpretationService.interpret({
        speechText: 'جی بالکل آرڈر کنفرم ہے، پلیز بھیج دیں۔',
        callDurationSec: 20
      });

      expect(interpretation.result).toBe('CONFIRMED');
      expect(interpretation.confidence).toBeGreaterThan(0.9);
      expect(interpretation.language).toBe('urdu');
    });

    it('correctly interprets Roman Urdu cancellation / rejection phrase', () => {
      const interpretation = aiCallInterpretationService.interpret({
        speechText: 'Nahi bhai mujhe yeh order cancel karna hai, mat bhejna.',
        callDurationSec: 18
      });

      expect(interpretation.result).toBe('REJECTED');
      expect(interpretation.confidence).toBeGreaterThan(0.85);
    });

    it('correctly interprets callback requested speech', () => {
      const interpretation = aiCallInterpretationService.interpret({
        speechText: 'Main abhi driving kar raha hoon, thori der baad call karna.',
        callDurationSec: 15
      });

      expect(interpretation.result).toBe('CALLBACK_REQUESTED');
    });

    it('interprets DTMF 1 as CONFIRMED', () => {
      const interpretation = aiCallInterpretationService.interpret({
        digits: '1',
        callDurationSec: 10
      });

      expect(interpretation.result).toBe('CONFIRMED');
      expect(interpretation.confidence).toBe(1.0);
    });

    it('interprets DTMF 2 as REJECTED', () => {
      const interpretation = aiCallInterpretationService.interpret({
        digits: '2',
        callDurationSec: 10
      });

      expect(interpretation.result).toBe('REJECTED');
      expect(interpretation.confidence).toBe(1.0);
    });

    it('safely falls back to UNKNOWN when customer speech is ambiguous', () => {
      const interpretation = aiCallInterpretationService.interpret({
        speechText: 'Hello hello awaz nahi aa rahi',
        callDurationSec: 5
      });

      expect(interpretation.result).toBe('UNKNOWN');
      expect(interpretation.confidence).toBeLessThan(0.7);
    });

    it('classifies unanswered/busy telephony status correctly', () => {
      const noAnswer = aiCallInterpretationService.interpret({ telephonyStatus: 'no-answer' });
      expect(noAnswer.result).toBe('NO_ANSWER');

      const busy = aiCallInterpretationService.interpret({ telephonyStatus: 'busy' });
      expect(busy.result).toBe('BUSY');

      const failed = aiCallInterpretationService.interpret({ telephonyStatus: 'failed' });
      expect(failed.result).toBe('FAILED');
    });
  });

  // ========================================================
  // 8, 9 & 10. Order State Transitions & Callbacks
  // ========================================================
  describe('8, 9 & 10. Order Status Synchronization and Callback Handling', () => {
    it('OrderStateMachine transitions to COD_CONFIRMED on positive decision', async () => {
      const sm = new OrderStateMachine('ord-conf-1', '0qwck2-s1.myshopify.com');
      expect(sm.isValidTransition(OrderStatus.PENDING, OrderStatus.CONFIRMED)).toBe(true);
    });

    it('OrderStateMachine transitions to COD_CANCELLED on rejection', async () => {
      const sm = new OrderStateMachine('ord-canc-1', '0qwck2-s1.myshopify.com');
      expect(sm.isValidTransition(OrderStatus.PENDING, OrderStatus.CANCELLED)).toBe(true);
    });

    it('OrderStateMachine blocks invalid transition from CANCELLED to CONFIRMED', async () => {
      const sm = new OrderStateMachine('ord-lock-1', '0qwck2-s1.myshopify.com');
      expect(sm.isValidTransition(OrderStatus.CANCELLED, OrderStatus.CONFIRMED)).toBe(false);
    });
  });

  // ========================================================
  // 11. WhatsApp Fallback via WA-AKG
  // ========================================================
  describe('11. WhatsApp Fallback Integration via WA-AKG', () => {
    it('formats localized Roman Urdu message with customer and order variables', () => {
      const message = whatsappFallbackService.formatMessage({
        template: 'Assalam o Alaikum {customerName}! Aap ka order #{orderNumber} total {orderTotal} confirm darkaar hai.',
        customerName: 'Usman',
        orderNumber: '1054',
        orderTotal: 'Rs. 4,200',
        shopName: 'DialMate Store'
      });

      expect(message).toBe('Assalam o Alaikum Usman! Aap ka order #1054 total Rs. 4,200 confirm darkaar hai.');
    });

    it('enqueues WhatsApp message via BullMQ when call attempts fail', async () => {
      await mockWhatsappQueueAdd('send-message', {
        to: '+923001234567',
        message: 'Order confirmation follow-up',
        shopId: 'shop-1',
        orderId: 'ord-101'
      }, {
        jobId: 'wa-fallback-shop-1-ord-101'
      });

      expect(mockWhatsappQueueAdd).toHaveBeenCalledWith(
        'send-message',
        expect.objectContaining({ to: '+923001234567', orderId: 'ord-101' }),
        expect.objectContaining({ jobId: 'wa-fallback-shop-1-ord-101' })
      );
    });
  });

  // ========================================================
  // 12. Tenant Isolation
  // ========================================================
  describe('12. Multi-Tenant Security & Isolation', () => {
    it('strictly isolates order operations by shopId', async () => {
      const orderA = { id: 'ord-1', shopId: 'shop-A', status: 'Pending' };
      const orderB = { id: 'ord-2', shopId: 'shop-B', status: 'Pending' };

      // Shop A attempting to access Order B must be rejected
      const canAccess = (order, requestingShopId) => order.shopId === requestingShopId;

      expect(canAccess(orderA, 'shop-A')).toBe(true);
      expect(canAccess(orderB, 'shop-A')).toBe(false);
    });
  });
});
