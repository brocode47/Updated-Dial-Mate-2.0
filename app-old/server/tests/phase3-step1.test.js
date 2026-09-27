import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatchToolCall } from '../src/integrations/ai/dispatcher.js';
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

describe('Phase 3 Step 1: AI Tool Dispatcher & Shopify Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should dispatch confirm_order and update status via StateMachine', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'db-uuid-123',
      status: 'Pending Confirmation',
      payload: JSON.stringify({ id: 9999 }),
      shop: { domain: 'test.myshopify.com' }
    });
    
    prisma.order.update.mockResolvedValue({
      id: 'db-uuid-123',
      status: 'Confirmed'
    });
    
    ordersApi.addOrderTag.mockResolvedValue({});

    const result = await dispatchToolCall('test.myshopify.com', 'confirm_order', { orderId: 'db-uuid-123' });
    
    expect(result.success).toBe(true);
    expect(result.data.status).toBe('Confirmed');
    
    // Check if Shopify addOrderTag was called with correct numeric ID
    expect(ordersApi.addOrderTag).toHaveBeenCalledWith('test.myshopify.com', 9999, 'COD_CONFIRMED');
    
    // Check DB update
    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { id: 'db-uuid-123' },
      data: { status: 'Confirmed' }
    });
  });

  it('should dispatch get_order and use numeric Shopify ID', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'db-uuid-123',
      payload: JSON.stringify({ id: 8888 }),
      shop: { domain: 'test.myshopify.com' }
    });
    
    ordersApi.fetchOrderDetails.mockResolvedValue({ id: 8888, total_price: '100' });

    const result = await dispatchToolCall('test.myshopify.com', 'get_order', { orderId: 'db-uuid-123' });
    
    expect(result.success).toBe(true);
    expect(ordersApi.fetchOrderDetails).toHaveBeenCalledWith('test.myshopify.com', 8888);
  });
});
