import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const url = 'http://localhost:8787/webhooks/wa-akg';
const secret = process.env.WA_AKG_WEBHOOK_SECRET;

async function send(name, payload, signatureHeader) {
  console.log(`\n--- Test: ${name} ---`);
  const rawBody = JSON.stringify(payload);
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signatureHeader
      },
      body: rawBody
    });
    const text = await response.text();
    console.log(`HTTP Status: ${response.status}`);
    console.log(`Response Body: ${text}`);
  } catch (error) {
    console.error('Fetch error:', error);
  }
}

async function runTests() {
  const payloadA = {
    event: "message.received",
    sessionId: "e2e-test-session",
    data: {
      key: { id: "neg-job-A", remoteJid: "923000000000@s.whatsapp.net" },
      content: "E2E_TEST_DIAL_MATE", type: "text"
    }
  };
  const validSigA = 'sha256=' + crypto.createHmac('sha256', secret).update(JSON.stringify(payloadA)).digest('hex');

  // A. Invalid HMAC
  await send("A. Invalid HMAC", payloadA, "sha256=invalid12345");

  // B. Unknown session
  const payloadB = { ...payloadA, sessionId: "unknown-e2e-session", data: { ...payloadA.data, key: { ...payloadA.data.key, id: "neg-job-B" } } };
  const validSigB = 'sha256=' + crypto.createHmac('sha256', secret).update(JSON.stringify(payloadB)).digest('hex');
  await send("B. Unknown session", payloadB, validSigB);

  // C. Modified body
  await send("C. Modified body", payloadB, validSigA);
}

runTests();
