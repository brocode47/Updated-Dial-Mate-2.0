import { prisma } from '../lib/db.js';
import { computeRiskScore } from '../lib/risk.js';
import { callQueue } from '../lib/queues.js';

export async function processWebhookJob(job) {
  const { topic, payload, shopId, webhookId } = job.data;
  
  console.log(`📦 [WebhookWorker] Processing ${topic} for shop ${shopId} (Hook ID: ${webhookId})`);

  if (topic === 'orders/create') {
    const orderId = String(payload?.name || payload?.id);
    const shopifyOrderGid = payload?.admin_graphql_api_id;
    const riskScore = computeRiskScore(payload);

    // Upsert the order
    await prisma.order.upsert({
      where: { id: orderId },
      update: {
        payload: JSON.stringify(payload),
        shopifyOrderGid,
        riskScore
      },
      create: {
        id: orderId,
        shopId,
        shopifyOrderGid,
        payload: JSON.stringify(payload),
        status: 'Pending Confirmation',
        tag: 'Retry',
        riskScore
      }
    });

    const customerName =
      payload?.shipping_address?.name ||
      payload?.customer?.first_name ||
      'Customer';

    let phone =
      payload?.phone ||
      payload?.shipping_address?.phone ||
      payload?.customer?.phone;

    if (!phone) {
      console.log(`❌ [WebhookWorker] No phone number found for order ${orderId}`);
      return { success: false, reason: 'No phone' };
    }

    if (!phone.startsWith('+')) {
      phone = '+92' + phone.replace(/^0/, '');
    }

    const productName = payload?.line_items?.[0]?.title || 'your product';
    const productPrice = payload?.total_price || '0';

    console.log(`📞 [WebhookWorker] Queueing outbound call for ${orderId}`);
    
    // Add job to call queue
    await callQueue.add('initiate-call', {
      phone,
      customerName,
      productName,
      productPrice,
      orderId
    }, {
      jobId: `initial-call-${orderId}` // Prevents creating duplicate initial calls
    });

    return { success: true, orderId };
  }

  // Not processed/recognized topic
  return { success: true, ignored: true, topic };
}
