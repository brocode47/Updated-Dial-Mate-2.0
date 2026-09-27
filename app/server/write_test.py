content = '''import fetch from 'node-fetch';
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

  async function test(name, headers, reqBody, expectedStatus) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: reqBody
      });
      if (res.status === expectedStatus) {
        console.log([PASS] );
      } else {
        console.error([FAIL]  - Expected , got );
        failed++;
      }
    } catch (e) {
      console.error([ERROR] : );
      failed++;
    }
  }

  await test('Missing signature', { 'Content-Type': 'application/json' }, body, 401);

  await test('Invalid signature', { 
    'Content-Type': 'application/json',
    'x-webhook-signature': 'sha256=invalid123'
  }, body, 401);

  await test('Valid signature', { 
    'Content-Type': 'application/json',
    'x-webhook-signature': sha256=
  }, body, 200);

  const modifiedBody = JSON.stringify({ ...payload, event: 'tampered' });
  await test('Modified body', { 
    'Content-Type': 'application/json',
    'x-webhook-signature': sha256=
  }, modifiedBody, 401);

  const malformedBody = "{ invalid json ";
  const malformedSignature = crypto.createHmac('sha256', secret).update(malformedBody).digest('hex');
  await test('Malformed JSON', {
    'Content-Type': 'application/json',
    'x-webhook-signature': sha256=
  }, malformedBody, 200);

  if (failed > 0) {
    console.error(\\nFAILED  tests.);
    process.exit(1);
  } else {
    console.log('\\nALL TESTS PASSED.');
    process.exit(0);
  }
}

runTests();'''

with open('test-wa-akg-hmac.mjs', 'w', encoding='utf-8') as f:
    f.write(content)
