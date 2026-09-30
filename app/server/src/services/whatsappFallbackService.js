import { prisma } from '../lib/db.js';
import { WhatsAppClient } from '../integrations/whatsapp/client.js';

/**
 * WhatsApp Fallback Service for Dial Mate 2.0
 * 
 * Automatically sends WhatsApp confirmation follow-up when telephone calls are unanswered or exhausted.
 * Uses existing WA-AKG multi-tenant architecture.
 */

export class WhatsAppFallbackService {
  /**
   * Generates localized message template
   */
  static getMessageTemplate({ language = 'roman_urdu', customerName, shopName, orderNumber, productName, totalAmount }) {
    const clean = (val, fb = '') => String(val || fb).trim();
    const cName = clean(customerName, 'Customer');
    const sName = clean(shopName, 'DialMate Store');
    const oNum = clean(orderNumber, '');
    const pName = clean(productName, 'your product');
    const price = clean(totalAmount, '0');

    if (language === 'urdu') {
      return (
        `السلام علیکم ${cName}!\n` +
        `${sName} سے آپ کے کیش آن ڈیلیوری آرڈر #${oNum} کی تصدیق درکار ہے۔\n\n` +
        `📦 آئٹم: ${pName}\n` +
        `💰 کل رقم: ${price} روپے\n\n` +
        `آرڈر کنفرم کروانے کے لیے *Confirm* یا *جی بھیج دیں* لکھ کر جواب دیں۔\n` +
        `منسوخ کرنے کے لیے *Cancel* لکھیں۔\n` +
        `شکریہ!`
      );
    }

    if (language === 'english') {
      return (
        `Hello ${cName}!\n` +
        `Please confirm your Cash on Delivery order #${oNum} from ${sName}.\n\n` +
        `📦 Item: ${pName}\n` +
        `💰 Total: Rs ${price}\n\n` +
        `Reply *Confirm* to approve dispatch.\n` +
        `Reply *Cancel* if you wish to cancel.\n` +
        `Thank you!`
      );
    }

    // Default: Roman Urdu
    return (
      `Assalam o Alaikum ${cName}!\n` +
      `${sName} se aap ke Cash on Delivery order #${oNum} ki confirmation darkaar hai.\n\n` +
      `📦 Item: ${pName}\n` +
      `💰 Total: Rs ${price}\n\n` +
      `Order confirm karne ke liye *Confirm* ya *Bhej do* reply karein.\n` +
      `Cancel karne ke liye *Cancel* reply karein.\n` +
      `Shukriya!`
    );
  }

  /**
   * Sends automated WhatsApp fallback for an order
   * 
   * @param {Object} params
   * @param {string} params.orderId - Database Order UUID or order number
   * @param {string} params.shopId - Tenant Shop UUID
   * @returns {Promise<{ success: boolean, reason?: string, messageId?: string }>}
   */
  static async sendFallback({ orderId, shopId }) {
    try {
      const order = await prisma.order.findUnique({
        where: { id: String(orderId) },
        include: { shop: true, customer: true }
      });

      if (!order) {
        return { success: false, reason: 'ORDER_NOT_FOUND' };
      }

      const shop = order.shop;
      if (!shop || !shop.isActive) {
        return { success: false, reason: 'SHOP_INACTIVE' };
      }

      // Check shop settings for WhatsApp fallback preference
      let settings = {};
      if (shop.settings) {
        try {
          settings = typeof shop.settings === 'string' ? JSON.parse(shop.settings) : shop.settings;
        } catch (_) {}
      }

      const whatsappConfig = settings.whatsapp || {};
      if (whatsappConfig.enableFallback === false) {
        return { success: false, reason: 'WHATSAPP_FALLBACK_DISABLED_BY_MERCHANT' };
      }

      // Parse payload for customer details
      let payload = {};
      if (order.payload) {
        try {
          payload = typeof order.payload === 'string' ? JSON.parse(order.payload) : order.payload;
        } catch (_) {}
      }

      let phone =
        order.customer?.phone ||
        payload?.phone ||
        payload?.shipping_address?.phone ||
        payload?.billing_address?.phone ||
        payload?.customer?.phone;

      if (!phone) {
        return { success: false, reason: 'NO_PHONE_NUMBER' };
      }

      // Format Pakistani phone
      phone = String(phone).replace(/[^\d+]/g, '');
      if (phone.startsWith('03') && phone.length === 11) {
        phone = '+92' + phone.substring(1);
      } else if (!phone.startsWith('+')) {
        phone = '+92' + phone.replace(/^0/, '');
      }

      // Look up active WhatsApp integration for this shop
      const integration = await prisma.whatsAppIntegration.findFirst({
        where: {
          shopId: shop.id,
          isActive: true
        }
      });

      if (!integration || !integration.sessionId) {
        console.warn(`⚠️ [WhatsAppFallback] No active WhatsApp session for shop ${shop.domain}`);
        return { success: false, reason: 'NO_ACTIVE_WHATSAPP_SESSION' };
      }

      const language = whatsappConfig.templateLanguage || settings.aiSettings?.language || 'roman_urdu';
      const customerName =
        payload?.shipping_address?.name ||
        payload?.customer?.first_name ||
        order.customer?.firstName ||
        'Customer';

      const lineItems = payload?.line_items || [];
      const productName = lineItems[0]?.title || 'your product';
      const totalAmount = order.totalAmount || payload?.total_price || '0';

      const messageText = this.getMessageTemplate({
        language,
        customerName,
        shopName: shop.name || shop.domain,
        orderNumber: order.orderNumber || payload?.name || order.id,
        productName,
        totalAmount
      });

      // Send via WA-AKG Client
      const waClient = new WhatsAppClient({
        baseUrl: process.env.WA_AKG_BASE_URL,
        apiKey: process.env.WA_AKG_API_KEY,
        sessionId: String(integration.sessionId),
        shopId: String(shop.id)
      });

      const cleanPhone = phone.replace(/[^0-9]/g, '');
      const jid = `${cleanPhone}@s.whatsapp.net`;

      console.log(`💬 [WhatsAppFallback] Sending fallback message to ${jid} via session ${integration.sessionId}`);
      const sendResult = await waClient.sendMessage(jid, messageText);

      // Record message in Conversation history for Dashboard Inbox
      let customer = order.customer;
      if (!customer) {
        customer = await prisma.customer.findFirst({
          where: { shopId: shop.id, phone: cleanPhone }
        });
      }

      if (customer) {
        let conversation = await prisma.conversation.findFirst({
          where: { shopId: shop.id, customerId: customer.id }
        });

        if (!conversation) {
          conversation = await prisma.conversation.create({
            data: {
              shopId: shop.id,
              customerId: customer.id,
              channel: 'WHATSAPP',
              status: 'ACTIVE'
            }
          });
        }

        await prisma.message.create({
          data: {
            conversationId: conversation.id,
            sender: 'agent',
            text: messageText
          }
        });

        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { updatedAt: new Date() }
        });
      }

      // Update Order tag
      await prisma.order.update({
        where: { id: order.id },
        data: {
          tag: 'WhatsApp Fallback Sent',
          updatedAt: new Date()
        }
      });

      await prisma.complianceLog.create({
        data: {
          shopDomain: shop.domain,
          event: 'WhatsApp Fallback Sent',
          detail: `Sent confirmation request for Order ${order.id} to ${phone}`
        }
      });

      return {
        success: true,
        messageId: sendResult?.id || null,
        phone,
        sessionId: integration.sessionId
      };

    } catch (err) {
      console.error('❌ [WhatsAppFallback] Failed to send fallback message:', err.message);
      return { success: false, reason: err.message };
    }
  }

  static formatMessage({ template, customerName, orderNumber, orderTotal, shopName }) {
    if (!template) return '';
    return template
      .replace(/{customerName}/g, customerName || 'Customer')
      .replace(/{orderNumber}/g, orderNumber || '')
      .replace(/{orderTotal}/g, orderTotal || '')
      .replace(/{shopName}/g, shopName || 'Store');
  }
}

export const whatsappFallbackService = WhatsAppFallbackService;
export default WhatsAppFallbackService;
