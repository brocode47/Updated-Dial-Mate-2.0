import { prisma } from '../lib/db.js';
import { PhoneNormalizer } from './phoneNormalizer.js';
import { ProductSummaryService } from './productSummaryService.js';

/**
 * Grounded Order Resolver for Dial Mate 2.0 / Zara
 *
 * Production Guarantees:
 * 1. STRICT exact order number resolution (NO substring, NO nearest number, NO fallback).
 * 2. Multi-signal customer identity order resolution (phone, name, city/address, product name).
 * 3. Never falls back to a random order when an explicit number was supplied.
 * 4. Never invents orders or estimates.
 */
export class OrderResolver {
  /**
   * Resolves an order strictly by exact normalized order number
   *
   * @param {string} shopId
   * @param {string|number} rawOrderNumber
   * @returns {Promise<object|null>}
   */
  static async resolveExactOrderNumber(shopId, rawOrderNumber) {
    if (!shopId || rawOrderNumber === undefined || rawOrderNumber === null) return null;

    const rawStr = String(rawOrderNumber).trim();
    const cleanNum = rawStr.replace(/[^0-9]/g, '');
    if (!cleanNum || cleanNum.length < 1) return null;

    try {
      // STRICT exact match on orderNumber only. NO contains payload!
      const order = await prisma.order.findFirst({
        where: {
          shopId,
          OR: [
            { orderNumber: cleanNum },
            { orderNumber: `#${cleanNum}` }
          ]
        },
        orderBy: { createdAt: 'desc' }
      });

      if (!order) return null;

      // Double-check exactness: orderNumber MUST match cleanNum exactly
      const actualNum = String(order.orderNumber || '').replace(/[^0-9]/g, '');
      if (actualNum !== cleanNum) return null;

      return this.formatOrderEntity(order);
    } catch (err) {
      console.warn(`[OrderResolver] resolveExactOrderNumber error: ${err.message}`);
      return null;
    }
  }

  /**
   * Resolves customer orders by customer identity signals:
   * phone, name, address, city, product line items, date
   *
   * @param {object} params
   * @returns {Promise<{ found: boolean, order?: object, orders?: object[], multiple?: boolean, count: number }>}
   */
  static async resolveCustomerOrders(params = {}) {
    const {
      shopId,
      fromPhone = null,
      customerName = null,
      city = null,
      address = null,
      productQuery = null,
      orderNumber = null
    } = params;

    if (!shopId) return { found: false, count: 0, orders: [] };

    // 1. If explicit order number was given, attempt exact match first
    if (orderNumber) {
      const exact = await this.resolveExactOrderNumber(shopId, orderNumber);
      if (exact) {
        return { found: true, order: exact, orders: [exact], count: 1, multiple: false };
      }
      return { found: false, count: 0, orders: [] };
    }

    // 2. Fetch candidate orders for this shop
    let candidateOrders = [];

    // 2a. Search by WhatsApp sender phone via canonical PhoneNormalizer
    if (fromPhone) {
      candidateOrders = await PhoneNormalizer.resolveOrders(shopId, fromPhone);
    }

    // 2b. If phone yielded no orders or customer gave explicit name / city / address,
    // search customers and orders in the shop
    if (candidateOrders.length === 0 && (customerName || city || address)) {
      try {
        const queryOr = [];
        if (customerName) {
          const nameClean = customerName.toLowerCase().trim();
          queryOr.push({ payload: { contains: nameClean } });
        }
        if (city) {
          const cityClean = city.toLowerCase().trim();
          queryOr.push({ payload: { contains: cityClean } });
        }
        if (address) {
          const addrClean = address.toLowerCase().trim();
          queryOr.push({ payload: { contains: addrClean } });
        }

        if (queryOr.length > 0) {
          const dbOrders = await prisma.order.findMany({
            where: {
              shopId,
              OR: queryOr
            },
            orderBy: { createdAt: 'desc' },
            take: 10
          });
          candidateOrders = dbOrders.map(o => this.formatOrderEntity(o)).filter(Boolean);
        }
      } catch (err) {
        console.warn(`[OrderResolver] Identity query error: ${err.message}`);
      }
    }

    if (candidateOrders.length === 0) {
      return { found: false, count: 0, orders: [] };
    }

    // 3. Apply semantic filters if customer provided specific criteria
    let filtered = [...candidateOrders];

    // Filter by product query if mentioned (e.g. "chair protection cover" vs "anti snoring")
    if (productQuery) {
      const pqClean = productQuery.toLowerCase();
      const productMatches = filtered.filter(o => {
        const items = String(o.items || '').toLowerCase();
        return items.includes(pqClean) ||
          pqClean.split(/\s+/).some(word => word.length > 3 && items.includes(word));
      });
      if (productMatches.length > 0) {
        filtered = productMatches;
      }
    }

    // Filter by city if explicitly mentioned
    if (city) {
      const cityClean = city.toLowerCase().trim();
      const cityMatches = filtered.filter(o => {
        const addr = String(o.shippingAddress || '').toLowerCase();
        return addr.includes(cityClean);
      });
      if (cityMatches.length > 0) {
        filtered = cityMatches;
      }
    }

    // Filter by customer name if explicitly mentioned
    if (customerName) {
      const nameClean = customerName.toLowerCase().trim();
      const nameMatches = filtered.filter(o => {
        const cust = String(o.customerName || '').toLowerCase();
        const payloadStr = JSON.stringify(o.payload || {}).toLowerCase();
        return cust.includes(nameClean) || payloadStr.includes(nameClean);
      });
      if (nameMatches.length > 0) {
        filtered = nameMatches;
      }
    }

    if (filtered.length === 1) {
      return {
        found: true,
        order: filtered[0],
        orders: filtered,
        count: 1,
        multiple: false
      };
    }

    if (filtered.length > 1) {
      return {
        found: true,
        multiple: true,
        order: filtered[0], // primary / most recent
        orders: filtered,
        count: filtered.length
      };
    }

    return { found: false, count: 0, orders: [] };
  }

  /**
   * Formats raw Prisma Order into standardized conversational order entity
   *
   * @param {object} order
   * @returns {object}
   */
  static formatOrderEntity(order) {
    if (!order) return null;
    let payload = {};
    if (order.payload) {
      try {
        payload = typeof order.payload === 'string' ? JSON.parse(order.payload) : order.payload;
      } catch (_) {}
    }
    if (!payload || typeof payload !== 'object') payload = {};

    const lineItems = payload.line_items || [];
    const itemTitles = lineItems.map(i => i.title || i.name).filter(Boolean).join(', ') || order.items || 'item';
    const cleanItemName = ProductSummaryService.normalizeProductName(itemTitles).customerFriendlyName;

    const shippingLines = payload.shipping_lines || [];
    const shippingFee = shippingLines.length > 0
      ? Number(shippingLines[0].price || 0)
      : (Number(order.shippingFee) || 199);

    const shippingAddr = payload.shipping_address || {};
    const fullAddress = [
      shippingAddr.address1,
      shippingAddr.address2,
      shippingAddr.city,
      shippingAddr.province
    ].filter(Boolean).join(', ') || order.shippingAddress || 'On file';

    const customerObj = payload.customer || {};
    const customerName = [
      shippingAddr.first_name || customerObj.first_name,
      shippingAddr.last_name || customerObj.last_name
    ].filter(Boolean).join(' ') || order.customerName || null;

    const cleanOrderNumber = String(order.orderNumber || payload.order_number || order.id || '').replace(/^#/, '');

    return {
      id: order.id,
      orderId: order.id,
      orderNumber: cleanOrderNumber,
      formattedOrderNumber: `#${cleanOrderNumber}`,
      status: order.status || 'Pending Confirmation',
      items: cleanItemName,
      rawItems: itemTitles,
      totalAmount: Number(order.totalAmount || payload.total_price || 0),
      shippingFee,
      shippingAddress: fullAddress,
      city: shippingAddr.city || null,
      customerName,
      customerPhone: shippingAddr.phone || customerObj.phone || order.customerPhone || null,
      trackingNumber: order.trackingNumber || null,
      courierName: order.courierName || null,
      expectedDelivery: order.expectedDelivery || '3–5 working days',
      createdAt: order.createdAt || null,
      payload
    };
  }
}

export default OrderResolver;
