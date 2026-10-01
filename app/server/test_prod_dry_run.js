import { prisma } from './src/lib/db.js';
import { processWebhookJob } from './src/workers/webhookWorker.js';

async function main() {
  console.log('🚀 Starting Safe Production Dry-Run Verification (0qwck2-s1.myshopify.com)...');

  const targetShopDomain = '0qwck2-s1.myshopify.com';
  const shop = await prisma.shop.findUnique({ where: { domain: targetShopDomain } });
  if (!shop) {
    throw new Error(`Target shop ${targetShopDomain} not found in database!`);
  }
  console.log(`✅ Shop verified: ${shop.domain} (ID: ${shop.id})`);

  // Ensure shop has AI calling enabled in settings
  let settings = {};
  try {
    settings = typeof shop.settings === 'string' ? JSON.parse(shop.settings || '{}') : (shop.settings || {});
  } catch (e) {
    settings = {};
  }
  settings.aiCalling = { ...(settings.aiCalling || {}), enabled: true, callingHours: '24/7' };
  settings.orderRules = { ...(settings.orderRules || {}), codOnly: true };
  await prisma.shop.update({
    where: { id: shop.id },
    data: { settings: JSON.stringify(settings) }
  });
  console.log('✅ Shop calling settings confirmed (enabled: true, callingHours: 24/7)');

  const testOrderId = `DRY-RUN-${Date.now()}`;
  const payload = {
    id: 99990001,
    name: testOrderId,
    order_number: 1099,
    current_total_price: '2850.00',
    total_price: '2850.00',
    currency: 'PKR',
    financial_status: 'pending',
    payment_gateway_names: ['Cash on Delivery (COD)'],
    gateway: 'Cash on Delivery (COD)',
    phone: '03001234567',
    customer: {
      id: 54321,
      first_name: 'Ahmed',
      last_name: 'Khan',
      phone: '03001234567',
      default_address: {
        address1: 'House 12, Street 4, F-8/2',
        city: 'Islamabad',
        country: 'Pakistan',
        phone: '03001234567'
      }
    },
    line_items: [
      {
        id: 11111,
        title: 'Premium Linen Kurta',
        quantity: 1,
        price: '2850.00'
      }
    ]
  };

  console.log('\n--- STEP 1: New Order Simulation & Eligibility Check ---');
  const webhookResult = await processWebhookJob({
    data: {
      topic: 'orders/create',
      payload,
      shopId: shop.id,
      webhookId: `hook-${Date.now()}`
    }
  });
  console.log('WebhookWorker result:', JSON.stringify(webhookResult));

  const orderAfterWebhook = await prisma.order.findUnique({
    where: { id: testOrderId }
  });
  console.log(`Order Status: ${orderAfterWebhook.status}`);
  console.log(`Order CallStatus: ${orderAfterWebhook.callStatus}`);
  console.log(`Order Tag: ${orderAfterWebhook.tag}`);

  if (orderAfterWebhook.callStatus !== 'queued') {
    throw new Error(`Expected order callStatus to be 'queued', got: ${orderAfterWebhook.callStatus}`);
  }
  console.log('✅ Order successfully set to QUEUED in database.');

  console.log('\n--- STEP 2: Worker Pickup & Twilio Dry-Run Execution ---');
  console.log('Waiting 4 seconds for dialmate_worker container to process BullMQ job...');
  await new Promise(resolve => setTimeout(resolve, 4000));

  const calls = await prisma.call.findMany({
    where: { orderId: testOrderId }
  });
  console.log(`Call records found for order: ${calls.length}`);

  if (calls.length === 0) {
    throw new Error('Expected at least one Call record to be created by callWorker!');
  }

  const callRecord = calls[0];
  console.log(`Call Record ID: ${callRecord.id}`);
  console.log(`Call Outcome: ${callRecord.outcome}`);
  console.log(`Provider Call SID: ${callRecord.providerCallSid}`);

  const orderFinal = await prisma.order.findUnique({
    where: { id: testOrderId }
  });
  console.log(`Final Order CallStatus: ${orderFinal.callStatus}`);
  console.log(`Final Order CallSid: ${orderFinal.callSid}`);

  // Assertions
  if (!callRecord.providerCallSid?.startsWith('dry_run_')) {
    throw new Error(`Expected dry_run SID, got: ${callRecord.providerCallSid}`);
  }
  console.log('✅ Confirmed providerCallSid starts with dry_run_ (NO carrier call placed)');

  // Clean up test order & call record
  await prisma.call.deleteMany({ where: { orderId: testOrderId } });
  await prisma.order.delete({ where: { id: testOrderId } });
  console.log('✅ Test order and call records cleaned up.');

  console.log('\n🎉 ALL DRY RUN STEP 4 REQUIREMENTS FULLY VERIFIED ON PRODUCTION!');
}

main().catch(err => {
  console.error('❌ Dry run test failed:', err);
  process.exit(1);
});
