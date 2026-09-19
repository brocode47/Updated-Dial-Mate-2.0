import { prisma } from '../lib/db.js';
import { addOrderTag } from '../integrations/shopify/orders.js';

export const OrderStatus = {
  PENDING: 'Pending Confirmation',
  IN_PROGRESS: 'In Progress',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
  HUMAN_REQUIRED: 'Human Transfer',
};

export class OrderStateMachine {
  constructor(orderId) {
    this.orderId = orderId;
  }

  async transition(newStatus, reason = '') {
    const order = await prisma.order.findUnique({
      where: { id: this.orderId },
      include: { shop: true }
    });

    if (!order) {
      throw new Error(`Order ${this.orderId} not found`);
    }

    if (order.status === newStatus) return order;

    // Persist to DB
    const updatedOrder = await prisma.order.update({
      where: { id: this.orderId },
      data: { status: newStatus }
    });

    // Handle side effects in Shopify
    try {
      if (newStatus === OrderStatus.CONFIRMED) {
        await addOrderTag(order.shop.domain, this.orderId, 'COD_CONFIRMED');
      } else if (newStatus === OrderStatus.CANCELLED) {
        await addOrderTag(order.shop.domain, this.orderId, 'COD_CANCELLED');
        // Optionally append a note: `Cancelled by AI. Reason: ${reason}`
      } else if (newStatus === OrderStatus.HUMAN_REQUIRED) {
        await addOrderTag(order.shop.domain, this.orderId, 'HUMAN_REVIEW_NEEDED');
      }
    } catch (err) {
      console.error(`❌ Failed to sync status ${newStatus} to Shopify for order ${this.orderId}:`, err.message);
    }

    return updatedOrder;
  }
}
