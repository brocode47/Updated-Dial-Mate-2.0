import express from 'express';
import { apiRouter } from './src/routes/api.js';
import { prisma } from './src/lib/db.js';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-secret';

const app = express();

app.use('/api', apiRouter());

// Mock Prisma
const mockLogs = [
  {
    id: 1,
    shopId: 'test-shop-id',
    customerId: 'cust-1',
    conversationId: 'conv-1',
    userMessage: 'hello',
    detectedAgent: 'support_agent',
    intent: 'general_question',
    action: 'llm_response',
    modelUsed: 'qwen2.5:1.5b',
    usedLLM: true,
    fallbackUsed: false,
    responseTimeMs: 1500,
    status: 'SUCCESS',
    createdAt: new Date()
  },
  {
    id: 2,
    shopId: 'test-shop-id',
    userMessage: 'timeout test',
    detectedAgent: 'support_agent',
    intent: 'general_question',
    action: 'escalate',
    modelUsed: null,
    usedLLM: false,
    fallbackUsed: true,
    responseTimeMs: 0,
    status: 'FALLBACK',
    errorMessage: 'Timeout exceeded (>10s)',
    createdAt: new Date()
  }
];

prisma.aIInteractionLog = {
  findMany: async () => mockLogs,
  count: async () => mockLogs.length,
};

prisma.shop = {
  findUnique: async () => ({ id: 'test-shop-id', domain: 'test.myshopify.com', organizationId: 'org-1' })
};

async function runTests() {
  const PORT = 9999;
  const token = jwt.sign({ shopDomain: 'test.myshopify.com' }, process.env.JWT_SECRET);
  const headers = { 'Authorization': `Bearer ${token}` };

  const server = app.listen(PORT, async () => {
    console.log('Test server running on port 9999');

    try {
      console.log('\n--- Fetching Logs ---');
      const logsRes = await fetch(`http://localhost:${PORT}/api/ai/logs`, { headers });
      const logsData = await logsRes.json();
      console.log('Logs Data:', JSON.stringify(logsData, null, 2));
      if (logsData.total === 2) console.log('✅ Logs test passed');
      else console.log('❌ Logs test failed');

      console.log('\n--- Fetching Stats ---');
      const statsRes = await fetch(`http://localhost:${PORT}/api/ai/stats`, { headers });
      const statsData = await statsRes.json();
      console.log('Stats Data:', JSON.stringify(statsData, null, 2));
      
      if (statsData.totalRequests === 2 && statsData.fallbackPercentage === 50 && statsData.timeoutCount === 1) {
        console.log('✅ Stats test passed');
      } else {
        console.log('❌ Stats test failed');
      }

    } catch (e) {
      console.error(e);
    } finally {
      server.close();
    }
  });
}

runTests();
