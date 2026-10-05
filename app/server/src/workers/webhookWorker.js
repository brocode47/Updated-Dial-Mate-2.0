import { prisma } from '../lib/db.js';
import { computeRiskScore } from '../lib/risk.js';
import { callQueue } from '../lib/queues.js';
import { OrderEligibilityService } from '../services/orderEligibilityService.js';

export async function processWebhookJob(job) {
  const { topic, payload, shopId, webhookId } = job.data;
  
  console.log(`📦 [WebhookWorker] Processing ${topic} for shop ${shopId} (Hook ID: ${webhookId})`);

  const shopRecord = await prisma.shop.findUnique({
    where: { id: shopId }
  });

  if (!shopRecord) {
    console.error(`❌ [WebhookWorker] Shop not found for ID: ${shopId}`);
    return { success: false, reason: 'SHOP_NOT_FOUND' };
  }

  // 1. ORDER CREATION
  if (topic === 'orders/create') {
    const orderId = String(payload?.name || payload?.id);
    const shopifyOrderGid = payload?.admin_graphql_api_id || (payload?.id ? `gid://shopify/Order/${payload.id}` : null);
    const orderNumber = String(payload?.order_number || payload?.name || orderId);
    const totalAmount = parseFloat(payload?.current_total_price || payload?.total_price || 0);
    const riskScore = computeRiskScore(payload);

    // Link or create customer
    let customerId = null;
    const rawPhone = payload?.phone || payload?.shipping_address?.phone || payload?.customer?.phone;
    const cleanedPhone = OrderEligibilityService.cleanPhoneNumber(rawPhone);

    if (payload?.customer?.id || cleanedPhone) {
      try {
        const found = await prisma.customer.findFirst({
          where: {
            shopId: shopRecord.id,
            OR: [
              ...(payload?.customer?.id ? [{ shopifyId: String(payload.customer.id) }] : []),
              ...(cleanedPhone ? [{ phone: cleanedPhone }] : [])
            ]
          }
        });

        if (found) {
          customerId = found.id;
        } else {
          const created = await prisma.customer.create({
            data: {
              shopId: shopRecord.id,
              shopifyId: payload?.customer?.id ? String(payload.customer.id) : null,
              firstName: payload?.customer?.first_name || payload?.shipping_address?.first_name || '',
              lastName: payload?.customer?.last_name || payload?.shipping_address?.last_name || '',
              email: payload?.customer?.email || payload?.email || null,
              phone: cleanedPhone
            }
          });
          customerId = created.id;
        }
      } catch (custErr) {
        console.warn(`⚠️ [WebhookWorker] Customer linking warning:`, custErr.message);
      }
    }

    // Upsert the order
    const orderRecord = await prisma.order.upsert({
      where: { id: orderId },
      update: {
        shopId: shopRecord.id,
        customerId,
        shopifyOrderGid,
        orderNumber,
        payload: JSON.stringify(payload),
        totalAmount,
        riskScore
      },
      create: {
        id: orderId,
        shopId: shopRecord.id,
        customerId,
        shopifyOrderGid,
        orderNumber,
        payload: JSON.stringify(payload),
        status: 'Pending Confirmation',
        tag: 'New Order',
        totalAmount,
        riskScore
      }
    });

    // Check deterministic eligibility
    const eligibility = await OrderEligibilityService.checkOrderEligibility({
      order: orderRecord,
      shop: shopRecord
    });

    console.log(`📋 [WebhookWorker] Eligibility for order ${orderId}:`, eligibility.eligible, eligibility.reason);

    if (eligibility.eligible) {
      await prisma.order.update({
        where: { id: orderId },
        data: {
          callStatus: 'queued',
          tag: 'COD Confirmation Queued'
        }
      });

      // Add job to call queue with deterministic deduplication key
      const jobId = `call-init-${shopRecord.id}-${orderId}`;
      await callQueue.add('initiate-call', {
        orderId,
        shopId: shopRecord.id,
        shopDomain: shopRecord.domain,
        phone: eligibility.phone,
        customerName: eligibility.customerName,
        productName: eligibility.productName,
        productPrice: eligibility.productPrice
      }, {
        jobId // Prevents creating duplicate initial calls
      });

      await prisma.complianceLog.create({
        data: {
          shopDomain: shopRecord.domain,
          event: 'Confirmation Call Enqueued',
          detail: `Order ${orderId} queued for call (Job: ${jobId})`
        }
      });

      // Outbound WhatsApp Order Confirmation Message
      try {
        const { WhatsAppOrderMessageService } = await import('../services/whatsappOrderMessageService.js');
        await WhatsAppOrderMessageService.sendOrderConfirmationMessage({
          order: orderRecord,
          shop: shopRecord
        });
      } catch (waMsgErr) {
        console.warn('⚠️ [WebhookWorker] WhatsApp order message notice:', waMsgErr.message);
      }

      return { success: true, orderId, queued: true };
    } else if (eligibility.reason === 'OUTSIDE_OPERATING_HOURS' && eligibility.canScheduleLater) {
      // Order placed outside operating hours: Schedule call for store opening
      const delayMs = eligibility.delayUntilOpenMs || (60 * 60 * 1000);
      await prisma.order.update({
        where: { id: orderId },
        data: {
          callStatus: 'scheduled',
          tag: `Call Scheduled for Store Opening (${Math.round(delayMs / 60000)}m delay)`
        }
      });

      const jobId = `call-init-${shopRecord.id}-${orderId}`;
      await callQueue.add('initiate-call', {
        orderId,
        shopId: shopRecord.id,
        shopDomain: shopRecord.domain,
        phone: eligibility.phone,
        customerName: eligibility.customerName,
        productName: eligibility.productName,
        productPrice: eligibility.productPrice
      }, {
        delay: delayMs,
        jobId
      });

      await prisma.complianceLog.create({
        data: {
          shopDomain: shopRecord.domain,
          event: 'Confirmation Call Scheduled',
          detail: `Order ${orderId} deferred until store opening (${Math.round(delayMs / 60000)}m delay, Job: ${jobId})`
        }
      });

      return { success: true, orderId, queued: true, deferred: true, delayMs };
    } else {
      // Ineligible order
      await prisma.order.update({
        where: { id: orderId },
        data: {
          callStatus: 'ineligible',
          tag: `Ineligible: ${eligibility.reason}`
        }
      });

      await prisma.complianceLog.create({
        data: {
          shopDomain: shopRecord.domain,
          event: 'Order Call Skipped',
          detail: `Order ${orderId} skipped: ${eligibility.reason}`
        }
      });

      return { success: true, orderId, queued: false, reason: eligibility.reason };
    }
  }

  // 2. ORDER UPDATED
  if (topic === 'orders/updated') {
    const orderId = String(payload?.name || payload?.id);

    const existing = await prisma.order.findUnique({
      where: { id: orderId }
    });

    if (existing) {
      let status = existing.status;
      let callStatus = existing.callStatus;

      if (payload.cancelled_at) {
        status = 'Cancelled';
        callStatus = 'cancelled';
      } else if (payload.financial_status === 'paid' && status === 'Pending Confirmation') {
        // If paid online after creation, mark confirmed
        status = 'Confirmed';
        callStatus = 'paid_online';
      }

      await prisma.order.update({
        where: { id: orderId },
        data: {
          payload: JSON.stringify(payload),
          status,
          callStatus,
          totalAmount: parseFloat(payload.current_total_price || payload.total_price || existing.totalAmount || 0)
        }
      });

      console.log(`🔄 [WebhookWorker] Updated order ${orderId} (Status: ${status})`);
    }

    return { success: true, orderId, updated: Boolean(existing) };
  }

  // 3. ORDER CANCELLED
  if (topic === 'orders/cancelled') {
    const orderId = String(payload?.name || payload?.id);

    await prisma.order.updateMany({
      where: { id: orderId, shopId: shopRecord.id },
      data: {
        status: 'Cancelled',
        callStatus: 'cancelled',
        tag: 'Cancelled in Shopify'
      }
    });

    await prisma.complianceLog.create({
      data: {
        shopDomain: shopRecord.domain,
        event: 'Order Cancelled via Shopify Webhook',
        detail: `Order ${orderId} marked cancelled`
      }
    });

    console.log(`🛑 [WebhookWorker] Order ${orderId} marked cancelled via webhook`);
    return { success: true, orderId, cancelled: true };
  }

  // Not recognized topic
  return { success: true, ignored: true, topic };
}
