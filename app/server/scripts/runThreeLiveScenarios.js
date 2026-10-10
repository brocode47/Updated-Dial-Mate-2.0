/**
 * ============================================================================
 * GENUINE LIVE GEMINI TEST — 3 FRESH SCENARIOS (PHASE 14)
 * ============================================================================
 *
 * Runs 3 fresh scenarios against the live Gemini API (gemini-3.8-flash)
 * with rate limiting (4 rpm), 100% synthetic in-memory fixtures, and
 * strict provenance verification.
 *
 * Scenarios:
 * 1. Roman Urdu product discovery with price & delivery follow-up
 * 2. Product switching and context restoration (active product memory)
 * 3. Authorized order lookup with synthetic customer data (+923001234567)
 */

process.env.IS_EVAL_HARNESS = 'true';
process.env.NODE_ENV = 'test';

import { ZaraEvaluationHarness } from '../src/evaluation/zaraEvaluationHarness.js';

export const THREE_FRESH_SCENARIOS = [
  {
    id: 'LIVE_FRESH_01_ROMAN_URDU_DISCOVERY_PRICE',
    category: 'Product Discovery & Pricing',
    customerPhone: '+923001234567',
    dialogue: [
      { sender: 'customer', text: 'Assalam o alaikum, chair protection cover mil jaye ga?' },
      { sender: 'customer', text: 'Iska total rate kitna hai delivery mila ke?' }
    ],
    expectations: {
      expectedTool: 'search_shopify_products',
      mustQuoteAuthoritativePrice: '1,499',
      mustCalculateTotal: '1,698'
    }
  },
  {
    id: 'LIVE_FRESH_02_PRODUCT_SWITCH_AND_RESTORE',
    category: 'Contextual Continuity & Switching',
    customerPhone: '+923001234567',
    dialogue: [
      { sender: 'customer', text: 'Kitchen knife set dikhao' },
      { sender: 'customer', text: 'Nose clip bhi hai?' },
      { sender: 'customer', text: 'Wapis chhuri set par aao, link share karo' }
    ],
    expectations: {
      expectedTool: 'search_shopify_products',
      mustProvideProductLink: true
    }
  },
  {
    id: 'LIVE_FRESH_03_AUTHORIZED_ORDER_LOOKUP',
    category: 'Order Security & Authorization',
    customerPhone: '+923001234567',
    dialogue: [
      { sender: 'customer', text: 'Mera order status check karein, order number 1643 hai' }
    ],
    expectations: {
      expectedTool: 'resolve_order',
      mustVerifyOrderOwnership: true
    }
  }
];

async function main() {
  const rawKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY || process.env.GOOGLE_API_KEY || '';
  const apiKey = rawKey.trim();
  const modelName = process.env.EVAL_GEMINI_MODEL || 'gemini-3.8-flash';
  const allowMock = process.argv.includes('--mock') || process.env.ALLOW_MOCK_EVAL === 'true';

  console.log('\n======================================================================');
  console.log('DIAL MATE 2.0 — 3 FRESH LIVE GEMINI SCENARIOS (PHASE 14)');
  console.log('======================================================================');

  if (!apiKey && !allowMock) {
    console.error('\n❌ BLOCKED: No GEMINI_API_KEY detected in current process environment.\n');
    console.error('To run the real Gemini evaluation:');
    console.error('  $env:GEMINI_API_KEY = "your-authorized-api-key"');
    console.error('  npm.cmd run eval:live-three\n');
    console.error('Or run with mock adapter:');
    console.error('  npm.cmd run eval:live-three -- --mock\n');
    process.exit(1);
  }

  const isReal = Boolean(apiKey);
  console.log(`Execution Mode   : ${isReal ? 'REAL_GEMINI (Live Model Evaluation)' : 'MOCK_PROTOCOL'}`);
  console.log(`Model Target     : ${isReal ? modelName : 'MockGenAIAdapter'}`);
  console.log(`Rate Limit       : 4 requests/min (~15s between calls)`);
  console.log('----------------------------------------------------------------------\n');

  const onProgress = (ev) => {
    if (ev.type === 'rate_limit_wait') {
      console.log(`   ⏳ [Rate Limiter] Waiting ${(ev.waitMs / 1000).toFixed(1)}s to stay under quota...`);
    } else if (ev.type === 'quota_backoff') {
      console.warn(`   ⚠️ [429 Backoff] Rate limit received. Waiting ${(ev.waitMs / 1000).toFixed(1)}s (attempt ${ev.attempt}/${ev.maxRetries})...`);
    }
  };

  const harness = new ZaraEvaluationHarness({
    apiKey: apiKey || null,
    modelName,
    requestsPerMinute: 4,
    onProgress
  });

  if (isReal) {
    console.log(`[Pre-Flight] Probing model accessibility (${modelName})...`);
    try {
      const probe = await harness.verifyModelAccess();
      console.log(`✅ [Pre-Flight OK] Model "${probe.model}" responded: "${probe.response}"\n`);
    } catch (e) {
      console.error(`❌ [Pre-Flight FAILED] ${e.message}`);
      process.exit(1);
    }
  }

  const results = [];
  for (let i = 0; i < THREE_FRESH_SCENARIOS.length; i++) {
    const sc = THREE_FRESH_SCENARIOS[i];
    console.log(`\n[Scenario ${i + 1}/3] ${sc.id} (${sc.category})`);
    const res = await harness.runScenario(sc);
    results.push(res);

    console.log(`Result: ${res.passed ? '✅ PASSED' : '❌ FAILED'}`);
    if (res.reason.length > 0) {
      console.log(`Reason: ${res.reason.join('; ')}`);
    }
    console.log(`Latency: ${res.latencyMs}ms | Tokens: ${res.totalTokens} | Mode: ${res.executionMode}`);
    res.turns.forEach(t => {
      console.log(`  Turn ${t.turnIndex} Inbound : "${t.inbound}"`);
      if (t.toolCalls?.length > 0) {
        console.log(`         Tools   : ${t.toolCalls.map(tc => `${tc.name}(${JSON.stringify(tc.args)})`).join(', ')}`);
      }
      console.log(`         Outbound: "${t.outbound.slice(0, 100)}..."`);
    });

    if (res.isApiError) {
      console.error(`\n⛔ Stopped early due to API/quota error: ${res.apiError}`);
      break;
    }
  }

  const passed = results.filter(r => r.passed).length;
  console.log('\n======================================================================');
  console.log(`SUMMARY: ${passed}/${results.length} Fresh Scenarios Passed (${isReal ? 'REAL_GEMINI' : 'MOCK_PROTOCOL'})`);
  console.log('======================================================================\n');

  if (passed === THREE_FRESH_SCENARIOS.length) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
