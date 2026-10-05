import { prisma } from '../lib/db.js';
import { WhatsAppClient } from '../integrations/whatsapp/client.js';
import { OrderEligibilityService } from './orderEligibilityService.js';

/**
 * WhatsApp Order Message Service
 * 
 * Responsibilities:
 * 1. Price Reconciliation: Reconciles line items, shipping, and discounts against authoritative Shopify total.
 * 2. Idempotency Guard: Key format `wa-order-notification:${shopDomain}:${orderId}:order_confirmation`.
 * 3. Multi-Tenant Session: Resolves tenant's active WA-AKG session.
 * 4. Production Whitelist Guard: In test mode, simulates unless recipient matches ADMIN_TEST_NUMBERS.
 * 5. Formatting: Detailed, professional order summary with item breakdown and clear reply prompts.
 * 6. Persistence: Persists Conversation and Message records.
 */
export class WhatsAppOrderMessageService {
  /**
   * Generates deterministic idempotency key
   */
  static getIdempotencyKey(shopDomain, orderId) {
    return `wa-order-notification:${shopDomain}:${orderId}:order_confirmation`;
  }

  /**
   * Strict price reconciliation:
   * Line items total + shipping fee - discounts must equal authoritative order total.
   * Tolerates <= 1.0 PKR for rounding.
   * 
   * @param {Object} payload - Shopify order payload
   * @param {number} authoritativeTotal - Stored order.totalAmount or payload.current_total_price
   * @returns {{ reconciled: boolean, lineItemsTotal: number, shippingFee: number, discountAmount: number, calculatedTotal: number, authoritativeTotal: number, diff: number, items: Array }}
   */
  static reconcilePrice(payload, authoritativeTotal) {
    const lineItems = payload?.line_items || [];
    let lineItemsTotal = 0;
    const items = [];

    for (const item of lineItems) {
      const qty = Number(item.quantity || 1);
      const price = parseFloat(item.price || 0);
      const itemSubtotal = qty * price;
      lineItemsTotal += itemSubtotal;

      items.push({
        title: item.title || item.name || 'Item',
        variantTitle: item.variant_title || '',
        quantity: qty,
        unitPrice: price,
        subtotal: itemSubtotal
      });
    }

    // Shipping lines
    let shippingFee = 0;
    if (Array.isArray(payload?.shipping_lines)) {
      for (const line of payload.shipping_lines) {
        shippingFee += parseFloat(line.price || 0);
      }
    } else if (payload?.total_shipping_price_set?.shop_money?.amount) {
      shippingFee = parseFloat(payload.total_shipping_price_set.shop_money.amount || 0);
    }

    // Discounts
    let discountAmount = 0;
    if (payload?.total_discounts) {
      discountAmount = parseFloat(payload.total_discounts || 0);
    } else if (Array.isArray(payload?.discount_applications)) {
      for (const disc of payload.discount_applications) {
        discountAmount += parseFloat(disc.value || 0);
      }
    }

    const calculatedTotal = Math.round((lineItemsTotal + shippingFee - discountAmount) * 100) / 100;
    const authTotal = Math.round(Number(authoritativeTotal || payload?.current_total_price || payload?.total_price || 0) * 100) / 100;
    const diff = Math.abs(calculatedTotal - authTotal);

    // Mismatch threshold: > 1.0 PKR
    const reconciled = diff <= 1.0;

    return {
      reconciled,
      lineItemsTotal,
      shippingFee,
      discountAmount,
      calculatedTotal,
      authoritativeTotal: authTotal,
      diff,
      items
    };
  }

  /**
   * Format outbound order confirmation message in Roman Urdu & English
   */
  static formatOrderConfirmationMessage({
    storeName,
    customerName,
    orderNumber,
    items,
    shippingFee,
    discountAmount,
    totalPayable,
    deliverySLA = '2-4 working days'
  }) {
    const itemLines = items.map((item, index) => {
      const variantStr = item.variantTitle ? ` (${item.variantTitle})` : '';
      return `${index + 1}. *${item.title}*${variantStr} x ${item.quantity} - Rs. ${item.subtotal.toLocaleString()}`;
    }).join('\n');

    let breakdown = `Subtotal: Rs. ${items.reduce((acc, i) => acc + i.subtotal, 0).toLocaleString()}`;
    if (shippingFee > 0) {
      breakdown += `\nDelivery Charges: Rs. ${shippingFee.toLocaleString()}`;
    } else {
      breakdown += `\nDelivery Charges: *FREE*`;
    }
    if (discountAmount > 0) {
      breakdown += `\nDiscount: -Rs. ${discountAmount.toLocaleString()}`;
    }

    return (
`Assalam-o-Alaikum ${customerName}! 👋

*${storeName}* se aapka Cash on Delivery order *#${orderNumber}* receive ho gaya hai.

📦 *Order Details:*
${itemLines}

💰 *Payment Breakdown:*
${breakdown}
*Total Payable (COD): Rs. ${Number(totalPayable).toLocaleString()}*

🚚 *Estimated Delivery:* ${deliverySLA}

Aapka order dispatch kar diya jaye?
• Reply *1* ya *"Confirm"* to confirm
• Reply *2* ya *"Cancel"* to cancel
• Ya agar koi sawal ho to yahan pooch saktay hain.`
    ).trim();
  }

  /**
   * Sends the outbound order confirmation WhatsApp message
   * 
   * @param {Object} params
   * @param {Object} params.order - Database Order record
   * @param {Object} params.shop - Database Shop record
   * @param {boolean} [params.force=false] - Bypass whitelist check if explicitly requested
   * @returns {Promise<{ success: boolean, reason?: string, messageId?: string, simulated?: boolean }>}
   */
  static async sendOrderConfirmationMessage({ order, shop, force = false }) {
    if (!order || !shop) {
      return { success: false, reason: 'MISSING_ORDER_OR_SHOP' };
    }

    const idempotencyKey = this.getIdempotencyKey(shop.domain, order.id);

    // 1. Idempotency Check: prevent duplicate messages for the same order
    const existingLog = await prisma.complianceLog.findFirst({
      where: {
        shopDomain: shop.domain,
        event: 'WhatsApp Order Notification Sent',
        detail: { contains: idempotencyKey }
      }
    });

    if (existingLog) {
      console.log(`ℹ️ [WhatsAppOrder] Notification already sent for order ${order.id} (Key: ${idempotencyKey}). Skipping.`);
      return { success: true, duplicate: true, idempotencyKey };
    }

    // 2. Parse payload
    let payload = {};
    if (order.payload) {
      try {
        payload = typeof order.payload === 'string' ? JSON.parse(order.payload) : order.payload;
      } catch (_) {}
    }

    // 3. Resolve phone
    let rawPhone =
      order.customer?.phone ||
      payload?.phone ||
      payload?.shipping_address?.phone ||
      payload?.customer?.phone;

    const phone = OrderEligibilityService.cleanPhoneNumber(rawPhone);
    if (!phone) {
      console.warn(`⚠️ [WhatsAppOrder] Order ${order.id} has no valid phone number. Aborting.`);
      return { success: false, reason: 'NO_PHONE_NUMBER' };
    }

    // 4. Strict Price Reconciliation
    const reconciliation = this.reconcilePrice(payload, order.totalAmount);
    if (!reconciliation.reconciled) {
      console.warn(`🚨 [WhatsAppOrder] Price discrepancy detected for Order ${order.id}: Calculated Rs. ${reconciliation.calculatedTotal} vs Authoritative Rs. ${reconciliation.authoritativeTotal}`);
      
      await prisma.complianceLog.create({
        data: {
          shopDomain: shop.domain,
          event: 'WhatsApp Order Blocked: Price Discrepancy',
          detail: `Order ${order.id} blocked: Calculated total (${reconciliation.calculatedTotal}) != Authoritative total (${reconciliation.authoritativeTotal}). Diff: ${reconciliation.diff}`
        }
      }).catch(() => {});

      await prisma.order.update({
        where: { id: order.id },
        data: { tag: 'REVIEW_NEEDED: Price Discrepancy' }
      }).catch(() => {});

      return {
        success: false,
        reason: 'PRICE_DISCREPANCY',
        reconciliation
      };
    }

    // 5. Multi-Tenant Session Resolution
    const integration = await prisma.whatsAppIntegration.findFirst({
      where: {
        shopId: shop.id,
        provider: 'WA_AKG',
        isActive: true
      }
    });

    if (!integration || !integration.sessionId) {
      console.warn(`⚠️ [WhatsAppOrder] Shop ${shop.domain} does not have an active WhatsApp integration session.`);
      return { success: false, reason: 'NO_ACTIVE_WHATSAPP_INTEGRATION' };
    }

    const sessionId = integration.sessionId;
    const storeName = shop.name || shop.domain.replace('.myshopify.com', '');
    const customerName =
      payload?.shipping_address?.name ||
      payload?.customer?.first_name ||
      order.customer?.firstName ||
      'Customer';
    const orderNumber = order.orderNumber || payload?.order_number || order.id.slice(0, 6);

    const messageText = this.formatOrderConfirmationMessage({
      storeName,
      customerName,
      orderNumber,
      items: reconciliation.items,
      shippingFee: reconciliation.shippingFee,
      discountAmount: reconciliation.discountAmount,
      totalPayable: reconciliation.authoritativeTotal,
      deliverySLA: '2-4 working days'
    });

    // 6. Test Mode & Whitelist Protection (ZERO unsolicited messages to customers)
    const mode = (process.env.AI_WHATSAPP_MODE || process.env.AI_CALL_MODE || (process.env.DRY_RUN_CALLS === 'false' ? 'production' : 'test')).toLowerCase();
    const adminTestNumbers = (process.env.ADMIN_TEST_NUMBERS || '')
      .split(',')
      .map(n => OrderEligibilityService.cleanPhoneNumber(n))
      .filter(Boolean);

    let isWhitelisted = false;
    if (mode === 'test') {
      isWhitelisted = adminTestNumbers.includes(phone);
    } else if (mode === 'production') {
      isWhitelisted = true;
    }

    const shouldSendLive = !process.env.DRY_RUN_WHATSAPP && (isWhitelisted || force);

    if (!shouldSendLive) {
      const simReason = mode === 'test' && !isWhitelisted
        ? 'Safely simulated: phone not in ADMIN_TEST_NUMBERS'
        : 'Dry-run active';

      console.log(`ℹ️ [WhatsAppOrder: SIMULATION] ${simReason} for order ${order.id} to ${phone}`);

      await prisma.complianceLog.create({
        data: {
          shopDomain: shop.domain,
          event: 'WhatsApp Order Notification Sent',
          detail: `Simulated: ${idempotencyKey} | Reason: ${simReason}`
        }
      });

      return {
        success: true,
        simulated: true,
        reason: simReason,
        idempotencyKey,
        phone,
        messageText
      };
    }

    // 7. Live Dispatch via WhatsAppClient
    const waClient = new WhatsAppClient({
      baseUrl: process.env.WA_AKG_BASE_URL,
      apiKey: process.env.WA_AKG_API_KEY,
      sessionId: String(sessionId),
      shopId: String(shop.id)
    });

    try {
      console.log(`📤 [WhatsAppOrder: LIVE] Sending order confirmation to ${phone} (Session: ${sessionId})...`);
      const sendResult = await waClient.sendMessage(phone, messageText);

      // Persist Conversation and Message records
      try {
        let customer = await prisma.customer.findFirst({
          where: { shopId: shop.id, phone }
        });
        if (!customer) {
          customer = await prisma.customer.create({
            data: { shopId: shop.id, phone, firstName: customerName }
          });
        }

        let conversation = await prisma.conversation.findFirst({
          where: { shopId: shop.id, customerId: customer.id, channel: 'WHATSAPP' }
        });
        if (!conversation) {
          conversation = await prisma.conversation.create({
            data: { shopId: shop.id, customerId: customer.id, channel: 'WHATSAPP', status: 'ACTIVE' }
          });
        }

        await prisma.message.create({
          data: {
            conversationId: conversation.id,
            sender: 'assistant',
            text: messageText
          }
        });
      } catch (dbErr) {
        console.warn('⚠️ [WhatsAppOrder] Conversation record persist notice:', dbErr.message);
      }

      await prisma.complianceLog.create({
        data: {
          shopDomain: shop.domain,
          event: 'WhatsApp Order Notification Sent',
          detail: `${idempotencyKey} | Sent live to ${phone} | Session: ${sessionId}`
        }
      });

      console.log(`✅ [WhatsAppOrder] Live confirmation message sent to ${phone}`);
      return {
        success: true,
        live: true,
        idempotencyKey,
        sendResult
      };
    } catch (err) {
      console.error(`❌ [WhatsAppOrder] Live send failed to ${phone}:`, err.message);
      return {
        success: false,
        reason: err.message
      };
    }
  }
}

export default WhatsAppOrderMessageService;
