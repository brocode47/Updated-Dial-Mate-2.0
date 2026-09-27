import { z } from 'zod';
import * as ordersApi from '../shopify/orders.js';
import { OrderStateMachine, OrderStatus } from '../../services/OrderStateMachine.js';
import { prisma } from '../../lib/db.js';

export const toolSchemas = {
  get_order: z.object({
    orderId: z.string().describe('The internal database UUID of the order')
  }),
  get_customer: z.object({
    customerId: z.string().describe('The Shopify internal ID of the customer')
  }),
  confirm_order: z.object({
    orderId: z.string().describe('The internal database UUID of the order')
  }),
  cancel_order: z.object({
    orderId: z.string().describe('The internal database UUID of the order'),
    reason: z.enum(['customer', 'inventory', 'fraud', 'declined', 'other']).default('customer')
  }),
  add_order_tag: z.object({
    orderId: z.string().describe('The internal database UUID of the order'),
    tag: z.string()
  }),
  schedule_callback: z.object({
    orderId: z.string().describe('The internal database UUID of the order'),
    reason: z.string(),
    delay_minutes: z.number().optional().default(15)
  }),
  request_human_transfer: z.object({
    orderId: z.string().describe('The internal database UUID of the order'),
    reason: z.string()
  })
};

/**
 * Dispatcher to securely execute AI tool calls inside a tenant context
 */
export async function dispatchToolCall(shopDomain, toolName, args, context = {}) {
  try {
    const schema = toolSchemas[toolName];
    if (!schema) {
      return { success: false, error: `Tool ${toolName} not found or unsupported` };
    }

    // Input validation
    const validatedArgs = schema.parse(args);
    
    // Helper to get Shopify ID
    const getShopifyId = async (dbOrderId) => {
      const order = await prisma.order.findUnique({ where: { id: dbOrderId }, include: { shop: true } });
      if (!order) throw new Error(`Order ${dbOrderId} not found in DB`);
      if (order.shop.domain !== shopDomain) throw new Error('Unauthorized cross-tenant access');
      let sId = null;
      try { sId = JSON.parse(order.payload || '{}').id; } catch (e) {}
      if (!sId && order.shopifyOrderGid) sId = order.shopifyOrderGid.split('/').pop();
      if (!sId) throw new Error(`Shopify ID not found for order ${dbOrderId}`);
      return sId;
    };
    
    switch (toolName) {
      case 'get_order': {
        const sId = await getShopifyId(validatedArgs.orderId);
        const order = await ordersApi.fetchOrderDetails(shopDomain, sId);
        return { success: true, data: order };
      }
      case 'get_customer': {
        const customer = await ordersApi.fetchCustomerDetails(shopDomain, validatedArgs.customerId);
        return { success: true, data: customer };
      }
      case 'confirm_order': {
        const stateMachine = new OrderStateMachine(validatedArgs.orderId, shopDomain);
        const updated = await stateMachine.transition(OrderStatus.CONFIRMED);
        return { success: true, data: updated };
      }
      case 'cancel_order': {
        const stateMachine = new OrderStateMachine(validatedArgs.orderId, shopDomain);
        const updated = await stateMachine.transition(OrderStatus.CANCELLED, validatedArgs.reason);
        // State machine handles tagging, but cancel API is separate
        const sId = await getShopifyId(validatedArgs.orderId);
        try {
          await ordersApi.cancelOrder(shopDomain, sId, validatedArgs.reason);
        } catch (e) {
          console.warn(`Could not cancel via API (maybe already canceled): ${e.message}`);
        }
        return { success: true, data: updated };
      }
      case 'add_order_tag': {
        const sId = await getShopifyId(validatedArgs.orderId);
        const order = await ordersApi.addOrderTag(shopDomain, sId, validatedArgs.tag);
        return { success: true, data: order };
      }
      case 'schedule_callback': {
        const order = await prisma.order.findUnique({ where: { id: validatedArgs.orderId }, include: { shop: true } });
        if (!order || order.shop.domain !== shopDomain) throw new Error('Unauthorized cross-tenant access');
        
        let payload = {};
        try { payload = JSON.parse(order.payload || '{}'); } catch(e){}
        const phone = order.customerPhone || payload.phone || payload.customer?.phone;
        
        if (!phone) throw new Error('Cannot schedule callback: no phone number found for order');

        const { callQueue } = await import('../../lib/queues.js');
        const delay_minutes = validatedArgs.delay_minutes || 15;
        const delayMs = delay_minutes * 60 * 1000;
        
        // Idempotency Design:
        // Use an explicit event identity (`context.eventId`) provided by the application boundary (e.g. Twilio webhook signature).
        // Include the requested schedule (delay_minutes) so multiple differing callbacks in the same event don't collide.
        // If the exact same callback event is retried (same API request), it uses the SAME eventId -> deduplicated by BullMQ.
        // Legitimate new callbacks from the same or later conversations will have a NEW eventId -> successfully scheduled.
        const eventId = context.eventId;
        if (!eventId) throw new Error('Callback scheduling requires an explicit event identity for deduplication');
        
        const crypto = await import('crypto');
        const reasonHash = crypto.createHash('sha256')
          .update((validatedArgs.reason || '').trim().toLowerCase())
          .digest('hex').substring(0, 8);
          
        const jobId = `cb-${shopDomain}-${order.id}-${reasonHash}-delay${delay_minutes}-${eventId}`;
        
        const job = await callQueue.add('callback', {
          phone,
          customerName: payload.customer?.first_name || 'Customer',
          orderId: order.id,
          reason: validatedArgs.reason
        }, {
          delay: delayMs,
          jobId
        });
        
        return { success: true, data: { scheduled: true, jobId: job.id, delayMs } };
      }
      case 'request_human_transfer': {
        const stateMachine = new OrderStateMachine(validatedArgs.orderId, shopDomain);
        const updated = await stateMachine.transition(OrderStatus.HUMAN_REQUIRED, validatedArgs.reason);
        return { success: true, data: updated };
      }
      default:
        return { success: false, error: 'Unknown tool' };
    }
  } catch (error) {
    console.error(`❌ Tool execution error [${toolName}] for shop ${shopDomain}:`, error.message);
    return { success: false, error: error.message };
  }
}
