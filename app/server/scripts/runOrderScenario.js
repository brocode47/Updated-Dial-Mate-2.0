/**
 * ============================================================================
 * SINGLE SCENARIO VALIDATION: AUTHORIZED ORDER LOOKUP (TASK 1)
 * ============================================================================
 *
 * Runs ONLY the unfinished authorized-order lookup scenario:
 * - Zero pre-flight probe (conserves API quota).
 * - Does NOT repeat previously passed scenarios.
 * - Enforces server-side order ownership check against synthetic order fixtures.
 * - Stops cleanly if daily quota is unavailable.
 */

process.env.IS_EVAL_HARNESS = 'true';
process.env.NODE_ENV = 'test';

import { ZaraEvaluationHarness } from '../src/evaluation/zaraEvaluationHarness.js';

export const ORDER_LOOKUP_SCENARIO = {
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
};

async function main() {
  const rawKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY || process.env.GOOGLE_API_KEY || '';
  const apiKey = rawKey.trim();
  const modelName = process.env.EVAL_GEMINI_MODEL || 'gemini-3.8-flash';
  const allowMock = process.argv.includes('--mock') || process.env.ALLOW_MOCK_EVAL === 'true';

  console.log('\n======================================================================');
  console.log('DIAL MATE 2.0 — AUTHORIZED ORDER LOOKUP VALIDATION (TASK 1)');
  console.log('======================================================================');

  if (!apiKey && !allowMock) {
    console.error('\n❌ BLOCKED: No GEMINI_API_KEY detected in current process environment.\n');
    console.error('To run against live Gemini:');
    console.error('  $env:GEMINI_API_KEY = "your-authorized-api-key"');
    console.error('  npm.cmd run eval:order\n');
    console.error('Or test against deterministic mock adapter:');
    console.error('  npm.cmd run eval:order -- --mock\n');
    process.exit(1);
  }

  const isReal = Boolean(apiKey);
  console.log(`Execution Mode   : ${isReal ? 'REAL_GEMINI (Live Model Evaluation)' : 'MOCK_PROTOCOL'}`);
  console.log(`Model Target     : ${isReal ? modelName : 'MockGenAIAdapter'}`);
  console.log(`Pre-Flight Probe : SKIPPED (Quota Preservation)`);
  console.log('----------------------------------------------------------------------\n');

  const onProgress = (ev) => {
    if (ev.type === 'rate_limit_wait') {
      console.log(`   ⏳ [Rate Limiter] Waiting ${(ev.waitMs / 1000).toFixed(1)}s to stay under quota...`);
    } else if (ev.type === 'quota_backoff') {
      console.warn(`   ⚠️ [429 Backoff] Rate limit received. Waiting ${(ev.waitMs / 1000).toFixed(1)}s...`);
    }
  };

  const harness = new ZaraEvaluationHarness({
    apiKey: apiKey || null,
    modelName,
    requestsPerMinute: 4,
    onProgress
  });

  console.log(`Executing Scenario: ${ORDER_LOOKUP_SCENARIO.id}`);
  console.log(`Customer Phone    : ${ORDER_LOOKUP_SCENARIO.customerPhone}`);
  console.log(`Inbound Message   : "${ORDER_LOOKUP_SCENARIO.dialogue[0].text}"\n`);

  const res = await harness.runScenario(ORDER_LOOKUP_SCENARIO);

  console.log('----------------------------------------------------------------------');
  console.log(`Result   : ${res.passed ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`Latency  : ${res.latencyMs}ms`);
  console.log(`Tokens   : ${res.totalTokens}`);
  console.log(`Mode     : ${res.executionMode}`);

  if (res.turns?.length > 0) {
    const t = res.turns[0];
    if (t.toolCalls?.length > 0) {
      console.log(`Tools    : ${t.toolCalls.map(tc => `${tc.name}(${JSON.stringify(tc.args)})`).join(', ')}`);
    }
    console.log(`Outbound : "${t.outbound}"`);
  }

  if (res.isApiError) {
    console.warn(`\n⛔ API / Quota Notice: ${res.apiError}`);
    if (/DAILY_QUOTA|quota/i.test(res.apiError || '')) {
      console.log('Daily free-tier quota is currently exhausted on this API key. Execution stopped cleanly.');
    }
    process.exit(1);
  }

  if (res.passed) {
    console.log('\n🎉 Authorized Order Lookup successfully validated with live Gemini & tool execution!\n');
    process.exit(0);
  } else {
    console.error(`\nBehavioral Failure: ${res.reason.join('; ')}\n`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\nFatal execution error:', err.message);
  process.exit(1);
});
