import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const url = 'http://localhost:8787/webhooks/wa-akg';
const secret = process.env.WA_AKG_WEBHOOK_SECRET;

if (!secret) {
  console.error('WA_AKG_WEBHOOK_SECRET is not set in .env');
  process.exit(1);
}

const payload = {
  event: "message.received",
  sessionId: "e2e-test-session",
  data: {
    key: {
      id: "e2e-job-67890",
      remoteJid: "923000000000@s.whatsapp.net"
    },
    content: "E2E_TEST_DIAL_MATE",
    type: "text"
  }
};

const rawBody = JSON.stringify(payload);
const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

async function sendWebhook() {
  console.log(`Sending webhook to ${url}`);
  console.log(`Signature: ${signature}`);
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature
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

sendWebhook();
