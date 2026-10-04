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

  // Load order and shop
  const order = await prisma.order.findUnique({
    where: { id: String(orderId) },
    include: { shop: true }
  });

  if (!order || !order.shop) {
    console.warn(`⚠️ [CallWorker] Order or shop not found for ${orderId}`);
    return { success: false, reason: 'ORDER_OR_SHOP_NOT_FOUND' };
  }

  // Safety 1: Terminal state guard (Never call orders already confirmed, cancelled, or opted out)
  if (
    ['Confirmed', 'Cancelled'].includes(order.status) ||
    ['confirmed', 'cancelled', 'do_not_call'].includes(order.callStatus)
  ) {
    console.log(`🛑 [CallWorker] Order ${orderId} already in terminal state (Status: ${order.status}, CallStatus: ${order.callStatus}). Discarding job [${job.name}].`);
    return { success: true, discarded: true, reason: 'ORDER_ALREADY_TERMINAL' };
  }

  // Safety 2: In-flight duplicate call lock
  if (order.callStatus === 'calling' && !force) {
    console.warn(`⚠️ [CallWorker] Order ${orderId} already has an active call in progress. Aborting duplicate.`);
    return { success: false, reason: 'CALL_ALREADY_IN_PROGRESS' };
  }

  const domain = shopDomain || order.shop.domain;

  // Execute call workflow
  const result = await CallWorkflowService.initiateCall({
    orderId,
    shopDomain: domain,
    force: Boolean(force),
    dryRun: Boolean(job.data.dryRun)
  });

  return { success: result.success, orderId, result };
}

