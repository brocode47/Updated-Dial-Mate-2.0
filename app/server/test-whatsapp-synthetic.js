import { test } from 'node:test';
import assert from 'node:assert';
import { WhatsAppClient } from './src/integrations/whatsapp/client.js';
import * as dispatcher from './src/integrations/ai/dispatcher.js';
import { processWhatsAppJob } from './src/workers/whatsappWorker.js';
import { ChatStateService } from './src/services/chatState.js';

import 'dotenv/config.js';

// Setup environment and test configs
process.env.WA_AKG_API_KEY = 'fake';
process.env.WA_AKG_SESSION_ID = 'test-session';
process.env.SHOPIFY_API_KEY = 'fake-shopify-key';
process.env.SHOPIFY_API_SECRET = 'fake-shopify-secret';
process.env.APP_URL = 'http://localhost:3000';


const shopDomain = 'e2e-test-session';
const sessionId = 'test-session';
const testJid = '923000000000@s.whatsapp.net';
const chatKey = `${shopDomain}:${sessionId}:${testJid}`;

async function runTests() {
  console.log('--- STARTING SYNTHETIC WHATSAPP AI PATH TESTS ---');
  
// 1. Spies & Mocks
  const sendMessageStub = {
    called: false,
    callCount: 0,
    calls: [],
    restore: () => {},
    stub: (to, text, options) => {
      sendMessageStub.called = true;
      sendMessageStub.callCount++;
      sendMessageStub.calls.push([to, text, options]);
      return Promise.resolve({ success: true });
    }
  };
  const downloadMediaStub = {
    called: false,
    restore: () => {},
    stub: () => {
      downloadMediaStub.called = true;
      // Return a tiny valid WAV audio buffer so Gemini API doesn't throw 400 INVALID_ARGUMENT
      const validWavBase64 = 'UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==';
      return Buffer.from(validWavBase64, 'base64');
    }
  };
  const originalSendMessage = WhatsAppClient.prototype.sendMessage;
  const originalDownloadMedia = WhatsAppClient.prototype.downloadMedia;

  WhatsAppClient.prototype.sendMessage = sendMessageStub.stub;
  WhatsAppClient.prototype.downloadMedia = downloadMediaStub.stub;
  
  // Clear chat state to start fresh
  await ChatStateService.clear(chatKey);

  // 2. Synthetic TEXT message
  console.log('\n>>> Test 1: TEXT Message');
  const textJob = {
    data: {
      shopDomain,
      sessionId,
      payload: {
        key: { id: 'msg-1', remoteJid: testJid },
        type: 'conversation',
        content: 'What is the price of the test product?'
      }
    }
  };

  try {
    await processWhatsAppJob(textJob);
    console.log('TEXT job finished successfully.');
  } catch (err) {
    console.log('TEXT job failed with:', err.message);
  }

  // Verify history
  let history = await ChatStateService.load(chatKey);
  console.log('ChatState history length after text:', history ? history.length : 0);

  // 3. Synthetic Tool Trigger Message
  console.log('\n>>> Test 2: Tool Dispatcher (Order Lookup)');
  const toolJob = {
    data: {
      shopDomain,
      sessionId,
      payload: {
        key: { id: 'msg-2', remoteJid: testJid },
        type: 'conversation',
        content: 'Please look up order TEST-ORDER-001'
      }
    }
  };

  try {
    await processWhatsAppJob(toolJob);
    console.log('TOOL job finished successfully.');
  } catch (err) {
    console.log('TOOL job failed with:', err.message);
  }
  
  history = await ChatStateService.load(chatKey);
  console.log('ChatState history length after tool trigger:', history ? history.length : 0);

  // 4. ChatState Continuity Message
  console.log('\n>>> Test 3: ChatState Continuity Message');
  const continuityJob = {
    data: {
      shopDomain,
      sessionId,
      payload: {
        key: { id: 'msg-continuity', remoteJid: testJid },
        type: 'conversation',
        content: 'What was my previous question?'
      }
    }
  };

  try {
    await processWhatsAppJob(continuityJob);
    console.log('CONTINUITY job finished successfully.');
  } catch (err) {
    console.log('CONTINUITY job failed with:', err.message);
  }
  
  history = await ChatStateService.load(chatKey);
  console.log('ChatState history length after continuity check:', history ? history.length : 0);

  // 5. Synthetic AUDIO message
  console.log('\n>>> Test 4: AUDIO Message');
  const audioJob = {
    data: {
      shopDomain,
      sessionId,
      payload: {
        key: { id: 'msg-3', remoteJid: testJid },
        type: 'AUDIO', // testing the AUDIO fix
        fileUrl: 'http://fake/audio.ogg',
        mimeType: 'audio/wav'
      }
    }
  };

  try {
    await processWhatsAppJob(audioJob);
    console.log('AUDIO job finished successfully.');
  } catch (err) {
    console.log('AUDIO job failed with:', err.message);
  }

  console.log('Was downloadMedia reached?', downloadMediaStub.called);

  // 5. Outbound Adapter Verification
  console.log('\n>>> Outbound WhatsApp Requests:');
  console.log('Total sendMessage calls:', sendMessageStub.callCount);
  sendMessageStub.calls.forEach((call, index) => {
    console.log(`Call ${index + 1}: JID = ${call[0]}, Text Length = ${call[1] ? call[1].length : 0}`);
  });

  // Cleanup
  sendMessageStub.restore();
  downloadMediaStub.restore();
  await ChatStateService.clear(chatKey);
  
  console.log('\n--- TESTS COMPLETED ---');
  process.exit(0);
}

runTests();
