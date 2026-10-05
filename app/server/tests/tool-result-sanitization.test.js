import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatchToolCall, toSafeOrderResult } from '../src/integrations/ai/dispatcher.js';
import * as ordersApi from '../src/integrations/shopify/orders.js';
import { prisma } from '../src/lib/db.js';

vi.mock('../src/integrations/shopify/orders.js');
vi.mock('../src/lib/db.js', () => ({
  prisma: {
    order: {
      findUnique: vi.fn(),
      update: vi.fn()
    }
  }
}));

const SECRET_TOKEN = 'shpca_SECRET_TOKEN_SHOULD_NEVER_LEAK';

const orderWithShopRow = (status) => ({
  id: 'db-uuid-1',
  orderNumber: 'P6-3410',
  status,
  totalAmount: 3200,
  courierName: null,
  expectedDelivery: null,
  payload: JSON.stringify({ id: 9999 }),
  tag: 'Call Error: internal twilio detail',
  callSid: 'CA_internal',
  shop: {
    id: 'shop-a',
    domain: 'test.myshopify.com',
    accessToken: SECRET_TOKEN,
    settings: '{"escalationNumber":"+920000000000"}'
  }
});

describe('Tool result sanitization (no secrets / internal fields reach Gemini or logs)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ordersApi.addOrderTag.mockResolvedValue({});
  });

  it('toSafeOrderResult returns only the allowlisted fields', () => {
    const safe = toSafeOrderResult(orderWithShopRow('Confirmed'));
    expect(Object.keys(safe).sort()).toEqual(
      ['courierName', 'expectedDelivery', 'id', 'orderNumber', 'status', 'totalAmount']
    );
    expect(JSON.stringify(safe)).not.toContain(SECRET_TOKEN);
  });

  it('confirm_order on an ALREADY-confirmed order (state-machine early return) does not leak the shop accessToken', async () => {
    prisma.order.findUnique.mockResolvedValue(orderWithShopRow('Confirmed'));

    const result = await dispatchToolCall('test.myshopify.com', 'confirm_order', { orderId: 'db-uuid-1' });

    expect(result.success).toBe(true);
    expect(result.data.status).toBe('Confirmed');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(SECRET_TOKEN);
    expect(serialized).not.toContain('accessToken');
    expect(serialized).not.toContain('callSid');
    expect(serialized).not.toContain('Call Error');
    expect(result.data.shop).toBeUndefined();
  });

  it('request_human_transfer result does not leak the shop row', async () => {
    prisma.order.findUnique.mockResolvedValue(orderWithShopRow('Human Transfer'));

    const result = await dispatchToolCall('test.myshopify.com', 'request_human_transfer', { orderId: 'db-uuid-1' });

    expect(result.success).toBe(true);
    expect(JSON.stringify(result)).not.toContain(SECRET_TOKEN);
  });

  it('cross-tenant tool call is still rejected', async () => {
    prisma.order.findUnique.mockResolvedValue(orderWithShopRow('Pending Confirmation'));

    const result = await dispatchToolCall('other-shop.myshopify.com', 'confirm_order', { orderId: 'db-uuid-1' });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain(SECRET_TOKEN);
  });
});
