import { prisma } from '../lib/db.js';
import { addOrderTag } from '../integrations/shopify/orders.js';

export const OrderStatus = {
  PENDING: 'Pending Confirmation',
  IN_PROGRESS: 'In Progress',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
  HUMAN_REQUIRED: 'Human Transfer',
};

const VALID_TRANSITIONS = {
  [OrderStatus.PENDING]: [OrderStatus.IN_PROGRESS, OrderStatus.CONFIRMED, OrderStatus.CANCELLED, OrderStatus.HUMAN_REQUIRED],
  [OrderStatus.IN_PROGRESS]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED, OrderStatus.HUMAN_REQUIRED],
  [OrderStatus.CONFIRMED]: [OrderStatus.HUMAN_REQUIRED],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.HUMAN_REQUIRED]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED]
};

export class OrderStateMachine {
  constructor(orderId, expectedShopDomain) {
    this.orderId = orderId; // DB UUID
    this.expectedShopDomain = expectedShopDomain;
  }

  static isValidTransition(from, to) {
    const allowed = VALID_TRANSITIONS[from] || [];
    return allowed.includes(to);
  }

  isValidTransition(from, to) {
    return OrderStateMachine.isValidTransition(from, to);
  }

  async transition(newStatus, reason = '') {
    const order = await prisma.order.findUnique({
      where: { id: this.orderId },
      include: { shop: true }
    });

    if (!order) {
      throw new Error(`Order ${this.orderId} not found`);
    }
    
    if (this.expectedShopDomain && order.shop.domain !== this.expectedShopDomain) {
      throw new Error('Unauthorized cross-tenant access in StateMachine');
    }

    if (order.status === newStatus) return order;
    
    const allowed = VALID_TRANSITIONS[order.status] || [];
    if (!allowed.includes(newStatus)) {
      throw new Error(`Invalid state transition from ${order.status} to ${newStatus}`);
    }

    let shopifyOrderId = null;
    try {
      const payload = JSON.parse(order.payload || '{}');
      shopifyOrderId = payload.id;
    } catch (e) {
      console.warn('Failed to parse order payload for shopify ID');
    }
    
    if (!shopifyOrderId) {
      // Fallback if we somehow only have gid
      if (order.shopifyOrderGid) {
        shopifyOrderId = order.shopifyOrderGid.split('/').pop();
      }
    }

    // Handle side effects in Shopify FIRST so we don't end up in an inconsistent state
    if (shopifyOrderId) {
      try {
        if (newStatus === OrderStatus.CONFIRMED) {
          await addOrderTag(order.shop.domain, shopifyOrderId, 'COD_CONFIRMED');
          await addOrderTag(order.shop.domain, shopifyOrderId, 'AI Confirmed');
        } else if (newStatus === OrderStatus.CANCELLED) {
          await addOrderTag(order.shop.domain, shopifyOrderId, 'COD_CANCELLED');
          await addOrderTag(order.shop.domain, shopifyOrderId, 'AI Cancel Requested');
        } else if (newStatus === OrderStatus.HUMAN_REQUIRED) {
          await addOrderTag(order.shop.domain, shopifyOrderId, 'HUMAN_REVIEW_NEEDED');
          await addOrderTag(order.shop.domain, shopifyOrderId, 'AI Escalated');
        }
      } catch (err) {
        console.warn(`⚠️ Could not sync tag for ${newStatus} to Shopify (Order ${shopifyOrderId}):`, err.message);
      }
    }

    // Persist to DB if Shopify succeeded
    const updatedOrder = await prisma.order.update({
      where: { id: this.orderId },
      data: { status: newStatus }
    });

    return updatedOrder;
  }
}
