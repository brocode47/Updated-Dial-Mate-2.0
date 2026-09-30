import { prisma } from '../lib/db.js';

/**
 * Deterministic Order Eligibility Engine for Dial Mate 2.0
 * 
 * Evaluates whether an order should be automatically queued for an AI confirmation call.
 * Pure deterministic logic - never delegates business rules to an LLM.
 * 
 * Rules Evaluated:
 * 1. Merchant AI Calling Feature Enablement
 * 2. Cash on Delivery (COD) Payment Method
 * 3. Valid Customer Phone Number
 * 4. Order Cancellation / Fulfilled Status
 * 5. Prior Confirmation / In-Progress Status
 * 6. Maximum Call Attempts Limit
 * 7. Merchant Operating Hours Window
 * 8. Order Value & Excluded Tags Rules
 */

export class OrderEligibilityService {
  /**
   * Helper to normalize Pakistani and international phone numbers
   */
  static cleanPhoneNumber(phone) {
    if (!phone) return null;
    let cleaned = String(phone).trim().replace(/[^\d+]/g, '');
    if (!cleaned) return null;

    // Pakistani numbers: e.g. 03001234567 -> +923001234567
    if (cleaned.startsWith('03') && cleaned.length === 11) {
      cleaned = '+92' + cleaned.substring(1);
    } else if (cleaned.startsWith('92') && !cleaned.startsWith('+')) {
      cleaned = '+' + cleaned;
    } else if (!cleaned.startsWith('+') && cleaned.length >= 10) {
      cleaned = '+92' + cleaned.replace(/^0/, '');
    }

    // Must have at least 10 digits
    const digitsOnly = cleaned.replace(/\D/g, '');
    if (digitsOnly.length < 10 || digitsOnly.length > 15) {
      return null;
    }

    return cleaned;
  }

  /**
   * Checks if an order's payment method is Cash on Delivery (COD)
   */
  static isCashOnDelivery(payload) {
    if (!payload) return true; // Default fallback if payload is unavailable

    // Check payment gateway names
    const gateways = Array.isArray(payload.payment_gateway_names)
      ? payload.payment_gateway_names.map(g => String(g).toLowerCase())
      : [];

    const codTerms = ['cash on delivery', 'cod', 'cash_on_delivery', 'manual', 'cash on delivery (cod)', 'cash'];
    const hasCodGateway = gateways.some(g => codTerms.some(term => g.includes(term)));

    // Check single gateway field if present
    if (payload.gateway) {
      const g = String(payload.gateway).toLowerCase();
      if (codTerms.some(term => g.includes(term))) {
        return true;
      }
    }

    if (hasCodGateway) {
      return true;
    }

    // Check financial status: if pending or unpaid, it's typically COD in Pak e-commerce
    if (payload.financial_status === 'pending' || payload.financial_status === 'authorized') {
      return true;
    }

    // If financial_status is explicitly 'paid' and no COD gateway mentioned, it's online prepaid
    if (payload.financial_status === 'paid' && gateways.length > 0 && !hasCodGateway) {
      return false;
    }

    // Default to true for COD-first Pakistani commerce
    return true;
  }

  /**
   * Evaluates if current time falls within merchant's operating window
   */
  static isWithinOperatingHours(operatingHoursStr = '09:00 - 21:00', timezoneOffset = 5) {
    try {
      if (!operatingHoursStr || operatingHoursStr === '24/7') return true;

      // Match patterns like "09:00 - 21:00" or "9:00 AM - 9:00 PM"
      const parts = operatingHoursStr.split('-').map(s => s.trim());
      if (parts.length !== 2) return true;

      const parseTime = (timeStr) => {
        const isPM = /pm/i.test(timeStr);
        const isAM = /am/i.test(timeStr);
        const [h, m = '0'] = timeStr.replace(/(am|pm)/gi, '').trim().split(':').map(Number);
        let hour = h;
        if (isPM && hour < 12) hour += 12;
        if (isAM && hour === 12) hour = 0;
        return hour * 60 + m;
      };

      const startMinutes = parseTime(parts[0]);
      const endMinutes = parseTime(parts[1]);

      // Calculate current time in store timezone (Default PKT: UTC+5)
      const now = new Date();
      const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
      let storeMinutes = (utcMinutes + timezoneOffset * 60) % 1440;
      if (storeMinutes < 0) storeMinutes += 1440;

      if (startMinutes <= endMinutes) {
        return storeMinutes >= startMinutes && storeMinutes <= endMinutes;
      } else {
        // Over midnight window
        return storeMinutes >= startMinutes || storeMinutes <= endMinutes;
      }
    } catch (e) {
      console.warn('⚠️ [Eligibility] Error checking operating hours, defaulting to open:', e.message);
      return true;
    }
  }

  /**
   * Main deterministic eligibility check
   * 
   * @param {Object} params
   * @param {string} [params.orderId] - Database Order UUID or Shopify order ID
   * @param {string} [params.shopId] - Database Shop UUID
   * @param {Object} [params.order] - Order database row or webhook payload
   * @param {Object} [params.shop] - Shop database row
   * @returns {Promise<{ eligible: boolean, reason: string, orderId: string, shopId: string, ruleBreakdown: Object, phone: string|null }>}
   */
  static async evaluate(order, shop, options = {}) {
    if (order && typeof order === 'object' && !shop && (order.orderId || order.order)) {
      return this.checkOrderEligibility(order);
    }
    return this.checkOrderEligibility({ order, shop, ...options });
  }

  static async checkOrderEligibility({ orderId, shopId, order, shop }) {
    let orderRecord = order;
    let shopRecord = shop;

    // Load from DB if needed
    if (!orderRecord && orderId) {
      orderRecord = await prisma.order.findUnique({
        where: { id: String(orderId) },
        include: { shop: true, customer: true }
      });
      if (orderRecord && !shopRecord) {
        shopRecord = orderRecord.shop;
      }
    }

    if (!shopRecord && shopId) {
      shopRecord = await prisma.shop.findUnique({
        where: { id: String(shopId) }
      });
    }

    if (!orderRecord) {
      return {
        eligible: false,
        reason: 'ORDER_NOT_FOUND',
        orderId: orderId || 'unknown',
        shopId: shopRecord?.id || shopId || 'unknown',
        ruleBreakdown: { orderFound: false },
        phone: null
      };
    }

    if (!shopRecord || shopRecord.isActive === false) {
      return {
        eligible: false,
        reason: 'SHOP_INACTIVE_OR_NOT_FOUND',
        orderId: orderRecord.id || orderId,
        shopId: shopRecord?.id || shopId || 'unknown',
        ruleBreakdown: { shopActive: false },
        phone: null
      };
    }

    // Parse shop settings
    let settings = {};
    if (shopRecord.settings) {
      try {
        settings = typeof shopRecord.settings === 'string'
          ? JSON.parse(shopRecord.settings)
          : shopRecord.settings;
      } catch (_) {
        settings = {};
      }
    }

    // Parse order payload
    let payload = {};
    if (orderRecord.payload) {
      try {
        payload = typeof orderRecord.payload === 'string'
          ? JSON.parse(orderRecord.payload)
          : orderRecord.payload;
      } catch (_) {
        payload = {};
      }
    } else if (orderRecord.id && orderRecord.total_price) {
      // Direct webhook payload
      payload = orderRecord;
    }

    const aiCallingConfig = settings.aiCalling || {};
    const orderRules = settings.orderRules || {};

    // 1. Merchant AI Calling Feature Flag
    const isAiCallingEnabled = aiCallingConfig.enabled !== false;
    if (!isAiCallingEnabled) {
      return {
        eligible: false,
        reason: 'AI_CALLING_DISABLED_BY_MERCHANT',
        orderId: orderRecord.id || orderId,
        shopId: shopRecord.id,
        ruleBreakdown: { aiCallingEnabled: false },
        phone: null
      };
    }

    // 2. Cancellation Check
    const isCancelledInDb = orderRecord.status === 'Cancelled' || orderRecord.callStatus === 'cancelled';
    const isCancelledInPayload = Boolean(payload.cancelled_at);
    if (isCancelledInDb || isCancelledInPayload) {
      return {
        eligible: false,
        reason: 'ORDER_ALREADY_CANCELLED',
        orderId: orderRecord.id || orderId,
        shopId: shopRecord.id,
        ruleBreakdown: { notCancelled: false },
        phone: null
      };
    }

    // 3. Already Confirmed or Fulfilled Check
    const isConfirmedInDb = orderRecord.status === 'Confirmed' || orderRecord.callStatus === 'confirmed';
    const isFulfilledInPayload = payload.fulfillment_status === 'fulfilled';
    if (isConfirmedInDb || isFulfilledInPayload) {
      return {
        eligible: false,
        reason: 'ORDER_ALREADY_CONFIRMED: Order is already confirmed or fulfilled',
        orderId: orderRecord.id || orderId,
        shopId: shopRecord.id,
        ruleBreakdown: { notConfirmed: false },
        phone: null
      };
    }

    // 4. In-Flight Call Lock
    if (orderRecord.callStatus === 'calling' || orderRecord.callStatus === 'in-progress') {
      return {
        eligible: false,
        reason: 'CALL_ALREADY_IN_PROGRESS: Call is already in progress',
        orderId: orderRecord.id || orderId,
        shopId: shopRecord.id,
        ruleBreakdown: { notInProgress: false },
        phone: null
      };
    }

    // 5. Maximum Attempts Exceeded
    const maxAttempts = Number(aiCallingConfig.maxAttempts || 3);
    const retryCount = Number(orderRecord.retryCount || 0);
    if (retryCount >= maxAttempts) {
      return {
        eligible: false,
        reason: 'MAX_CALL_ATTEMPTS_EXCEEDED: Maximum attempts reached',
        orderId: orderRecord.id || orderId,
        shopId: shopRecord.id,
        ruleBreakdown: { withinMaxAttempts: false, retryCount, maxAttempts },
        phone: null
      };
    }

    // 6. Cash on Delivery (COD) Rule
    const codOnly = orderRules.codOnly !== false; // Default: true
    const isCod = this.isCashOnDelivery(payload);
    if (codOnly && !isCod) {
      return {
        eligible: false,
        reason: 'NON_COD_ORDER: Order is non-cod (not Cash on Delivery)',
        orderId: orderRecord.id || orderId,
        shopId: shopRecord.id,
        ruleBreakdown: { isCod: false },
        phone: null
      };
    }

    // 7. Customer Phone Number Validation
    const rawPhone =
      orderRecord.customer?.phone ||
      payload?.phone ||
      payload?.shipping_address?.phone ||
      payload?.billing_address?.phone ||
      payload?.customer?.phone ||
      payload?.customer?.default_address?.phone;

    const cleanedPhone = this.cleanPhoneNumber(rawPhone);
    if (!cleanedPhone) {
      return {
        eligible: false,
        reason: 'INVALID_OR_MISSING_PHONE_NUMBER: Invalid or missing phone number',
        orderId: orderRecord.id || orderId,
        shopId: shopRecord.id,
        ruleBreakdown: { validPhone: false, rawPhone },
        phone: null
      };
    }

    // 8. Order Value Rules
    const totalAmount = Number(
      orderRecord.totalAmount ||
      payload.current_total_price ||
      payload.total_price ||
      0
    );

    const minOrderValue = Number(orderRules.minOrderValue || 0);
    const maxOrderValue = Number(orderRules.maxOrderValue || 500000);
    if (totalAmount < minOrderValue) {
      return {
        eligible: false,
        reason: 'ORDER_VALUE_BELOW_MINIMUM',
        orderId: orderRecord.id || orderId,
        shopId: shopRecord.id,
        ruleBreakdown: { valueWithinRange: false, totalAmount, minOrderValue },
        phone: cleanedPhone
      };
    }
    if (totalAmount > maxOrderValue) {
      return {
        eligible: false,
        reason: 'ORDER_VALUE_EXCEEDS_MAXIMUM',
        orderId: orderRecord.id || orderId,
        shopId: shopRecord.id,
        ruleBreakdown: { valueWithinRange: false, totalAmount, maxOrderValue },
        phone: cleanedPhone
      };
    }

    // 9. Excluded Tags Rule
    const excludedTags = Array.isArray(orderRules.excludedTags)
      ? orderRules.excludedTags.map(t => String(t).trim().toLowerCase())
      : (typeof orderRules.excludedTags === 'string'
        ? orderRules.excludedTags.split(',').map(t => t.trim().toLowerCase())
        : []);

    if (excludedTags.length > 0) {
      const orderTags = (payload.tags || orderRecord.tag || '')
        .split(',')
        .map(t => t.trim().toLowerCase())
        .filter(Boolean);

      const matchedExcludedTag = orderTags.find(t => excludedTags.includes(t));
      if (matchedExcludedTag) {
        return {
          eligible: false,
          reason: `ORDER_HAS_EXCLUDED_TAG: Order contains excluded tag (${matchedExcludedTag})`,
          orderId: orderRecord.id || orderId,
          shopId: shopRecord.id,
          ruleBreakdown: { excludedTagMatched: matchedExcludedTag },
          phone: cleanedPhone
        };
      }
    }

    // 10. Operating Hours Window
    const operatingHours = aiCallingConfig.callingHours || settings.workingHours || '09:00 - 21:00';
    const isWithinHours = this.isWithinOperatingHours(operatingHours);
    if (!isWithinHours) {
      return {
        eligible: false,
        reason: 'OUTSIDE_OPERATING_HOURS',
        orderId: orderRecord.id || orderId,
        shopId: shopRecord.id,
        ruleBreakdown: { withinOperatingHours: false, operatingHours },
        phone: cleanedPhone,
        canScheduleLater: true
      };
    }

    // All rules passed!
    return {
      eligible: true,
      reason: 'ELIGIBLE_FOR_CONFIRMATION_CALL',
      orderId: orderRecord.id || orderId,
      shopId: shopRecord.id,
      phone: cleanedPhone,
      customerName:
        payload?.shipping_address?.name ||
        payload?.customer?.first_name ||
        orderRecord.customer?.firstName ||
        'Customer',
      productName: payload?.line_items?.[0]?.title || 'your product',
      productPrice: String(totalAmount),
      ruleBreakdown: {
        aiCallingEnabled: true,
        isCod: true,
        notCancelled: true,
        notConfirmed: true,
        validPhone: true,
        valueWithinRange: true,
        withinOperatingHours: true,
        withinMaxAttempts: true
      }
    };
  }
}

export const orderEligibilityService = OrderEligibilityService;
export default OrderEligibilityService;
