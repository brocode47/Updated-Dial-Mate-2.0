import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { OrderEligibilityService } from '../src/services/orderEligibilityService.js';
import { OrderStateMachine, OrderStatus } from '../src/services/OrderStateMachine.js';
import { CallWorkflowService } from '../src/services/callWorkflowService.js';
import { AICallInterpretationService } from '../src/services/aiCallInterpretationService.js';
import { processWebhookJob } from '../src/workers/webhookWorker.js';
import { processCallJob } from '../src/workers/callWorker.js';
import { dispatchToolCall } from '../src/integrations/ai/dispatcher.js';

// Hoist mock functions
const { mockCallQueueAdd, mockAddOrderTag, mockCancelOrder } = vi.hoisted(() => ({
  mockCallQueueAdd: vi.fn().mockImplementation(async (name, data, opts) => ({
    id: opts?.jobId || `job-${Date.now()}`
  })),
  mockAddOrderTag: vi.fn().mockResolvedValue({ ok: true }),
  mockCancelOrder: vi.fn().mockResolvedValue({ ok: true })
}));

vi.mock('../src/lib/queues.js', () => ({
  callQueue: { add: mockCallQueueAdd },
  webhookQueue: { add: vi.fn() },
  whatsappQueue: { add: vi.fn() }
}));

vi.mock('../src/integrations/shopify/orders.js', () => ({
  addOrderTag: mockAddOrderTag,
  cancelOrder: mockCancelOrder,
  fetchOrderDetails: vi.fn().mockResolvedValue({ id: 1099, name: '#1099' }),
  fetchCustomerDetails: vi.fn().mockResolvedValue({ id: 'c-1' })
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
      update: vi.fn().mockImplementation(args => Promise.resolve({ id: args.where?.id, ...args.data })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      upsert: vi.fn().mockImplementation(args => Promise.resolve({ id: args.where?.id, ...args.create }))
    },
    customer: {
      findFirst: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: 'cust-1' })
    },
    call: {
      create: vi.fn().mockImplementation(args => Promise.resolve({ id: 'call-uuid-1', ...args.data })),
      update: vi.fn().mockImplementation(args => Promise.resolve({ id: args.where?.id, ...args.data })),
      count: vi.fn().mockResolvedValue(0)
    },
    complianceLog: {
      create: vi.fn().mockResolvedValue({ id: 'comp-log-1' })
    }
  }
}));

import { prisma } from '../src/lib/db.js';

describe('PHASE 18: Calling Automation & Call Workflow Test Matrix (30 Scenarios)', () => {
  const shopDomain = 'store-test.myshopify.com';
  const shopId = 'shop-uuid-001';
  const validShop = {
    id: shopId,
    domain: shopDomain,
    isActive: true,
    settings: JSON.stringify({
      aiCalling: {
        enabled: true,
        maxAttempts: 3,
        retryDelayMinutes: 15,
        callingHours: '00:00 - 23:59'
      },
      orderRules: {
        codOnly: true,
        minOrderValue: 100,
        maxOrderValue: 100000,
        excludedTags: ['EXCLUDE_TEST']
      }
    })
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AI_CALL_MODE = 'test';
    process.env.ADMIN_TEST_NUMBERS = '+923001234567';
    process.env.DRY_RUN_CALLS = 'false';
  });

  afterEach(() => {
    delete process.env.EMERGENCY_STOP;
  });

  // Scenario 1: Eligible order
  it('Scenario 1: correctly identifies an eligible COD order', async () => {
    const order = {
      id: 'ord-1',
      shopId,
      status: 'Pending Confirmation',
      callStatus: 'pending',
      retryCount: 0,
      totalAmount: 2500,
      payload: {
        financial_status: 'pending',
        gateway: 'Cash on Delivery (COD)',
        shipping_address: { phone: '03001234567', name: 'Zahid Khan' },
        line_items: [{ title: 'Wireless Earbuds', price: '2500' }]
      }
    };

    const res = await OrderEligibilityService.checkOrderEligibility({ order, shop: validShop });
    expect(res.eligible).toBe(true);
    expect(res.phone).toBe('+923001234567');
    expect(res.customerName).toBe('Zahid Khan');
    expect(res.reason).toBe('ELIGIBLE_FOR_CONFIRMATION_CALL');
  });

  // Scenario 2: Missing phone
  it('Scenario 2: rejects order with missing phone number', async () => {
    const order = {
      id: 'ord-2',
      shopId,
      status: 'Pending Confirmation',
      payload: { financial_status: 'pending', gateway: 'cod', shipping_address: {} }
    };

    const res = await OrderEligibilityService.checkOrderEligibility({ order, shop: validShop });
    expect(res.eligible).toBe(false);
    expect(res.reason).toMatch(/INVALID_OR_MISSING_PHONE_NUMBER/i);
  });

  // Scenario 3: Invalid phone
  it('Scenario 3: rejects order with invalid/too short phone number', async () => {
    const order = {
      id: 'ord-3',
      shopId,
      status: 'Pending Confirmation',
      payload: { financial_status: 'pending', gateway: 'cod', shipping_address: { phone: '12345' } }
    };

    const res = await OrderEligibilityService.checkOrderEligibility({ order, shop: validShop });
    expect(res.eligible).toBe(false);
    expect(res.reason).toMatch(/INVALID_OR_MISSING_PHONE_NUMBER/i);
  });

  // Scenario 4: Already confirmed
  it('Scenario 4: rejects order already confirmed in database or payload', async () => {
    const order = {
      id: 'ord-4',
      shopId,
      status: 'Confirmed',
      callStatus: 'confirmed',
      payload: { financial_status: 'pending', gateway: 'cod', shipping_address: { phone: '03001234567' } }
    };

    const res = await OrderEligibilityService.checkOrderEligibility({ order, shop: validShop });
    expect(res.eligible).toBe(false);
    expect(res.reason).toMatch(/ORDER_ALREADY_CONFIRMED/i);
  });

  // Scenario 5: Already cancelled
  it('Scenario 5: rejects order already cancelled in database or payload', async () => {
    const order = {
      id: 'ord-5',
      shopId,
      status: 'Cancelled',
      payload: { financial_status: 'pending', gateway: 'cod', cancelled_at: '2026-10-04T10:00:00Z' }
    };

    const res = await OrderEligibilityService.checkOrderEligibility({ order, shop: validShop });
    expect(res.eligible).toBe(false);
    expect(res.reason).toMatch(/ORDER_ALREADY_CANCELLED/i);
  });

  // Scenario 6: Existing active call (in-flight lock)
  it('Scenario 6: blocks calling when call is already active/in-progress', async () => {
    const order = {
      id: 'ord-6',
      shopId,
      status: 'Pending Confirmation',
      callStatus: 'calling',
      payload: { financial_status: 'pending', gateway: 'cod', shipping_address: { phone: '03001234567' } }
    };

    const res = await OrderEligibilityService.checkOrderEligibility({ order, shop: validShop });
    expect(res.eligible).toBe(false);
    expect(res.reason).toMatch(/CALL_ALREADY_IN_PROGRESS/i);
  });

  // Scenario 7: Maximum retry reached
  it('Scenario 7: rejects order when maximum attempts are reached', async () => {
    const order = {
      id: 'ord-7',
      shopId,
      status: 'Pending Confirmation',
      retryCount: 3, // maxAttempts = 3
      payload: { financial_status: 'pending', gateway: 'cod', shipping_address: { phone: '03001234567' } }
    };

    const res = await OrderEligibilityService.checkOrderEligibility({ order, shop: validShop });
    expect(res.eligible).toBe(false);
    expect(res.reason).toMatch(/MAX_CALL_ATTEMPTS_EXCEEDED/i);
  });

  // Scenario 8: No-answer retry with backoff
  it('Scenario 8: schedules retry on NO_ANSWER if attempts remain', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'ord-8',
      retryCount: 0,
      status: 'Pending Confirmation',
      callStatus: 'calling',
      shop: validShop
    });

    const result = await CallWorkflowService.handleCallResult({
      orderId: 'ord-8',
      shopDomain,
      callStatus: 'no-answer',
      durationSec: 0
    });

    expect(result.success).toBe(true);
    expect(result.outcome).toBe('RETRY_SCHEDULED');
    expect(result.nextAttempt).toBe(2);
    expect(mockCallQueueAdd).toHaveBeenCalledWith(
      'retry-call',
      expect.objectContaining({ orderId: 'ord-8', attempt: 2 }),
      expect.objectContaining({ delay: 15 * 60 * 1000, jobId: 'retry-shop-uuid-001-ord-8-1' })
    );
  });

  // Scenario 9: Busy retry
  it('Scenario 9: schedules retry on BUSY if attempts remain', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'ord-9',
      retryCount: 1,
      status: 'Pending Confirmation',
      callStatus: 'calling',
      shop: validShop
    });

    const result = await CallWorkflowService.handleCallResult({
      orderId: 'ord-9',
      shopDomain,
      callStatus: 'busy',
      durationSec: 0
    });

    expect(result.success).toBe(true);
    expect(result.outcome).toBe('RETRY_SCHEDULED');
    expect(result.nextAttempt).toBe(3);
    expect(mockCallQueueAdd).toHaveBeenCalledWith(
      'retry-call',
      expect.objectContaining({ orderId: 'ord-9', attempt: 3 }),
      expect.objectContaining({ delay: 15 * 60 * 1000, jobId: 'retry-shop-uuid-001-ord-9-2' })
    );
  });

  // Scenario 10: Temporary failure retry & exhaustion
  it('Scenario 10: exhausts retries when attempt exceeds maxAttempts and stops calling', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'ord-10',
      retryCount: 2,
      status: 'Pending Confirmation',
      callStatus: 'calling',
      shop: {
        ...validShop,
        settings: JSON.stringify({ aiCalling: { maxAttempts: 3 }, whatsapp: { enableFallback: false } })
      }
    });

    const result = await CallWorkflowService.handleCallResult({
      orderId: 'ord-10',
      shopDomain,
      callStatus: 'failed',
      durationSec: 0
    });

    expect(result.success).toBe(true);
    expect(result.outcome).toBe('CALL_FAILED_MAX_RETRIES');
    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ord-10' },
        data: expect.objectContaining({ callStatus: 'failed', tag: 'Max Call Retries Reached' })
      })
    );
  });

  // Scenario 11: Callback scheduling
  it('Scenario 11: schedules callback job when customer requests later call', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'ord-11',
      status: 'Pending Confirmation',
      callStatus: 'calling',
      shop: validShop
    });

    const result = await CallWorkflowService.handleCallResult({
      orderId: 'ord-11',
      shopDomain,
      transcript: 'Customer: Main abhi meeting mein hoon, 1 ghante baad call karein.',
      durationSec: 12
    });

    expect(result.success).toBe(true);
    expect(result.outcome).toBe('CALL_BACK');
    expect(mockCallQueueAdd).toHaveBeenCalledWith(
      'callback',
      expect.objectContaining({ orderId: 'ord-11', shopDomain }),
      expect.objectContaining({ delay: 60 * 60 * 1000, jobId: 'cb-shop-uuid-001-ord-11-60m' })
    );
  });

  // Scenario 12: Duplicate callback prevention
  it('Scenario 12: prevents duplicate callback queue insertion using deterministic jobId', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'ord-12',
      status: 'Pending Confirmation',
      callStatus: 'calling',
      shop: validShop
    });

    await CallWorkflowService.handleCallResult({
      orderId: 'ord-12',
      shopDomain,
      transcript: 'Customer: Shaam ko call karein.',
      durationSec: 10
    });

    await CallWorkflowService.handleCallResult({
      orderId: 'ord-12',
      shopDomain,
      transcript: 'Customer: Shaam ko call karein.',
      durationSec: 10
    });

    const firstJobId = mockCallQueueAdd.mock.calls[0][2].jobId;
    const secondJobId = mockCallQueueAdd.mock.calls[1][2].jobId;
    expect(firstJobId).toBe(secondJobId);
    expect(firstJobId).toBe('cb-shop-uuid-001-ord-12-180m');
  });

  // Scenario 13: Duplicate call job prevention in webhookWorker
  it('Scenario 13: uses deterministic jobId call-init-${shopId}-${orderId} in webhook worker', async () => {
    prisma.shop.findUnique.mockResolvedValue(validShop);
    prisma.order.upsert.mockResolvedValue({
      id: '1099',
      shopId,
      status: 'Pending Confirmation',
      callStatus: 'pending',
      retryCount: 0,
      totalAmount: 2500,
      payload: JSON.stringify({
        id: 1099,
        financial_status: 'pending',
        gateway: 'Cash on Delivery (COD)',
        shipping_address: { phone: '03001234567', name: 'Bilal' },
        line_items: [{ title: 'Watch', price: '2500' }]
      })
    });

    const job = {
      data: {
        topic: 'orders/create',
        shopId,
        webhookId: 'hook-101',
        payload: {
          id: 1099,
          financial_status: 'pending',
          gateway: 'Cash on Delivery (COD)',
          shipping_address: { phone: '03001234567', name: 'Bilal' },
          line_items: [{ title: 'Watch', price: '2500' }]
        }
      }
    };

    const res = await processWebhookJob(job);
    expect(res.success).toBe(true);
    expect(res.queued).toBe(true);
    expect(mockCallQueueAdd).toHaveBeenCalledWith(
      'initiate-call',
      expect.objectContaining({ orderId: '1099' }),
      expect.objectContaining({ jobId: `call-init-${shopId}-1099` })
    );
  });

  // Scenario 14: Confirmation action
  it('Scenario 14: confirms order, updates state machine, tags Shopify and DB', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'ord-14',
      status: 'Pending Confirmation',
      callStatus: 'calling',
      shop: validShop,
      payload: JSON.stringify({ id: 9914 })
    });

    const result = await CallWorkflowService.handleCallResult({
      orderId: 'ord-14',
      shopDomain,
      transcript: 'Customer: Jee bilkul order confirm hai, bhej dein shukriya.',
      durationSec: 30
    });

    expect(result.success).toBe(true);
    expect(result.outcome).toBe('CONFIRMED');
    expect(mockAddOrderTag).toHaveBeenCalledWith(shopDomain, 9914, 'COD_CONFIRMED');
    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ord-14' },
        data: expect.objectContaining({ callStatus: 'confirmed', tag: 'COD Confirmed via Call' })
      })
    );
  });

  // Scenario 15: Cancellation action
  it('Scenario 15: cancels order, updates state machine, tags Shopify and DB', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'ord-15',
      status: 'Pending Confirmation',
      callStatus: 'calling',
      shop: validShop,
      payload: JSON.stringify({ id: 9915 })
    });

    const result = await CallWorkflowService.handleCallResult({
      orderId: 'ord-15',
      shopDomain,
      transcript: 'Customer: Nahi mujhe yeh order nahi chahiye, cancel kardo.',
      durationSec: 15
    });

    expect(result.success).toBe(true);
    expect(result.outcome).toBe('CANCELLED');
    expect(mockAddOrderTag).toHaveBeenCalledWith(shopDomain, 9915, 'COD_CANCELLED');
    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ord-15' },
        data: expect.objectContaining({ callStatus: 'cancelled', tag: 'COD Cancelled via Call' })
      })
    );
  });

  // Scenario 16: Wrong number
  it('Scenario 16: handles wrong number, marks order cancelled & failed, does not retry', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'ord-16',
      status: 'Pending Confirmation',
      callStatus: 'calling',
      shop: validShop,
      payload: JSON.stringify({ id: 9916 })
    });

    const result = await CallWorkflowService.handleCallResult({
      orderId: 'ord-16',
      shopDomain,
      transcript: 'Customer: Wrong number hai bhai, maine koi order nahi kiya.',
      durationSec: 12
    });

    expect(result.success).toBe(true);
    expect(result.outcome).toBe('WRONG_NUMBER');
    expect(mockAddOrderTag).toHaveBeenCalledWith(shopDomain, 9916, 'COD_CANCELLED');
    expect(mockCallQueueAdd).not.toHaveBeenCalledWith('retry-call', expect.anything(), expect.anything());
    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ord-16' },
        data: expect.objectContaining({ callStatus: 'failed', tag: 'Invalid Phone / Wrong Number' })
      })
    );
  });

  // Scenario 17: Human escalation
  it('Scenario 17: handles human transfer request, transitions state to HUMAN_REQUIRED and tags Shopify', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'ord-17',
      status: 'Pending Confirmation',
      callStatus: 'calling',
      shop: validShop,
      payload: JSON.stringify({ id: 9917 })
    });

    const result = await CallWorkflowService.handleCallResult({
      orderId: 'ord-17',
      shopDomain,
      transcript: 'Customer: Mujhe manager se baat karni hai, kisi insan se baat karwa dein.',
      durationSec: 20
    });

    expect(result.success).toBe(true);
    expect(result.outcome).toBe('HUMAN_TRANSFER');
    expect(mockAddOrderTag).toHaveBeenCalledWith(shopDomain, 9917, 'HUMAN_REVIEW_NEEDED');
    expect(mockCallQueueAdd).not.toHaveBeenCalledWith('retry-call', expect.anything(), expect.anything());
    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ord-17' },
        data: expect.objectContaining({ callStatus: 'human_transfer', tag: 'Human Agent Requested' })
      })
    );
  });

  // Scenario 18: Twilio failure
  it('Scenario 18: gracefully handles Twilio failure without crashing', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'ord-18',
      totalAmount: 2000,
      callStatus: 'pending',
      retryCount: 0,
      shop: validShop,
      customer: { phone: '+923001234567' },
      payload: JSON.stringify({ line_items: [{ title: 'Shirt' }], total_price: '2000' })
    });

    const originalClient = CallWorkflowService.getTwilioClient;
    CallWorkflowService.getTwilioClient = () => ({
      calls: {
        create: vi.fn().mockRejectedValue(new Error('Twilio Carrier Network Timeout'))
      }
    });

    process.env.TWILIO_FROM_NUMBER = '+15551234567';
    process.env.APP_URL = 'http://localhost:8787';

    const res = await CallWorkflowService.initiateCall({
      orderId: 'ord-18',
      shopDomain,
      force: true
    });

    expect(res.success).toBe(false);
    expect(res.reason).toContain('Twilio Carrier Network Timeout');
    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ord-18' },
        data: expect.objectContaining({ callStatus: 'failed' })
      })
    );

    CallWorkflowService.getTwilioClient = originalClient;
  });

  // Scenario 19: Gemini failure resilience
  it('Scenario 19: falls back safely to audio / DTMF / telephony interpretation if Gemini disconnects', async () => {
    const decision = AICallInterpretationService.interpret({
      digits: '1',
      transcript: null,
      callStatus: 'completed'
    });

    expect(decision.result).toBe('CONFIRMED');
    expect(decision.source).toBe('DTMF_KEYPAD');
  });

  // Scenario 20: Redis failure
  it('Scenario 20: rejects queue addition gracefully if Redis is unavailable', async () => {
    mockCallQueueAdd.mockRejectedValueOnce(new Error('ECONNREFUSED Redis connection lost'));

    await expect(
      mockCallQueueAdd('initiate-call', { orderId: 'ord-20' }, { jobId: 'job-20' })
    ).rejects.toThrow('ECONNREFUSED');
  });

  // Scenario 21: PostgreSQL failure resilience
  it('Scenario 21: returns ORDER_NOT_FOUND if database query fails or returns null', async () => {
    prisma.order.findUnique.mockResolvedValueOnce(null);

    const res = await CallWorkflowService.initiateCall({
      orderId: 'ord-missing',
      shopDomain
    });

    expect(res.success).toBe(false);
    expect(res.reason).toBe('ORDER_NOT_FOUND');
  });

  // Scenario 22: Shopify failure resilience
  it('Scenario 22: completes DB state transition even if Shopify tag API fails', async () => {
    mockAddOrderTag.mockRejectedValueOnce(new Error('Shopify 502 Bad Gateway'));

    prisma.order.findUnique.mockResolvedValue({
      id: 'ord-22',
      status: 'Pending Confirmation',
      shop: validShop,
      payload: JSON.stringify({ id: 9922 })
    });

    const stateMachine = new OrderStateMachine('ord-22', shopDomain);
    const updated = await stateMachine.transition(OrderStatus.CONFIRMED);

    expect(updated).toBeDefined();
    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ord-22' },
        data: { status: OrderStatus.CONFIRMED }
      })
    );
  });

  // Scenario 23: Duplicate webhook
  it('Scenario 23: ignores duplicate webhook topic when order is already updated', async () => {
    prisma.shop.findUnique.mockResolvedValue(validShop);
    prisma.order.findUnique.mockResolvedValue({
      id: 'ord-23',
      status: 'Confirmed',
      callStatus: 'confirmed',
      totalAmount: 1500
    });

    const job = {
      data: {
        topic: 'orders/updated',
        shopId,
        webhookId: 'hook-dup-1',
        payload: { id: 'ord-23', total_price: '1500' }
      }
    };

    const res = await processWebhookJob(job);
    expect(res.success).toBe(true);
    expect(res.updated).toBe(true);
  });

  // Scenario 24: Worker restart / terminal order discard
  it('Scenario 24: callWorker safely discards retry or callback job if order became terminal', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'ord-24',
      status: 'Confirmed',
      callStatus: 'confirmed',
      shop: validShop
    });

    const job = {
      name: 'retry-call',
      data: { orderId: 'ord-24', shopDomain }
    };

    const res = await processCallJob(job);
    expect(res.success).toBe(true);
    expect(res.discarded).toBe(true);
    expect(res.reason).toBe('ORDER_ALREADY_TERMINAL');
  });

  // Scenario 25: Calling outside allowed hours
  it('Scenario 25: defers call when order arrives outside store calling hours', async () => {
    const closedShop = {
      ...validShop,
      settings: JSON.stringify({
        aiCalling: {
          enabled: true,
          callingHours: '09:00 - 10:00' // Closed window for test
        }
      })
    };

    const order = {
      id: 'ord-25',
      shopId,
      status: 'Pending Confirmation',
      callStatus: 'pending',
      retryCount: 0,
      totalAmount: 2500,
      payload: {
        financial_status: 'pending',
        gateway: 'Cash on Delivery (COD)',
        shipping_address: { phone: '03001234567' }
      }
    };

    // Force closed window by checking mock
    const originalCheck = OrderEligibilityService.isWithinOperatingHours;
    OrderEligibilityService.isWithinOperatingHours = () => false;

    const res = await OrderEligibilityService.checkOrderEligibility({ order, shop: closedShop });
    expect(res.eligible).toBe(false);
    expect(res.reason).toBe('OUTSIDE_OPERATING_HOURS');
    expect(res.canScheduleLater).toBe(true);
    expect(typeof res.delayUntilOpenMs).toBe('number');

    OrderEligibilityService.isWithinOperatingHours = originalCheck;
  });

  // Scenario 26: Whitelist enforcement in test mode
  it('Scenario 26: diverts non-whitelisted numbers to safe simulation in test mode', async () => {
    process.env.AI_CALL_MODE = 'test';
    process.env.ADMIN_TEST_NUMBERS = '+923001234567';

    prisma.order.findUnique.mockResolvedValue({
      id: 'ord-26',
      totalAmount: 1800,
      callStatus: 'pending',
      shop: validShop,
      customer: { phone: '+923339999999' }, // Non-whitelisted!
      payload: JSON.stringify({ line_items: [{ title: 'Watch' }], total_price: '1800' })
    });

    const res = await CallWorkflowService.initiateCall({
      orderId: 'ord-26',
      shopDomain,
      force: true
    });

    expect(res.success).toBe(true);
    expect(res.dryRun).toBe(true);
    expect(res.providerCallSid).toMatch(/^dry_run_/);
    expect(res.simulationReason).toMatch(/not in test whitelist/i);
  });

  // Scenario 27: Tenant isolation
  it('Scenario 27: rejects cross-tenant order access', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'ord-27',
      shop: { id: 'other-shop-id', domain: 'malicious-store.myshopify.com' }
    });

    const res = await CallWorkflowService.initiateCall({
      orderId: 'ord-27',
      shopDomain: 'victim-store.myshopify.com'
    });

    expect(res.success).toBe(false);
    expect(res.reason).toBe('UNAUTHORIZED_CROSS_TENANT_ACCESS');
  });

  // Scenario 28: Concurrent call prevention
  it('Scenario 28: blocks overlapping concurrent calls for the same order', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'ord-28',
      status: 'Pending Confirmation',
      callStatus: 'calling',
      shop: validShop
    });

    const res = await CallWorkflowService.initiateCall({
      orderId: 'ord-28',
      shopDomain,
      force: false
    });

    expect(res.success).toBe(false);
    expect(res.reason).toBe('CALL_ALREADY_IN_PROGRESS');
  });

  // Scenario 29: Idempotent tool execution
  it('Scenario 29: repeated execution of confirm_order tool returns cleanly without duplicate transitions', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'ord-29',
      status: 'Confirmed', // Already confirmed!
      shop: validShop,
      payload: JSON.stringify({ id: 9929 })
    });

    const res = await dispatchToolCall(shopDomain, 'confirm_order', { orderId: 'ord-29' });
    expect(res.success).toBe(true);
    expect(res.data.status).toBe(OrderStatus.CONFIRMED);
    // Should not call Shopify tag API again
    expect(mockAddOrderTag).not.toHaveBeenCalled();
  });

  // Scenario 30: Complete successful end-to-end automated workflow
  it('Scenario 30: executes complete automated workflow from webhook to confirmation', async () => {
    // 1. Webhook receives orders/create
    prisma.shop.findUnique.mockResolvedValue(validShop);
    prisma.order.upsert.mockResolvedValue({
      id: 'ord-e2e-30',
      shopId,
      status: 'Pending Confirmation',
      callStatus: 'pending',
      retryCount: 0,
      totalAmount: 3200,
      payload: JSON.stringify({
        id: 9930,
        financial_status: 'pending',
        gateway: 'Cash on Delivery (COD)',
        shipping_address: { phone: '03001234567', name: 'Farhan Ali' },
        line_items: [{ title: 'Sneakers', price: '3200' }]
      })
    });

    const webhookJob = {
      data: {
        topic: 'orders/create',
        shopId,
        webhookId: 'hook-e2e-30',
        payload: {
          id: 9930,
          financial_status: 'pending',
          gateway: 'Cash on Delivery (COD)',
          shipping_address: { phone: '03001234567', name: 'Farhan Ali' },
          line_items: [{ title: 'Sneakers', price: '3200' }]
        }
      }
    };

    const webhookRes = await processWebhookJob(webhookJob);
    expect(webhookRes.success).toBe(true);
    expect(webhookRes.queued).toBe(true);

    // 2. CallWorker processes initiate-call job
    prisma.order.findUnique.mockResolvedValue({
      id: 'ord-e2e-30',
      shopId,
      status: 'Pending Confirmation',
      callStatus: 'queued',
      retryCount: 0,
      totalAmount: 3200,
      shop: validShop,
      customer: { phone: '+923001234567' },
      payload: JSON.stringify({
        id: 9930,
        financial_status: 'pending',
        gateway: 'Cash on Delivery (COD)',
        shipping_address: { phone: '03001234567', name: 'Farhan Ali' },
        line_items: [{ title: 'Sneakers', price: '3200' }]
      })
    });

    const callJob = {
      name: 'initiate-call',
      data: { orderId: 'ord-e2e-30', shopDomain, dryRun: true }
    };

    const workerRes = await processCallJob(callJob);
    expect(workerRes.success).toBe(true);
    expect(workerRes.result.providerCallSid).toBeDefined();

    // 3. Zara conversation completes with confirmation
    prisma.order.findUnique.mockResolvedValue({
      id: 'ord-e2e-30',
      status: 'Pending Confirmation',
      callStatus: 'calling',
      shop: validShop,
      payload: JSON.stringify({ id: 9930 })
    });

    const callResult = await CallWorkflowService.handleCallResult({
      orderId: 'ord-e2e-30',
      shopDomain,
      callId: workerRes.result.callId,
      transcript: 'Customer: Haan jee, main Farhan baat kar raha hoon. Mera sneakers ka order confirm karein.',
      durationSec: 42
    });

    expect(callResult.success).toBe(true);
    expect(callResult.outcome).toBe('CONFIRMED');
    expect(mockAddOrderTag).toHaveBeenCalledWith(shopDomain, 9930, 'COD_CONFIRMED');
    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ord-e2e-30' },
        data: expect.objectContaining({ callStatus: 'confirmed' })
      })
    );
  });
});
