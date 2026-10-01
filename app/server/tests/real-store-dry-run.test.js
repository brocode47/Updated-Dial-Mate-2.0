import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processWebhookJob } from '../src/workers/webhookWorker.js';
import { processCallJob } from '../src/workers/callWorker.js';
import { OrderEligibilityService } from '../src/services/orderEligibilityService.js';
import { CallWorkflowService } from '../src/services/callWorkflowService.js';

// Hoist mock functions
const { mockCallQueueAdd, mockPrisma } = vi.hoisted(() => {
  const queuedJobs = [];

  const mockPrisma = {
    shop: {
      findUnique: vi.fn(),
      findFirst: vi.fn()
    },
    order: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn()
    },
    customer: {
      findFirst: vi.fn(),
      create: vi.fn()
    },
    call: {
      create: vi.fn(),
      update: vi.fn()
    },
    complianceLog: {
      create: vi.fn().mockResolvedValue({ id: 'comp-1' })
    },
    webhookEvent: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'hook-1' })
    }
  };

  const mockCallQueueAdd = vi.fn().mockImplementation(async (name, data, opts) => {
    const job = {
      id: opts?.jobId || `job-${Date.now()}`,
      name,
      data: { ...data, dryRun: true },
      opts
    };
    queuedJobs.push(job);
    return job;
  });

  return { mockCallQueueAdd, mockPrisma };
});

vi.mock('../src/lib/queues.js', () => ({
  callQueue: { add: mockCallQueueAdd },
  webhookQueue: { add: vi.fn() },
  whatsappQueue: { add: vi.fn() }
}));

vi.mock('../src/lib/db.js', () => ({
  prisma: mockPrisma
}));

describe('STEP 4: Real Store Dry-Run Testing (0qwck2-s1.myshopify.com)', () => {
  const targetShopDomain = '0qwck2-s1.myshopify.com';
  const targetShopId = 'shop-0qwck2-s1-uuid';

  const mockShopRecord = {
    id: targetShopId,
    domain: targetShopDomain,
    name: 'Sunday Bazaar Test Store',
    isActive: true,
    settings: JSON.stringify({
      aiCalling: {
        enabled: true,
        maxAttempts: 3,
        callingHours: '24/7' // Allow 24/7 during automated tests
      },
      orderRules: {
        codOnly: true,
        minOrderValue: 100,
        maxOrderValue: 200000
      }
    })
  };

  const simulatedOrderPayload = {
    id: 9876543210,
    name: '#1099',
    order_number: 1099,
    current_total_price: '2850.00',
    total_price: '2850.00',
    currency: 'PKR',
    financial_status: 'pending',
    payment_gateway_names: ['Cash on Delivery (COD)'],
    gateway: 'Cash on Delivery (COD)',
    phone: '03001234567',
    customer: {
      id: 54321,
      first_name: 'Ahmed',
      last_name: 'Khan',
      phone: '03001234567',
      email: 'ahmed.khan@example.com'
    },
    shipping_address: {
      name: 'Ahmed Khan',
      first_name: 'Ahmed',
      last_name: 'Khan',
      phone: '03001234567',
      city: 'Karachi',
      country: 'Pakistan'
    },
    line_items: [
      {
        id: 112233,
        title: 'Premium Wireless Earbuds',
        price: '2850.00',
        quantity: 1
      }
    ]
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('executes full pipeline: Order -> Eligibility -> Queue -> Worker -> Twilio Request -> Call Record', async () => {
    // ==========================================
    // 1. SETUP DB MOCKS FOR THE TARGET STORE
    // ==========================================
    let storedOrder = {
      id: '#1099',
      shopId: targetShopId,
      customerId: 'cust-1',
      orderNumber: '1099',
      shopifyOrderGid: 'gid://shopify/Order/9876543210',
      payload: JSON.stringify(simulatedOrderPayload),
      status: 'Pending Confirmation',
      callStatus: 'pending',
      totalAmount: 2850.0,
      retryCount: 0,
      shop: mockShopRecord,
      customer: {
        id: 'cust-1',
        firstName: 'Ahmed',
        lastName: 'Khan',
        phone: '+923001234567'
      }
    };

    mockPrisma.shop.findUnique.mockResolvedValue(mockShopRecord);
    mockPrisma.order.findUnique.mockImplementation(async ({ where }) => {
      if (where.id === '#1099') return storedOrder;
      return null;
    });

    mockPrisma.order.upsert.mockImplementation(async ({ create }) => {
      storedOrder = { ...storedOrder, ...create };
      return storedOrder;
    });

    mockPrisma.order.update.mockImplementation(async ({ where, data }) => {
      storedOrder = { ...storedOrder, ...data };
      return storedOrder;
    });

    let createdCallRecord = null;
    mockPrisma.call.create.mockImplementation(async ({ data }) => {
      createdCallRecord = {
        id: 'call-uuid-999',
        ...data
      };
      return createdCallRecord;
    });

    mockPrisma.call.update.mockImplementation(async ({ where, data }) => {
      if (createdCallRecord && createdCallRecord.id === where.id) {
        createdCallRecord = { ...createdCallRecord, ...data };
      }
      return createdCallRecord;
    });

    // ==========================================
    // 2. SIMULATE NEW ORDER INGESTION (WEBHOOK)
    // ==========================================
    const webhookJob = {
      data: {
        topic: 'orders/create',
        payload: simulatedOrderPayload,
        shopId: targetShopId,
        webhookId: 'test-hook-uuid-001'
      }
    };

    const webhookResult = await processWebhookJob(webhookJob);

    // Verify webhook execution succeeded and enqueued call
    expect(webhookResult.success).toBe(true);
    expect(webhookResult.queued).toBe(true);
    expect(webhookResult.orderId).toBe('#1099');

    // ==========================================
    // 3. VERIFY DETERMINISTIC ELIGIBILITY CHECK
    // ==========================================
    const eligibility = await OrderEligibilityService.checkOrderEligibility({
      order: storedOrder,
      shop: mockShopRecord
    });

    expect(eligibility.eligible).toBe(true);
    expect(eligibility.reason).toBe('ELIGIBLE_FOR_CONFIRMATION_CALL');
    expect(eligibility.phone).toBe('+923001234567');
    expect(eligibility.productName).toBe('Premium Wireless Earbuds');
    expect(eligibility.productPrice).toBe('2850');
    expect(eligibility.ruleBreakdown.isCod).toBe(true);
    expect(eligibility.ruleBreakdown.validPhone).toBe(true);

    // ==========================================
    // 4. VERIFY ORDER STATUS IS 'QUEUED'
    // ==========================================
    expect(storedOrder.callStatus).toBe('queued');
    expect(storedOrder.tag).toBe('COD Confirmation Queued');
    expect(mockCallQueueAdd).toHaveBeenCalledTimes(1);

    const queuedCallJob = mockCallQueueAdd.mock.calls[0];
    expect(queuedCallJob[0]).toBe('initiate-call');
    expect(queuedCallJob[1].orderId).toBe('#1099');
    expect(queuedCallJob[1].phone).toBe('+923001234567');
    expect(queuedCallJob[2].jobId).toBe(`call-init-${targetShopId}-#1099`);

    // ==========================================
    // 5. WORKER PICKUP & DRY-RUN CALL EXECUTION
    // ==========================================
    const workerJob = {
      name: 'initiate-call',
      data: {
        orderId: '#1099',
        shopDomain: targetShopDomain,
        shopId: targetShopId,
        phone: eligibility.phone,
        customerName: eligibility.customerName,
        productName: eligibility.productName,
        productPrice: eligibility.productPrice,
        dryRun: true // Strictly Dry-Run: No real phone call placed
      }
    };

    const workerResult = await processCallJob(workerJob);

    // ==========================================
    // 6. VERIFY TWILIO REQUEST GENERATION & DB
    // ==========================================
    expect(workerResult.success).toBe(true);
    expect(workerResult.result.dryRun).toBe(true);
    expect(workerResult.result.providerCallSid).toMatch(/^dry_run_/);

    // Verify generated Twilio parameters
    const twilioPayload = workerResult.result.twilioPayload;
    expect(twilioPayload).toBeDefined();
    expect(twilioPayload.to).toBe('+923001234567');
    expect(twilioPayload.url).toContain('/twilio/voice?orderId=%231099');
    expect(twilioPayload.url).toContain('product=Premium%20Wireless%20Earbuds');
    expect(twilioPayload.statusCallback).toContain('/twilio/status?orderId=%231099');

    // ==========================================
    // 7. VERIFY DATABASE CALL RECORD CREATION
    // ==========================================
    expect(mockPrisma.call.create).toHaveBeenCalled();
    expect(createdCallRecord).toBeDefined();
    expect(createdCallRecord.orderId).toBe('#1099');
    expect(createdCallRecord.shopId).toBe(targetShopId);
    expect(createdCallRecord.outcome).toBe('Created');
    expect(createdCallRecord.providerCallSid).toBe(workerResult.result.providerCallSid);

    // Verify Order was updated with call SID
    expect(storedOrder.callSid).toBe(workerResult.result.providerCallSid);
  });
});
