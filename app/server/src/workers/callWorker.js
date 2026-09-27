import { triggerCall } from '../routes/webhooks.js';

export async function processCallJob(job) {
  const { phone, customerName, productName, productPrice, orderId } = job.data;
  
  if (!phone || !orderId) {
    throw new Error('Missing required phone or orderId in call job');
  }
  
  console.log(`📞 [CallWorker] Processing outbound call for order ${orderId} (Phone: ${phone})`);
  
  // Call the robust triggerCall logic in Twilio route.
  // Because triggerCall is built to be robust, we just await it. 
  // It handles its own internal errors, but if it throws, BullMQ will retry.
  await triggerCall({
    phone,
    customerName,
    productName,
    productPrice,
    orderId
  });
  
  return { success: true, orderId };
}
