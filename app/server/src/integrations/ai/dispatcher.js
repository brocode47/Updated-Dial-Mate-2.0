import { z } from 'zod';
import * as ordersApi from '../shopify/orders.js';
import { searchShopifyProducts } from '../shopify/products.js';
import { OrderStateMachine, OrderStatus } from '../../services/OrderStateMachine.js';
import { HumanEscalationService } from '../../services/humanEscalationService.js';
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
    reason: z.string().optional().default('customer_requested')
  }),
  add_order_tag: z.object({
    orderId: z.string().describe('The internal database UUID of the order'),
    tag: z.string()
  }),
  schedule_callback: z.object({
    orderId: z.string().describe('The internal database UUID of the order'),
    reason: z.string().optional().default('customer_busy'),
    delay_minutes: z.union([z.number(), z.string()]).optional().transform((val) => {
      if (typeof val === 'string') {
        const parsed = parseInt(val, 10);
        return isNaN(parsed) ? null : parsed;
      }
      return val ?? null;
    }),
    requestedTime: z.string().optional()
  }).transform((data) => {
    let finalMinutes = data.delay_minutes;
    if (!finalMinutes && data.requestedTime) {
      const lower = data.requestedTime.toLowerCase();
      if (/kal|tomorrow/i.test(lower)) finalMinutes = 1440;
      else if (/shaam|evening/i.test(lower)) finalMinutes = 180;
      else if (/30/i.test(lower)) finalMinutes = 30;
      else if (/hour|ghanta/i.test(lower)) finalMinutes = 60;
    }
    return {
      ...data,
      delay_minutes: finalMinutes || 15
    };
  }),
  request_human_transfer: z.object({
    orderId: z.string().describe('The internal database UUID of the order'),
    reason: z.string().optional().default('human_requested')
  }),
  search_shopify_products: z.object({
    query: z.string().describe('The product title or keywords to search for in store catalog')
  }),
  end_call: z.object({
    reason: z.string().optional().default('conversation_completed')
  })
};

/**
 * Allowlist projection of an order record for tool responses.
 * Tool results are sent to Gemini and logged, so they must NEVER carry the
 * joined shop row (accessToken), internal call fields, or raw payloads.
 */
export function toSafeOrderResult(order) {
  if (!order || typeof order !== 'object') return order;
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    totalAmount: order.totalAmount,
    courierName: order.courierName ?? null,
    expectedDelivery: order.expectedDelivery ?? null
  };
}

/**
 * Dispatcher to securely execute AI tool calls inside a tenant context
 */
export async function dispatchToolCall(shopDomain, toolName, args, context = {}) {
  try {
    const schema = toolSchemas[toolName];
    if (!schema) {
      return { success: false, error: `Tool ${toolName} not found or unsupported` };
    }

    // Auto-inject orderId from active call context if missing
    const mergedArgs = { ...(args || {}) };
    if (!mergedArgs.orderId && context.orderId) {
      mergedArgs.orderId = context.orderId;
    }

    // Input validation
    const validatedArgs = schema.parse(mergedArgs);

    // Resolve orderId to internal database UUID if model provided orderNumber or alias (e.g. '#1099' or '1099')
    if (context.orderId) {
      if (!validatedArgs.orderId || 
          validatedArgs.orderId.startsWith('#') || 
          (context.orderNumber && (validatedArgs.orderId === context.orderNumber || validatedArgs.orderId === `#${context.orderNumber}`)) ||
          /^\d+$/.test(validatedArgs.orderId)) {
        validatedArgs.orderId = context.orderId;
      }
    }
    
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
        const order = await prisma.order.findUnique({
          where: { id: validatedArgs.orderId },
          include: { shop: true, customer: true }
        });
        if (!order) throw new Error(`Order ${validatedArgs.orderId} not found in DB`);
        if (order.shop.domain !== shopDomain) throw new Error('Unauthorized cross-tenant access');

        let parsedPayload = {};
        try { parsedPayload = JSON.parse(order.payload || '{}'); } catch (_) {}

        try {
          const sId = await getShopifyId(validatedArgs.orderId);
          const shopifyDetails = await ordersApi.fetchOrderDetails(shopDomain, sId);
          return { success: true, data: shopifyDetails };
        } catch (shopifyErr) {
          // Fallback to rich database record and payload
          let lineItems = [];
          if (Array.isArray(parsedPayload.line_items)) {
            lineItems = parsedPayload.line_items.map(i => ({
              title: i.title || i.name,
              variantTitle: i.variant_title || '',
              quantity: i.quantity || 1,
              price: i.price ? String(i.price) : ''
            }));
          }
          let shippingAddress = null;
          if (parsedPayload.shipping_address) {
            shippingAddress = [
              parsedPayload.shipping_address.address1,
              parsedPayload.shipping_address.address2,
              parsedPayload.shipping_address.city
            ].filter(Boolean).join(', ');
          }

          return {
            success: true,
            orderNumber: order.orderNumber,
            totalPrice: order.totalPrice || order.totalAmount,
            lineItems,
            shippingAddress,
            data: {
              orderNumber: order.orderNumber,
              totalAmount: order.totalAmount,
              status: order.status,
              line_items: parsedPayload.line_items || [],
              shipping_address: parsedPayload.shipping_address || null,
              customerName: order.customer ? `${order.customer.firstName || ''} ${order.customer.lastName || ''}`.trim() : 'Customer',
              courierName: order.courierName,
              expectedDelivery: order.expectedDelivery
            }
          };
        }
      }

      case 'get_customer': {
        const customer = await ordersApi.fetchCustomerDetails(shopDomain, validatedArgs.customerId);
        return { success: true, data: customer };
      }
      case 'confirm_order': {
        const stateMachine = new OrderStateMachine(validatedArgs.orderId, shopDomain);
        const updated = await stateMachine.transition(OrderStatus.CONFIRMED);
        return { success: true, data: toSafeOrderResult(updated) };
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
        return { success: true, data: toSafeOrderResult(updated) };
      }
      case 'add_order_tag': {
        const sId = await getShopifyId(validatedArgs.orderId);
        await ordersApi.addOrderTag(shopDomain, sId, validatedArgs.tag);
        return { success: true, data: { tagged: true, tag: validatedArgs.tag } };
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
        
        return {
          success: true,
          scheduled: true,
          delayMinutes: delay_minutes,
          reason: validatedArgs.reason,
          data: { scheduled: true, jobId: job?.id || jobId, delayMs }
        };
      }
      case 'request_human_transfer': {
        const stateMachine = new OrderStateMachine(validatedArgs.orderId, shopDomain);
        const updated = await stateMachine.transition(OrderStatus.HUMAN_REQUIRED, validatedArgs.reason);
        const escalation = await HumanEscalationService.escalate({
          shopDomain,
          orderId: validatedArgs.orderId,
          reason: validatedArgs.reason,
          context
        });
        return {
          success: true,
          status: 'human_requested',
          transferred: true,
          liveTransfer: false,
          notificationSent: escalation.notificationSent,
          reason: validatedArgs.reason,
          message: escalation.message,
          data: toSafeOrderResult(updated)
        };
      }
      case 'search_shopify_products': {
        const result = await searchShopifyProducts(shopDomain, validatedArgs.query);
        return result;
      }
      case 'end_call': {
        return {
          success: true,
          callEnded: true,
          reason: validatedArgs.reason,
          message: 'Call termination authorized after polite closing exchange.'
        };
      }
      default:
        return { success: false, error: 'Unknown tool' };
    }
  } catch (error) {
    console.error(`❌ Tool execution error [${toolName}] for shop ${shopDomain}:`, error.message);
    return { success: false, error: error.message };
  }
}

export const ToolDispatcher = {
  dispatch: (toolName, args, context = {}) => {
    const shopDomain = context.shopDomain || 'test.myshopify.com';
    return dispatchToolCall(shopDomain, toolName, args, context);
  }
};
