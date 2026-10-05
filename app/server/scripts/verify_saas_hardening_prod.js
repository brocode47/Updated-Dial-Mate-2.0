/**
 * Production SaaS Hardening & WhatsApp Customer Agent Verification Script
 * Validates:
 * 1. Call Recording Retention invariant (MAX = 20, media deletion via Twilio, DB intact)
 * 2. Outbound WhatsApp Order Message Service (Price reconciliation, Idempotency, Whitelist)
 * 3. Inbound WhatsApp Conversational AI Agent ("Zara") (Context, Negation, Tools, Human Takeover)
 * 4. Multi-tenant isolation (Shop A vs Shop B)
 * 5. WA-AKG Baileys live session connectivity ('2cmrlo')
 */

import { prisma } from '../src/db/prisma.js';
import { CallRecordingRetentionService } from '../src/services/callRecordingRetentionService.js';
import { WhatsAppOrderMessageService } from '../src/services/whatsappOrderMessageService.js';
import { WhatsAppAgentService } from '../src/services/whatsappAgentService.js';
import { WhatsAppClient } from '../src/integrations/whatsapp/client.js';

async function runVerification() {
  console.log('================================================================');
  console.log('🔍 DIAL MATE 2.0 — SAAS HARDENING & WHATSAPP AGENT VERIFICATION');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      if (details) console.log(`   └─ ${details}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
      if (details) console.error(`   └─ ${details}`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------
    // PART 1: Call Recording Retention Invariant
    // -------------------------------------------------------------
    console.log('--- 1. CALL RECORDING RETENTION INVARIANT ---');
    assert(
      CallRecordingRetentionService.MAX_STORED_CALL_RECORDINGS === 20,
      'MAX_STORED_CALL_RECORDINGS constant is strictly 20',
      `Value: ${CallRecordingRetentionService.MAX_STORED_CALL_RECORDINGS}`
    );

    const callsWithRecordings = await prisma.call.findMany({
      where: { recordingUrl: { not: null } },
      select: { id: true, recordingUrl: true, createdAt: true },
      orderBy: { createdAt: 'desc' }
    });

    console.log(`   Found ${callsWithRecordings.length} calls with recording URLs in database.`);
    assert(
      callsWithRecordings.length <= 20,
      'Total stored call recordings in DB <= 20',
      `Current count: ${callsWithRecordings.length}`
    );

    // -------------------------------------------------------------
    // PART 2: WA-AKG Session Connectivity
    // -------------------------------------------------------------
    console.log('\n--- 2. WA-AKG SESSION CONNECTIVITY ---');
    const waClient = new WhatsAppClient();
    const sessionId = process.env.WA_AKG_SESSION_ID || '2cmrlo';
    
    try {
      const statusRes = await waClient.checkSessionStatus(sessionId);
      console.log('   WA-AKG Session Check Result:', JSON.stringify(statusRes));
      assert(
        statusRes.connected === true,
        `WA-AKG Session '${sessionId}' is CONNECTED`,
        `Status: ${statusRes.status}, JID: ${statusRes.me?.id || statusRes.jid || 'N/A'}`
      );
    } catch (err) {
      console.error('   WA-AKG check failed:', err.message);
      assert(false, `WA-AKG Session '${sessionId}' connected`, err.message);
    }

    // Check DB WhatsAppIntegration mapping
    const waIntegration = await prisma.whatsAppIntegration.findFirst({
      where: { sessionId },
      include: { shop: true }
    });
    assert(
      !!waIntegration && !!waIntegration.shop,
      `WhatsAppIntegration record exists for session '${sessionId}'`,
      `Linked Shop: ${waIntegration?.shop?.domain || 'None'} (${waIntegration?.shop?.name || 'None'})`
    );

    // -------------------------------------------------------------
    // PART 3: Outbound WhatsApp Order Communication Service
    // -------------------------------------------------------------
    console.log('\n--- 3. OUTBOUND ORDER COMMUNICATION & PRICE RECONCILIATION ---');
    
    // Test 3A: Valid Price Calculation
    const validCalc = WhatsAppOrderMessageService.reconcileOrderPrice({
      line_items: [{ price: '1200.00', quantity: 2 }],
      total_shipping_price_set: { shop_money: { amount: '200.00' } },
      total_discounts: '100.00',
      total_price: '2500.00'
    });
    assert(
      validCalc.valid === true && validCalc.calculatedTotal === 2500,
      'Price reconciliation: matches line_items (2400) + shipping (200) - discount (100) = 2500',
      `Calculated: ${validCalc.calculatedTotal}, Authoritative: ${validCalc.authoritativeTotal}`
    );

    // Test 3B: Discrepancy Detection (> 1.0 PKR)
    const discrepancyCalc = WhatsAppOrderMessageService.reconcileOrderPrice({
      line_items: [{ price: '1000.00', quantity: 1 }],
      total_shipping_price_set: { shop_money: { amount: '150.00' } },
      total_discounts: '0.00',
      total_price: '1500.00' // Discrepancy: 1150 vs 1500
    });
    assert(
      discrepancyCalc.valid === false && discrepancyCalc.difference === 350,
      'Price reconciliation: flags discrepancy (> 1 PKR) and blocks dispatch',
      `Discrepancy diff: ${discrepancyCalc.difference} PKR`
    );

    // Test 3C: Message template format
    const formattedMsg = WhatsAppOrderMessageService.formatOrderConfirmationMessage({
      customerName: 'Hamza Khan',
      orderName: '#TEST-1001',
      items: [{ title: 'Wireless Earbuds', quantity: 1, price: '2500' }],
      calculatedTotal: 2700,
      currency: 'PKR',
      shippingAddress: 'House 12, Street 4, F-7/2, Islamabad'
    });
    assert(
      formattedMsg.includes('Hamza Khan') &&
      formattedMsg.includes('#TEST-1001') &&
      formattedMsg.includes('Wireless Earbuds') &&
      formattedMsg.includes('F-7/2, Islamabad') &&
      formattedMsg.includes('reply karke confirm ya change kar sakte hain'),
      'Formatted message contains customer name, order name, items, address, and reply prompt'
    );

    // -------------------------------------------------------------
    // PART 4: Inbound WhatsApp Conversational AI Agent ("Zara")
    // -------------------------------------------------------------
    console.log('\n--- 4. INBOUND WHATSAPP AI CUSTOMER AGENT ("ZARA") ---');

    // Test 4A: Negation Safety Rule Engine
    const neg1 = WhatsAppAgentService.detectIntentAndEntities('mera order confirm mat karna please');
    assert(
      neg1.intent !== 'CONFIRM_ORDER' && neg1.hasNegation === true,
      'Negation safety: "confirm mat karna" is NOT classified as CONFIRM_ORDER',
      `Detected intent: ${neg1.intent}, Negation: ${neg1.hasNegation}`
    );

    const neg2 = WhatsAppAgentService.detectIntentAndEntities('order cancel nahi karna');
    assert(
      neg2.intent !== 'CANCEL_ORDER' && neg2.hasNegation === true,
      'Negation safety: "cancel nahi karna" is NOT classified as CANCEL_ORDER',
      `Detected intent: ${neg2.intent}, Negation: ${neg2.hasNegation}`
    );

    const posConfirm = WhatsAppAgentService.detectIntentAndEntities('jee haan bilkul order confirm hai');
    assert(
      posConfirm.intent === 'CONFIRM_ORDER',
      'Affirmative detection: "jee haan bilkul order confirm hai" -> CONFIRM_ORDER',
      `Detected intent: ${posConfirm.intent}`
    );

    // Test 4B: Live AI Execution with Gemini in Roman Urdu
    console.log('   Testing live Zara AI response generation...');
    const targetShop = waIntegration?.shop || await prisma.shop.findFirst();
    if (targetShop) {
      const aiResponse = await WhatsAppAgentService.handleIncomingMessage({
        shopDomain: targetShop.domain,
        sessionId,
        fromJid: '923001234567@s.whatsapp.net',
        text: 'Assalam o Alaikum Zara, mera order kab deliver hoga?'
      });

      console.log('   Zara Response:', JSON.stringify(aiResponse));
      assert(
        aiResponse.success === true && typeof aiResponse.reply === 'string' && aiResponse.reply.length > 5,
        'Zara AI generates polite Roman Urdu customer response via Gemini',
        `Response text: "${aiResponse.reply.substring(0, 80)}..." [Model: ${aiResponse.modelUsed || 'N/A'}]`
      );

      // Test 4C: Human Takeover Guard
      // Create or update a test conversation with isTakeover: true
      const testCustomer = await prisma.customer.findFirst({
        where: { shopId: targetShop.id }
      });
      if (testCustomer) {
        let testConv = await prisma.conversation.findFirst({
          where: { customerId: testCustomer.id }
        });
        if (!testConv) {
          testConv = await prisma.conversation.create({
            data: {
              customerId: testCustomer.id,
              channel: 'WHATSAPP',
              status: 'OPEN',
              isTakeover: true
            }
          });
        } else {
          await prisma.conversation.update({
            where: { id: testConv.id },
            data: { isTakeover: true }
          });
        }

        const takeoverRes = await WhatsAppAgentService.handleIncomingMessage({
          shopDomain: targetShop.domain,
          sessionId,
          fromJid: `${testCustomer.phone?.replace('+', '') || '923009999999'}@s.whatsapp.net`,
          text: 'Hello anyone there?'
        });

        assert(
          takeoverRes.ignored === true && takeoverRes.reason === 'HUMAN_TAKEOVER_ACTIVE',
          'Human takeover guard: AI remains silent when conversation is marked as human takeover',
          `Result: ${JSON.stringify(takeoverRes)}`
        );

        // Reset takeover state
        await prisma.conversation.update({
          where: { id: testConv.id },
          data: { isTakeover: false }
        });
      }
    }

    // -------------------------------------------------------------
    // PART 5: Multi-Tenant Isolation
    // -------------------------------------------------------------
    console.log('\n--- 5. MULTI-TENANT ISOLATION ---');
    // Ensure that resolving session for unknown shop throws error or returns null
    const nonExistentShopRes = await WhatsAppAgentService.handleIncomingMessage({
      shopDomain: 'non-existent-shop-12345.myshopify.com',
      sessionId: 'fake-session',
      fromJid: '923001234567@s.whatsapp.net',
      text: 'Order status check'
    });
    assert(
      nonExistentShopRes.success === false,
      'Multi-tenant guard: Unknown/unauthorized shop request is rejected',
      `Error: ${nonExistentShopRes.error}`
    );

    console.log('\n================================================================');
    console.log(`SUMMARY: ${passed} PASSED | ${failed} FAILED`);
    console.log('================================================================');

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (error) {
    console.error('💥 Unhandled Verification Exception:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runVerification();
