import { prisma } from '../lib/db.js';
import { CallWorkflowService } from '../services/callWorkflowService.js';

/**
 * Hardened BullMQ Call Worker
 * Handles 'initiate-call', 'retry-call', and 'callback' jobs
 */
export async function processCallJob(job) {
  const { orderId, shopDomain, shopId, force } = job.data;

  if (!orderId) {
    throw new Error('Missing required orderId in call job');
  }

  console.log(`📞 [CallWorker] Processing job [${job.name}] for order ${orderId}`);

  // Resolve shopDomain if not directly provided
  let domain = shopDomain;
  if (!domain) {
    const order = await prisma.order.findUnique({
      where: { id: String(orderId) },
      include: { shop: true }
    });
    if (!order || !order.shop) {
      console.warn(`⚠️ [CallWorker] Order or shop not found for ${orderId}`);
      return { success: false, reason: 'ORDER_OR_SHOP_NOT_FOUND' };
    }
    domain = order.shop.domain;
  }

  // Execute call workflow
  const result = await CallWorkflowService.initiateCall({
    orderId,
    shopDomain: domain,
    force: Boolean(force || job.name === 'retry-call' || job.name === 'callback'),
    dryRun: Boolean(job.data.dryRun)
  });

  return { success: result.success, orderId, result };
}
