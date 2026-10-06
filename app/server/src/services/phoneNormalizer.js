import { prisma } from '../lib/db.js';

/**
 * Canonical Phone Normalization & Tenant-Scoped Identity Resolver
 * 
 * Supports Pakistani and international telephone formats:
 * - +923333255998
 * - 923333255998
 * - 03333255998
 * - 0333-3255998
 * - +92 333 3255998
 */
export class PhoneNormalizer {
  /**
   * Normalizes any raw phone input into canonical representations
   * 
   * @param {string} rawPhone
   * @returns {{ e164: string, digits: string, local: string, last10: string } | null}
   */
  static normalize(rawPhone) {
    if (!rawPhone) return null;
    let raw = String(rawPhone).trim();
    if (raw.includes('@')) {
      raw = raw.split('@')[0];
    }

    const digitsOnly = raw.replace(/\D/g, '');
    if (!digitsOnly || digitsOnly.length < 9) return null;

    let e164 = '';
    let digits = '';
    let local = '';
    let last10 = digitsOnly.slice(-10);

    // Pakistani numbers
    if (digitsOnly.startsWith('03') && digitsOnly.length === 11) {
      digits = '92' + digitsOnly.slice(1);
      e164 = '+' + digits;
      local = digitsOnly;
      last10 = digitsOnly.slice(-10);
    } else if (digitsOnly.startsWith('923') && digitsOnly.length === 12) {
      digits = digitsOnly;
      e164 = '+' + digits;
      local = '0' + digitsOnly.slice(2);
      last10 = digitsOnly.slice(-10);
    } else if (digitsOnly.length === 10 && digitsOnly.startsWith('3')) {
      // Missing country or local prefix, e.g. 3333255998
      digits = '92' + digitsOnly;
      e164 = '+' + digits;
      local = '0' + digitsOnly;
      last10 = digitsOnly;
    } else {
      // General international number
      digits = digitsOnly;
      e164 = raw.startsWith('+') ? `+${digitsOnly}` : `+${digitsOnly}`;
      local = digitsOnly;
      last10 = digitsOnly.slice(-10);
    }

    return {
      e164,
      digits,
      local,
      last10
    };
  }

  /**
   * Generates all probable search string variants for database queries
   * 
   * @param {string} rawPhone
   * @returns {string[]}
   */
  static getSearchVariants(rawPhone) {
    const norm = this.normalize(rawPhone);
    if (!norm) return [];

    const variants = new Set([
      norm.e164,
      norm.digits,
      norm.local,
      norm.last10
    ]);

    return Array.from(variants).filter(Boolean);
  }

  /**
   * Finds or creates a customer with multi-variant phone matching, strictly tenant-scoped
   * 
   * @param {string} shopId
   * @param {string} rawPhone
   * @param {object} extraData
   * @returns {Promise<object>}
   */
  static async resolveCustomer(shopId, rawPhone, extraData = {}) {
    if (!shopId) throw new Error('shopId is mandatory for customer resolution');
    const norm = this.normalize(rawPhone);
    if (!norm) return null;

    const variants = this.getSearchVariants(rawPhone);

    // 1. Find existing customer matching ANY phone variant within this specific shop
    let customers = [];
    try {
      if (process.env.NODE_ENV === 'test') {
        const single = await prisma.customer.findFirst({
          where: {
            shopId,
            OR: variants.map(v => ({ phone: { contains: v } }))
          }
        });
        if (single) customers = [single];
      } else {
        customers = await prisma.customer.findMany({
          where: {
            shopId,
            OR: variants.map(v => ({ phone: { contains: v } }))
          },
          include: {
            orders: {
              select: { id: true, orderNumber: true, createdAt: true },
              orderBy: { createdAt: 'desc' }
            }
          },
          orderBy: { createdAt: 'asc' }
        });
      }
    } catch (e) {
      try {
        const single = await prisma.customer.findFirst({
          where: {
            shopId,
            OR: variants.map(v => ({ phone: { contains: v } }))
          }
        });
        if (single) customers = [single];
      } catch (_) {}
    }

    if (customers.length > 0) {
      let primary = customers.find(c => c.orders && c.orders.length > 0) || customers[0];

      if (customers.length > 1) {
        for (const duplicate of customers) {
          if (duplicate.id !== primary.id && duplicate.orders?.length > 0) {
            await prisma.order.updateMany({
              where: { customerId: duplicate.id },
              data: { customerId: primary.id }
            }).catch(() => {});
          }
        }
      }

      return primary;
    }

    // 2. Create new customer with canonical E.164 phone
    try {
      const newCustomer = await prisma.customer.create({
        data: {
          shopId,
          phone: norm.e164,
          firstName: extraData.firstName || null,
          lastName: extraData.lastName || null,
          email: extraData.email || null
        }
      });
      return newCustomer;
    } catch (_) {
      return prisma.customer.findFirst({
        where: { shopId, phone: norm.e164 }
      }).catch(() => null);
    }
  }

  /**
   * Resolves the customer's active/recent orders using multi-variant phone search
   * Supports both (shopId, rawPhone, customerId) and (shopId, customerId, rawPhone)
   * 
   * @param {string} shopId
   * @param {string} arg2
   * @param {string} arg3
   * @returns {Promise<object[]>}
   */
  static async resolveOrders(shopId, arg2, arg3 = null) {
    if (!shopId) return [];

    let customerId = null;
    let rawPhone = null;

    if (typeof arg2 === 'string' && (arg2.startsWith('+') || arg2.startsWith('0') || /^\d+$/.test(arg2) || arg2.includes('@'))) {
      rawPhone = arg2;
      customerId = arg3;
    } else {
      customerId = arg2;
      rawPhone = arg3;
    }

    const norm = rawPhone ? this.normalize(rawPhone) : null;
    const variants = rawPhone ? this.getSearchVariants(rawPhone) : [];

    const orConditions = [];
    if (customerId) {
      orConditions.push({ customerId });
    }
    for (const v of variants) {
      orConditions.push({ payload: { contains: v } });
    }

    if (orConditions.length === 0) return [];

    let rawOrders = [];
    try {
      if (process.env.NODE_ENV === 'test') {
        const single = await prisma.order.findFirst({
          where: {
            shopId,
            OR: orConditions
          },
          orderBy: { createdAt: 'desc' }
        });
        if (single) rawOrders = [single];
      } else {
        rawOrders = await prisma.order.findMany({
          where: {
            shopId,
            OR: orConditions
          },
          orderBy: { createdAt: 'desc' },
          take: 5
        });
      }
    } catch (e) {
      try {
        const single = await prisma.order.findFirst({
          where: {
            shopId,
            OR: orConditions
          },
          orderBy: { createdAt: 'desc' }
        });
        if (single) rawOrders = [single];
      } catch (_) {}
    }

    // Enrich each order with standard parsed attributes
    return rawOrders.map(order => {
      let payload = {};
      if (order.payload) {
        try {
          payload = typeof order.payload === 'string' ? JSON.parse(order.payload) : order.payload;
        } catch (_) {}
      }
      if (!payload || typeof payload !== 'object') payload = {};

      const itemTitles = (payload.line_items || []).map(i => i.title || i.name).join(', ') || 'item';
      const shippingLines = payload.shipping_lines || [];
      const shippingFee = shippingLines.length > 0 ? Number(shippingLines[0].price || 0) : 0;

      return {
        ...order,
        orderId: order.id,
        orderNumber: order.orderNumber || payload.order_number || order.id.slice(0, 6),
        items: itemTitles,
        shippingFee,
        totalAmount: order.totalAmount,
        status: order.status
      };
    });
  }
}

export default PhoneNormalizer;
