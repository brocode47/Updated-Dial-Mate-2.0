import { prisma } from '../src/lib/db.js';
import { CallScriptEngine } from '../src/services/callScriptEngine.js';
import { AICallInterpretationService } from '../src/services/aiCallInterpretationService.js';
import { CallWorkflowService } from '../src/services/callWorkflowService.js';

async function main() {
  console.log('====================================================');
  console.log('  DIAL MATE 2.0 — PHASE 6 VERIFICATION TEST SUITE   ');
  console.log('====================================================\n');

  // 1. Verify Environment Variables
  console.log('--- STEP 1: Environment & Mode Verification ---');
  console.log('AI_CALL_MODE:', process.env.AI_CALL_MODE || 'not set');
  console.log('DRY_RUN_CALLS:', process.env.DRY_RUN_CALLS || 'not set');
  console.log('ADMIN_TEST_NUMBERS:', process.env.ADMIN_TEST_NUMBERS || 'not set');
  console.log('DAILY_CALL_LIMIT:', process.env.DAILY_CALL_LIMIT || '100 (default)');
  console.log('EMERGENCY_STOP:', process.env.EMERGENCY_STOP || 'false');
  console.log('TWILIO_FROM_NUMBER:', process.env.TWILIO_FROM_NUMBER || 'not set');
  console.log('TWILIO_ACCOUNT_SID configured:', Boolean(process.env.TWILIO_ACCOUNT_SID?.startsWith('AC')));

  // 2. Verify Call Script Engine
  console.log('\n--- STEP 2: Call Script Engine Verification ---');
  const sampleOpening = CallScriptEngine.generateOpening({
    agentName: 'Zara',
    shopName: 'Sunday Bazaar',
    customerName: 'Muhammad Usman',
    orderNumber: '1099',
    productName: 'Leather Wallet (Black)',
    productPrice: '2500'
  });
  console.log('✅ Generated Opening Line:');
  console.log(`"${sampleOpening}"`);

  const sampleInstruction = CallScriptEngine.compileGeminiSystemInstruction({
    agentName: 'Zara',
    shopName: 'Sunday Bazaar',
    customerName: 'Muhammad Usman',
    orderNumber: '1099',
    productName: 'Leather Wallet (Black)',
    productPrice: '2500'
  });
  console.log('✅ Compiled Gemini Live 2.0 System Instruction length:', sampleInstruction.length, 'chars');
  console.log('Contains Step 1 (Greeting):', sampleInstruction.includes('Step 1: GREETING'));
  console.log('Contains Step 5 (Closing):', sampleInstruction.includes('Step 5: CLOSING'));

  // 3. Verify AI Conversation Intelligence
  console.log('\n--- STEP 3: AI Interpretation & Intent Detection ---');
  const confirmedInterpretation = await AICallInterpretationService.interpretConversation({
    transcript: 'Customer: Jee bilkul, main Usman baat kar raha hoon. Mera order confirm kar dein please.',
    callDurationSec: 32
  });
  console.log('1. Confirmed Test:', confirmedInterpretation.intent, `(Confidence: ${confirmedInterpretation.confidence}, Emotion: ${confirmedInterpretation.customerEmotion})`);

  const cancelledInterpretation = await AICallInterpretationService.interpretConversation({
    transcript: 'Customer: Nahi bhai, mujhe nahi chahiye. Order cancel kardo meharbani karke.',
    callDurationSec: 18
  });
  console.log('2. Cancelled Test:', cancelledInterpretation.intent, `(Confidence: ${cancelledInterpretation.confidence}, Emotion: ${cancelledInterpretation.customerEmotion})`);

  const callbackInterpretation = await AICallInterpretationService.interpretConversation({
    transcript: 'Customer: Bhai main abhi driving kar raha hoon, bohat masroof hoon. Baad me call karna.',
    callDurationSec: 12
  });
  console.log('3. Callback Test:', callbackInterpretation.intent, `(Minutes: ${callbackInterpretation.callbackRequestedMinutes}, Emotion: ${callbackInterpretation.customerEmotion})`);

  const wrongNumberInterpretation = await AICallInterpretationService.interpretConversation({
    transcript: 'Customer: Aap ka wrong number hai, maine koi cheez order nahi ki. Ghalat number dial kiya hai.',
    callDurationSec: 14
  });
  console.log('4. Wrong Number Test:', wrongNumberInterpretation.intent, `(Confidence: ${wrongNumberInterpretation.confidence})`);

  // 4. Test against Real Database Shop
  console.log('\n--- STEP 4: Live Store Pipeline & Whitelist Test ---');
  const shop = await prisma.shop.findFirst({ where: { domain: '0qwck2-s1.myshopify.com' } }) 
    || await prisma.shop.findFirst({ where: { isActive: true } });
  if (!shop) {
    throw new Error('No active shop found in database');
  }
  console.log(`Active Store: ${shop.domain} (ID: ${shop.id})`);

  // Create a controlled test order
  const testOrderNonWhitelisted = await prisma.order.create({
    data: {
      shopId: shop.id,
      shopifyOrderGid: `gid://shopify/Order/phase6-test-${Date.now()}`,
      orderNumber: `P6-${Math.floor(1000 + Math.random() * 9000)}`,
      totalAmount: 1850,
      currency: 'PKR',
      status: 'Pending Confirmation',
      callStatus: 'pending',
      lineItemsSummary: 'Wireless Earbuds',
      customer: {
        create: {
          shopId: shop.id,
          phone: '+923000000001',
          firstName: 'Asad',
          lastName: 'Farooq'
        }
      },
      payload: JSON.stringify({
        id: `9990001`,
        order_number: 9991,
        phone: '+923000000001',
        total_price: '1850',
        line_items: [{ title: 'Wireless Earbuds', quantity: 1, price: '1850' }],
        shipping_address: { name: 'Asad Farooq', phone: '+923000000001' }
      })
    }
  });
  console.log(`Created test order ${testOrderNonWhitelisted.orderNumber} (Non-whitelisted)`);

  // Test Non-Whitelisted Safe Simulation
  const nonWhitelistedCall = await CallWorkflowService.initiateCall({
    orderId: testOrderNonWhitelisted.id,
    shopDomain: shop.domain,
    force: true
  });
  console.log('🛡️ Non-whitelisted call result:', {
    success: nonWhitelistedCall.success,
    dryRun: nonWhitelistedCall.dryRun,
    providerCallSid: nonWhitelistedCall.providerCallSid,
    reason: nonWhitelistedCall.simulationReason
  });

  // Test Emergency Stop Switch
  console.log('\n--- STEP 5: Emergency Stop Verification ---');
  process.env.EMERGENCY_STOP = 'true';
  const emergencyCall = await CallWorkflowService.initiateCall({
    orderId: testOrderNonWhitelisted.id,
    shopDomain: shop.domain,
    force: true
  });
  console.log('🚨 Emergency Stop Test Result:', {
    blocked: emergencyCall.success === false,
    reason: emergencyCall.reason
  });
  process.env.EMERGENCY_STOP = 'false';

  // Test Whitelisted Number Call Execution
  console.log('\n--- STEP 6: Whitelisted Live Calling Test ---');
  const testPhoneWhitelisted = '+923001234567';
  process.env.ADMIN_TEST_NUMBERS = `${testPhoneWhitelisted},+923331112233`;

  const testOrderWhitelisted = await prisma.order.create({
    data: {
      shopId: shop.id,
      shopifyOrderGid: `gid://shopify/Order/phase6-wl-${Date.now()}`,
      orderNumber: `P6-${Math.floor(1000 + Math.random() * 9000)}`,
      totalAmount: 3200,
      currency: 'PKR',
      status: 'Pending Confirmation',
      callStatus: 'pending',
      lineItemsSummary: 'Leather Jacket',
      customer: {
        create: {
          shopId: shop.id,
          phone: testPhoneWhitelisted,
          firstName: 'Tariq',
          lastName: 'Mehmood'
        }
      },
      payload: JSON.stringify({
        id: `9990002`,
        order_number: 9992,
        phone: testPhoneWhitelisted,
        total_price: '3200',
        line_items: [{ title: 'Leather Jacket', quantity: 1, price: '3200' }],
        shipping_address: { name: 'Tariq Mehmood', phone: testPhoneWhitelisted }
      })
    }
  });

  console.log(`Created whitelisted test order ${testOrderWhitelisted.orderNumber} (Phone: ${testPhoneWhitelisted})`);
  const whitelistedCall = await CallWorkflowService.initiateCall({
    orderId: testOrderWhitelisted.id,
    shopDomain: shop.domain,
    force: true
  });
  console.log('🎯 Whitelisted call result:', {
    success: whitelistedCall.success,
    liveCall: whitelistedCall.liveCall || false,
    callId: whitelistedCall.callId,
    providerCallSid: whitelistedCall.providerCallSid,
    reason: whitelistedCall.reason || null
  });

  // Test Call Result & Database Record Update
  console.log('\n--- STEP 7: Call Decision & State Transition Test ---');
  const simulatedTranscript = `AI: Assalam o Alaikum, main Zara bol rahi hoon Sunday Bazaar se. Kya meri baat Tariq Mehmood se ho rahi hai?\nCustomer: Jee haan, bilkul main Tariq bol raha hoon.\nAI: Aap ne order #9992 place kiya tha Rs. 3200 ka. Kya aap confirm karte hain?\nCustomer: Jee bilkul, mera order confirm kar dein taake jald delivery ho jaye. Shukriya.`;

  const resultHandling = await CallWorkflowService.handleCallResult({
    orderId: testOrderWhitelisted.id,
    shopDomain: shop.domain,
    callId: whitelistedCall.callId,
    transcript: simulatedTranscript,
    durationSec: 42,
    callStatus: 'completed'
  });

  console.log('✅ Call Result Handled:', {
    outcome: resultHandling.outcome,
    intent: resultHandling.decision?.intent,
    confidence: resultHandling.decision?.confidence,
    emotion: resultHandling.decision?.customerEmotion
  });

  // Verify DB state
  const updatedOrder = await prisma.order.findUnique({
    where: { id: testOrderWhitelisted.id }
  });
  const updatedCall = await prisma.call.findUnique({
    where: { id: whitelistedCall.callId }
  });

  console.log('📊 Verified Database Record:');
  console.log('- Order Status:', updatedOrder.status);
  console.log('- Order Call Status:', updatedOrder.callStatus);
  console.log('- Call Outcome:', updatedCall.outcome);
  console.log('- Call Intent:', updatedCall.intent);
  console.log('- Call Sentiment:', updatedCall.sentiment);
  console.log('- Call Duration:', updatedCall.durationSec, 'seconds');
  console.log('- Has Transcript:', Boolean(updatedCall.transcript));

  console.log('\n====================================================');
  console.log('  ALL PHASE 6 VERIFICATION CHECKS COMPLETED!        ');
  console.log('====================================================');
}

main()
  .catch((e) => {
    console.error('❌ Verification failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
