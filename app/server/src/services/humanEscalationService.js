import { prisma } from '../lib/db.js';
import { WhatsAppClient } from '../integrations/whatsapp/client.js';

/**
 * Human Escalation & Notification Service for Dial Mate 2.0
 * 
 * Safely escalates calls to human support:
 * 1. Records human assistance request.
 * 2. Sends an immediate WhatsApp notification to the store operator/support contact.
 * 3. Clearly informs the AI that live PSTN transfer is not active, but support is notified.
 * 4. Never leaks private merchant credentials.
 */
export class HumanEscalationService {
  /**
   * Formats the concise WhatsApp escalation message for store operators
   */
  static formatNotification({
    customerPhone = 'On file',
    orderNumber = 'N/A',
    customerRequest = 'Customer requested human assistance',
    orderStatus = 'Pending Confirmation',
    callId = 'N/A',
    reason = 'human_requested'
  }) {
    return (
      `🔔 *DIAL MATE HUMAN ASSIST REQUEST*\n\n` +
      `👤 *Customer:* ${customerPhone}\n` +
      `📦 *Order:* #${orderNumber}\n` +
      `📝 *Request:* ${customerRequest}\n` +
      `📊 *Order Status:* ${orderStatus}\n` +
      `📞 *Call ID:* ${callId}\n` +
      `❓ *Reason:* ${reason}\n\n` +
      `Please contact the customer to assist.`
    );
  }

  /**
   * Escalates an active call to human support
   * 
   * @param {Object} params
   * @param {string} params.shopDomain - Tenant shop domain
   * @param {string} params.orderId - Internal order UUID
   * @param {string} [params.reason='human_requested'] - Escalation reason
   * @param {Object} [params.context={}] - Active call context (callId, eventId, etc.)
   * @returns {Promise<{ success: boolean, status: string, liveTransfer: boolean, notificationSent: boolean, message: string }>}
   */
  static async escalate({ shopDomain, orderId, reason = 'human_requested', context = {} }) {
    console.log(`🚨 [HumanEscalation] Escalation triggered for order ${orderId} on ${shopDomain} (Reason: ${reason})`);

    try {
      const order = await prisma.order.findUnique({
        where: { id: String(orderId) },
        include: { shop: true, customer: true }
      });

      if (!order) {
        console.warn(`⚠️ [HumanEscalation] Order ${orderId} not found`);
        return {
          success: false,
          status: 'order_not_found',
          liveTransfer: false,
          notificationSent: false,
          message: 'Order record could not be found'
        };
      }

      const shop = order.shop;

      // Parse payload for details
      let payload = {};
      if (order.payload) {
        try {
          payload = typeof order.payload === 'string' ? JSON.parse(order.payload) : order.payload;
        } catch (_) {}
      }

      const customerPhone =
        order.customer?.phone ||
        payload?.phone ||
        payload?.shipping_address?.phone ||
        payload?.customer?.phone ||
        'On file';

      const orderNumber = order.orderNumber || payload?.name || order.id.slice(0, 6);
      const orderStatus = order.status || 'Pending Confirmation';
      const callId = context.callId || context.eventId || 'Active Call';

      // Parse shop settings for configured support phone
      let settings = {};
      if (shop.settings) {
        try {
          settings = typeof shop.settings === 'string' ? JSON.parse(shop.settings) : shop.settings;
        } catch (_) {}
      }

      const operatorPhone =
        settings.supportWhatsapp ||
        settings.supportPhone ||
        shop.contact ||
        process.env.STORE_SUPPORT_WHATSAPP_NUMBER ||
        process.env.ADMIN_TEST_NUMBERS?.split(',')[0] ||
        null;

      const notificationText = this.formatNotification({
        customerPhone,
        orderNumber,
        customerRequest: reason === 'dispute' ? 'Customer disputed order details' : 'Customer requested to speak with a human support agent',
        orderStatus,
        callId,
        reason
      });

      let notificationSent = false;
      let notificationError = null;

      if (operatorPhone) {
        try {
          const integration = await prisma.whatsAppIntegration.findFirst({
            where: { shopId: shop.id, isActive: true }
          });

          if (integration && integration.sessionId) {
            const waClient = new WhatsAppClient({
              baseUrl: process.env.WA_AKG_BASE_URL,
              apiKey: process.env.WA_AKG_API_KEY,
              sessionId: String(integration.sessionId),
              shopId: String(shop.id)
            });

            let cleanOperatorPhone = String(operatorPhone).replace(/[^0-9]/g, '');
            if (cleanOperatorPhone.startsWith('03') && cleanOperatorPhone.length === 11) {
              cleanOperatorPhone = '92' + cleanOperatorPhone.substring(1);
            }
            const operatorJid = `${cleanOperatorPhone}@s.whatsapp.net`;

            console.log(`💬 [HumanEscalation] Sending WhatsApp assist notification to operator ${operatorJid}`);
            await waClient.sendMessage(operatorJid, notificationText);
            notificationSent = true;
          } else {
            console.log(`ℹ️ [HumanEscalation] No active WhatsApp session for shop ${shop.domain}. Notification logged.`);
          }
        } catch (err) {
          notificationError = err.message;
          console.error(`❌ [HumanEscalation] Failed to dispatch WhatsApp notification:`, err.message);
        }
      } else {
        console.log(`ℹ️ [HumanEscalation] No store operator phone configured for ${shop.domain}. Notification recorded in DB.`);
      }

      // Persist escalation log
      try {
        await prisma.complianceLog.create({
          data: {
            shopDomain: shop.domain,
            event: 'Human Escalation Requested',
            detail: `Customer for Order #${orderNumber} (${customerPhone}) requested human assist. Reason: ${reason}. WhatsApp notified: ${notificationSent}`
          }
        });
      } catch (_) {}

      return {
        success: true,
        status: 'human_requested',
        liveTransfer: false, // Explicitly tell the AI no PSTN telephony transfer occurred
        notificationSent,
        reason,
        notificationError: notificationError || undefined,
        message: notificationSent
          ? 'Customer support has been notified via WhatsApp and will contact the customer shortly.'
          : 'Customer support request has been recorded and the team will follow up.'
      };
    } catch (unexpectedError) {
      console.error(`❌ [HumanEscalation] Unexpected error during escalation:`, unexpectedError.message);
      return {
        success: false,
        status: 'escalation_failed',
        liveTransfer: false,
        notificationSent: false,
        reason,
        message: 'Could not complete escalation request at this moment.'
      };
    }
  }
}

export const humanEscalationService = HumanEscalationService;
export default HumanEscalationService;
