/**
 * ============================================================================
 * SAFE STANDALONE RUNNER FOR ZARA 31-SCENARIO GEMINI EVALUATION
 * ============================================================================
 *
 * Runs the complete 31-scenario evaluation harness locally on Windows without
 * requiring SSH, Docker, Redis, PostgreSQL, Shopify, or WhatsApp connectivity.
 *
 * Guarantees:
 * 1. Process-level environment security: Never hardcodes, logs, or leaks credentials.
 * 2. 100% In-Memory Synthetic Fixtures: Zero production database or customer mutations.
 * 3. Strict Verification: Differentiates REAL_GEMINI vs MOCK_PROTOCOL. Never reports
 *    mock mode as real testing.
 */

import { ZaraEvaluationHarness } from '../src/evaluation/zaraEvaluationHarness.js';

async function main() {
  const rawKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY || process.env.GOOGLE_API_KEY || '';
  const apiKey = rawKey.trim();
  const modelName = process.env.EVAL_GEMINI_MODEL || 'gemini-2.5-flash';
  const allowMock = process.argv.includes('--mock') || process.env.ALLOW_MOCK_EVAL === 'true';

  console.log('\n======================================================================');
  console.log('DIAL MATE 2.0 — ZARA AI EVALUATION RUNNER (31 MULTI-TURN SCENARIOS)');
  console.log('======================================================================');

  if (!apiKey && !allowMock) {
    console.error('\n❌ BLOCKED: No Gemini API Key detected in process environment.\n');
    console.error('To run the real Gemini evaluation safely, provide your API key in PowerShell:');
    console.error('  $env:GEMINI_API_KEY = "your-gemini-api-key"');
    console.error('  npm run eval:gemini\n');
    console.error('Or test the deterministic mock harness using:');
    console.error('  npm run eval:mock\n');
    process.exit(1);
  }

  const isReal = Boolean(apiKey);
  const maskedKey = isReal ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` : 'NONE';

  console.log(`Execution Mode   : ${isReal ? 'REAL_GEMINI (Live Model Evaluation)' : 'MOCK_PROTOCOL (Deterministic Mock)'}`);
  console.log(`Model Target     : ${isReal ? modelName : 'MockGenAIAdapter'}`);
  console.log(`Credential Status: ${isReal ? `Configured (${maskedKey})` : 'Not supplied (Mock mode)'}`);
  console.log(`Isolation Level  : 100% In-Memory Fixtures (Zero DB, Redis, Shopify, or WhatsApp calls)`);
  console.log('----------------------------------------------------------------------\n');

  console.log(`Executing 31 scenarios across 10 conversational categories...`);
  const startTime = Date.now();

  const harness = new ZaraEvaluationHarness({
    apiKey: apiKey || null,
    modelName
  });

  const report = await harness.runSuite();
  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n======================================================================');
  console.log('OBJECTIVE EVALUATION SCORECARD');
  console.log('======================================================================');
  console.log(`Evaluation Mode  : ${report.evaluationMode}`);
  console.log(`Model Tested     : ${report.modelTested}`);
  console.log(`Execution Time   : ${durationSec}s`);
  console.log(`Total Scenarios  : ${report.metrics.totalScenarios}`);
  console.log(`Passed Scenarios : ${report.metrics.passedScenarios}`);
  console.log(`Failed Scenarios : ${report.metrics.failedScenarios}`);
  console.log(`Pass Rate        : ${report.metrics.passRatePercent}%`);
  console.log(`Average Latency  : ${report.metrics.averageLatencyMs}ms`);
  console.log(`Total Tokens Used: ${report.metrics.totalTokensUsed}`);
  console.log('----------------------------------------------------------------------');

  if (report.metrics.failedScenarios > 0) {
    console.log('\nFAILED SCENARIOS BREAKDOWN:');
    report.results.filter(r => !r.passed).forEach(r => {
      console.log(`• [${r.scenarioId}] (${r.category}):`);
      r.reason.forEach(msg => console.log(`    - ${msg}`));
    });
    console.log('----------------------------------------------------------------------\n');
    process.exit(1);
  } else {
    console.log(`\n🎉 All ${report.metrics.totalScenarios} scenarios PASSED successfully under ${report.evaluationMode}!\n`);
    process.exit(0);
  }
}

main().catch(err => {
  console.error('\nFatal execution error:', err.message);
  process.exit(1);
});
