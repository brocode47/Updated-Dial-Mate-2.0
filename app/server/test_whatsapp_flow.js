/**
 * DialMate 2.0 - Phase 3 Step 1 Production Hardening Test Suite
 * 
 * Tests:
 * 1. Normal text message flow
 * 2. Duplicate message prevention (idempotency)
 * 3. AI timeout retry behavior (recoverable error throws for BullMQ)
 * 4. WA-AKG failure retry behavior (recoverable error throws for BullMQ)
 * 5. Image message metadata preparation & routing
 * 6. Voice note metadata preparation & routing
 * 7. Document message metadata preparation & routing
 * 8. Multi-shop session isolation (strict tenant sessionId enforcement)
 */

import assert from 'node:assert';
import { processWhatsAppJob } from './src/workers/whatsappWorker.js';
import { WhatsAppClient } from './src/integrations/whatsapp/client.js';
import { MessageTrackerService } from './src/services/messageTracker.js';
import { prisma } from './src/lib/db.js';

let passedTests = 0;
let totalTests = 0;

function reportTest(name, passed, details = '') {
  totalTests++;
  if (passed) {
    passedTests++;
    console.log(`✅ PASS: ${name} ${details ? '(' + details + ')' : ''}`);
  } else {
    console.error(`❌ FAIL: ${name} ${details ? '(' + details + ')' : ''}`);
  }
}

// Global Spies & Stubs
const capturedReplies = [];
const capturedFetchRequests = [];

// Stub WhatsAppClient.prototype.sendMessage
const originalSendMessage = WhatsAppClient.prototype.sendMessage;
WhatsAppClient.prototype.sendMessage = async function(to, text, options) {
  capturedReplies.push({
    sessionId: this.sessionId,
    shopId: this.shopId,
    to,
    text,
    options
  });
  return { success: true, messageId: 'wa-msg-ack-123' };
};

// Stub global fetch for AI Engine
const originalFetch = global.fetch;

async function runTestSuite() {
  console.log('======================================================================');
  console.log('DIALMATE 2.0: PHASE 3 STEP 1 WHATSAPP AKG PRODUCTION HARDENING TESTS');
  console.log('======================================================================\n');

  // Stub Prisma Customer / Shop queries to prevent external DB dependency
  prisma.customer.findFirst = async () => ({ id: 'cust-123', shopId: 'shop-alpha', phone: '923001234567' });
  prisma.customer.create = async () => ({ id: 'cust-123', shopId: 'shop-alpha', phone: '923001234567' });
  prisma.shop.findUnique = async ({ where }) => ({ id: 'shop-alpha', domain: where.domain });

  // ------------------------------------------------------------------
  // Test 1: Normal Text Message Flow
  // ------------------------------------------------------------------
  console.log('--- Test 1: Normal Text Message Flow ---');
  capturedReplies.length = 0;
  capturedFetchRequests.length = 0;

  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    capturedFetchRequests.push({ url, body });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        response: 'Aap ka order confirm ho chuka hai.',
        agent: 'order_agent',
        intent: 'order_status',
        confidence: 0.95,
        conversation_id: 'conv-101',
        type: 'conversation'
      })
    };
  };

  const job1 = {
    data: {
      shopId: 'shop-alpha',
      shopDomain: 'alpha.myshopify.com',
      sessionId: 'session-alpha-1',
      payload: {
        key: { id: 'msg-norm-1001', remoteJid: '923001234567@s.whatsapp.net', fromMe: false },
        type: 'text',
        content: 'Mera order kahan hai?'
      }
    }
  };

  const res1 = await processWhatsAppJob(job1);
  const test1Ok = res1.success &&
                  res1.agent === 'order_agent' &&
                  capturedFetchRequests.length === 1 &&
                  capturedReplies.length === 1 &&
                  capturedReplies[0].text === 'Aap ka order confirm ho chuka hai.' &&
                  capturedReplies[0].sessionId === 'session-alpha-1';

  reportTest('Normal text message routing and reply', test1Ok, `reply: "${capturedReplies[0]?.text}"`);

  // ------------------------------------------------------------------
  // Test 2: Duplicate Message Prevention (Idempotency)
  // ------------------------------------------------------------------
  console.log('\n--- Test 2: Duplicate Message Prevention ---');
  capturedReplies.length = 0;
  capturedFetchRequests.length = 0;

  // Send the EXACT same job with msg-norm-1001
  const res2 = await processWhatsAppJob(job1);
  const test2Ok = res2.success &&
                  res2.duplicate === true &&
                  capturedFetchRequests.length === 0 &&
                  capturedReplies.length === 0;

  reportTest('Duplicate message skipped without AI or WhatsApp call', test2Ok, 'duplicate=true, 0 fetches, 0 replies');

  // ------------------------------------------------------------------
  // Test 3: AI Timeout Retry (Recoverable Error Throws for BullMQ)
  // ------------------------------------------------------------------
  console.log('\n--- Test 3: AI Timeout Retry Behavior ---');
  capturedReplies.length = 0;
  capturedFetchRequests.length = 0;

  global.fetch = async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    throw abortErr;
  };

  const job3 = {
    data: {
      shopId: 'shop-alpha',
      shopDomain: 'alpha.myshopify.com',
      sessionId: 'session-alpha-1',
      payload: {
        key: { id: 'msg-timeout-3001', remoteJid: '923001234567@s.whatsapp.net', fromMe: false },
        type: 'text',
        content: 'Product price kya hai?'
      }
    }
  };

  let threwTimeoutError = false;
  try {
    await processWhatsAppJob(job3);
  } catch (err) {
    threwTimeoutError = err.message.includes('Recoverable AI Error') && err.message.includes('timeout');
  }

  // Verify that the message lock was released so a retry attempt CAN re-process
  const unlockedForRetry = !(await MessageTrackerService.isAlreadyProcessed('msg-timeout-3001'));

  reportTest('AI timeout throws recoverable error for BullMQ retry and releases lock', threwTimeoutError && unlockedForRetry, 'Recoverable error thrown');

  // ------------------------------------------------------------------
  // Test 4: WA-AKG Failure Retry Behavior
  // ------------------------------------------------------------------
  console.log('\n--- Test 4: WA-AKG Failure Retry Behavior ---');
  capturedReplies.length = 0;
  capturedFetchRequests.length = 0;

  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ response: 'Reply message', agent: 'support_agent', intent: 'greeting', confidence: 0.9 })
  });

  // Temporarily force sendMessage to fail with a network error
  WhatsAppClient.prototype.sendMessage = async function() {
    throw new Error('Connection reset by peer (WA-AKG down)');
  };

  const job4 = {
    data: {
      shopId: 'shop-alpha',
      shopDomain: 'alpha.myshopify.com',
      sessionId: 'session-alpha-1',
      payload: {
        key: { id: 'msg-wa-err-4001', remoteJid: '923001234567@s.whatsapp.net', fromMe: false },
        type: 'text',
        content: 'Hello'
      }
    }
  };

  let threwWaError = false;
  try {
    await processWhatsAppJob(job4);
  } catch (err) {
    threwWaError = err.message.includes('Recoverable WA-AKG Error');
  }

  // Restore stub
  WhatsAppClient.prototype.sendMessage = async function(to, text, options) {
    capturedReplies.push({ sessionId: this.sessionId, shopId: this.shopId, to, text, options });
    return { success: true };
  };

  const unlockedForRetry4 = !(await MessageTrackerService.isAlreadyProcessed('msg-wa-err-4001'));
  reportTest('WA-AKG delivery failure throws recoverable error for BullMQ retry', threwWaError && unlockedForRetry4, 'Recoverable error thrown');

  // ------------------------------------------------------------------
  // Test 5: Image Message Metadata Preparation
  // ------------------------------------------------------------------
  console.log('\n--- Test 5: Image Message Metadata Preparation ---');
  capturedReplies.length = 0;
  capturedFetchRequests.length = 0;

  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    capturedFetchRequests.push({ url, body });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        response: 'Ji ye product available hai, price 2500 PKR hai.',
        agent: 'product_agent',
        intent: 'product_availability',
        confidence: 0.95
      })
    };
  };

  const job5 = {
    data: {
      shopId: 'shop-alpha',
      sessionId: 'session-alpha-1',
      payload: {
        key: { id: 'msg-img-5001', remoteJid: '923001234567@s.whatsapp.net', fromMe: false },
        type: 'imageMessage',
        fileUrl: 'https://media.dialmate.app/shoes.jpg',
        mimetype: 'image/jpeg',
        caption: 'kya ye available hai?'
      }
    }
  };

  const res5 = await processWhatsAppJob(job5);
  const test5Ok = res5.success &&
                  capturedFetchRequests.length === 1 &&
                  capturedFetchRequests[0].body.message.includes('[Customer attached an image]') &&
                  capturedFetchRequests[0].body.message.includes('kya ye available hai?');

  reportTest('Image message parsed with caption & metadata and routed to AI', test5Ok, `body: "${capturedFetchRequests[0]?.body.message}"`);

  // ------------------------------------------------------------------
  // Test 6: Voice Note Metadata Preparation
  // ------------------------------------------------------------------
  console.log('\n--- Test 6: Voice Note Metadata Preparation ---');
  capturedReplies.length = 0;
  capturedFetchRequests.length = 0;

  const job6 = {
    data: {
      shopId: 'shop-alpha',
      sessionId: 'session-alpha-1',
      payload: {
        key: { id: 'msg-voice-6001', remoteJid: '923001234567@s.whatsapp.net', fromMe: false },
        type: 'audioMessage',
        fileUrl: 'https://media.dialmate.app/voice.ogg',
        mimetype: 'audio/ogg',
        duration: 4
      }
    }
  };

  const res6 = await processWhatsAppJob(job6);
  const test6Ok = res6.success &&
                  capturedFetchRequests.length === 1 &&
                  capturedFetchRequests[0].body.message.includes('voice note');

  reportTest('Voice note parsed with duration & metadata and routed to AI', test6Ok, `body: "${capturedFetchRequests[0]?.body.message}"`);

  // ------------------------------------------------------------------
  // Test 7: Document Message Metadata Preparation
  // ------------------------------------------------------------------
  console.log('\n--- Test 7: Document Message Metadata Preparation ---');
  capturedReplies.length = 0;
  capturedFetchRequests.length = 0;

  const job7 = {
    data: {
      shopId: 'shop-alpha',
      sessionId: 'session-alpha-1',
      payload: {
        key: { id: 'msg-doc-7001', remoteJid: '923001234567@s.whatsapp.net', fromMe: false },
        type: 'documentMessage',
        fileName: 'bank_receipt.pdf',
        fileUrl: 'https://media.dialmate.app/receipt.pdf',
        mimetype: 'application/pdf',
        caption: 'Payment slip check karein'
      }
    }
  };

  const res7 = await processWhatsAppJob(job7);
  const test7Ok = res7.success &&
                  capturedFetchRequests.length === 1 &&
                  capturedFetchRequests[0].body.message.includes('bank_receipt.pdf');

  reportTest('Document message parsed with fileName & caption', test7Ok, `body: "${capturedFetchRequests[0]?.body.message}"`);

  // ------------------------------------------------------------------
  // Test 8: Multi-Shop Session Isolation
  // ------------------------------------------------------------------
  console.log('\n--- Test 8: Multi-Shop Session Isolation ---');
  capturedReplies.length = 0;
  capturedFetchRequests.length = 0;

  const jobShopAlpha = {
    data: {
      shopId: 'shop-uuid-alpha',
      shopDomain: 'store-alpha.myshopify.com',
      sessionId: 'session-alpha-custom-001',
      payload: {
        key: { id: 'msg-iso-8001', remoteJid: '923111111111@s.whatsapp.net', fromMe: false },
        type: 'text',
        content: 'Shop Alpha Message'
      }
    }
  };

  const jobShopBeta = {
    data: {
      shopId: 'shop-uuid-beta',
      shopDomain: 'store-beta.myshopify.com',
      sessionId: 'session-beta-custom-002',
      payload: {
        key: { id: 'msg-iso-8002', remoteJid: '923222222222@s.whatsapp.net', fromMe: false },
        type: 'text',
        content: 'Shop Beta Message'
      }
    }
  };

  await processWhatsAppJob(jobShopAlpha);
  await processWhatsAppJob(jobShopBeta);

  const test8Ok = capturedReplies.length === 2 &&
                  capturedReplies[0].sessionId === 'session-alpha-custom-001' &&
                  capturedReplies[0].shopId === 'shop-uuid-alpha' &&
                  capturedReplies[1].sessionId === 'session-beta-custom-002' &&
                  capturedReplies[1].shopId === 'shop-uuid-beta';

  reportTest('Multi-shop session isolation verified (Alpha vs Beta)', test8Ok,
    `Alpha: ${capturedReplies[0]?.sessionId}, Beta: ${capturedReplies[1]?.sessionId}`);

  // ------------------------------------------------------------------
  // Restore globals & Disconnect
  // ------------------------------------------------------------------
  WhatsAppClient.prototype.sendMessage = originalSendMessage;
  global.fetch = originalFetch;

  try {
    const { redis, connection } = await import('./src/lib/redis.js');
    redis.disconnect();
    connection.disconnect();
  } catch (_) {}

  console.log('\n======================================================================');
  console.log(`TEST RESULTS: ${passedTests}/${totalTests} PASSED (${((passedTests/totalTests)*100).toFixed(1)}%)`);
  console.log('======================================================================\n');

  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
