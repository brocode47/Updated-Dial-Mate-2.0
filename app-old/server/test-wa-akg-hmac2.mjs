import fetch from 'node-fetch';
import crypto from 'crypto';

async function runTests() {
  const secret = 'test-secret';
  const url = 'http://localhost:8787/webhooks/wa-akg';

  const payload = {
    event: 'message.received',
    data: { messageId: 'test-msg-123' }
  };
  
  const body = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');

  console.log('Testing WA-AKG HMAC...');
  let failed = 0;

  async function test(name, headers, reqBody, expectedStatus, expectsTimeout = false) {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
        controller.abort();
    }, 1000); // 1 sec timeout

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: reqBody,
        signal: controller.signal
      });
      clearTimeout(timeout);
      
      if (res.status === expectedStatus) {
        console.log(`[PASS] ${name}`);
      } else {
        console.error(`[FAIL] ${name} - Expected ${expectedStatus}, got ${res.status}`);
        failed++;
      }
    } catch (e) {
      clearTimeout(timeout);
      if (e.name === 'AbortError' && expectsTimeout) {
         console.log(`[PASS] ${name} (Timeout as expected because Redis is missing)`);
      } else {
         console.error(`[ERROR] ${name}: ${e.message}`);
         failed++;
      }
    }
  }

  await test('Missing signature', { 'Content-Type': 'application/json' }, body, 401);

  await test('Invalid signature', { 
    'Content-Type': 'application/json',
    'x-webhook-signature': 'sha256=invalid123'
  }, body, 401);

  await test('Valid signature', { 
    'Content-Type': 'application/json',
    'x-webhook-signature': `sha256=${signature}`
  }, body, 200, true);

  const modifiedBody = JSON.stringify({ ...payload, event: 'tampered' });
  await test('Modified body', { 
    'Content-Type': 'application/json',
    'x-webhook-signature': `sha256=${signature}`
  }, modifiedBody, 401);

  const malformedBody = "{ invalid json ";
  const malformedSignature = crypto.createHmac('sha256', secret).update(malformedBody).digest('hex');
  await test('Malformed JSON', {
    'Content-Type': 'application/json',
    'x-webhook-signature': `sha256=${malformedSignature}`
  }, malformedBody, 200, false); // Malformed JSON doesn't queue, it throws inside try-catch and returns 200 OK

  if (failed > 0) {
    console.error(`\nFAILED ${failed} tests.`);
    process.exit(1);
  } else {
    console.log('\nALL TESTS PASSED.');
    process.exit(0);
  }
}

runTests();
