/**
 * ============================================================================
 * SAFE STANDALONE RUNNER FOR ZARA 31-SCENARIO GEMINI EVALUATION (PHASE 13)
 * ============================================================================
 *
 * Safety and reliability features:
 * 1. Zero Side-Effect Isolation: IS_EVAL_HARNESS='true' & NODE_ENV='test'.
 *    Prevents Redis, BullMQ, Prisma, Shopify, and WhatsApp initialization.
 * 2. Conservative Throttling: Enforces 4 requests/minute default to safely operate
 *    within free-tier quota limits (configurable via EVAL_REQUESTS_PER_MINUTE).
 * 3. 429 & Quota Protection: Exponential backoff with jitter and retryDelay parsing
 *    for temporary limits; stops cleanly if daily quota exhausted.
 * 4. Local Checkpoint & Resume: Saves completed scenarios to .eval_checkpoint.json
 *    and resumes without repeating passed scenarios or leaking credentials/PII.
 * 5. Single Multi-Turn Canary Check: Verifies tool execution and response before
 *    launching full evaluation suite.
 */

process.env.IS_EVAL_HARNESS = 'true';
process.env.NODE_ENV = 'test';

async function main() {
  const { ZaraEvaluationHarness, HELD_OUT_SCENARIOS } = await import('../src/evaluation/zaraEvaluationHarness.js');
  const rawKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY || process.env.GOOGLE_API_KEY || '';
  const apiKey = rawKey.trim();
  const modelName = process.env.EVAL_GEMINI_MODEL || 'gemini-3.8-flash';
  const allowMock = process.argv.includes('--mock') || process.env.ALLOW_MOCK_EVAL === 'true';
  const rpm = parseInt(process.env.EVAL_REQUESTS_PER_MINUTE || '4', 10);

  console.log('\n======================================================================');
  console.log('DIAL MATE 2.0 — ZARA AI OBJECTIVE EVALUATION (PHASE 13: RATE-THROTTLED)');
  console.log('======================================================================');

  if (!apiKey && !allowMock) {
    console.error('\n❌ BLOCKED: No GEMINI_API_KEY detected in current process environment.\n');
    console.error('To run the real Gemini evaluation:');
    console.error('  $env:GEMINI_API_KEY = "your-authorized-api-key"');
    console.error('  npm.cmd run eval:gemini\n');
    console.error('Or run the deterministic mock harness:');
    console.error('  npm.cmd run eval:mock\n');
    process.exit(1);
  }

  const isReal = Boolean(apiKey);
  const maskedKey = isReal ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` : 'NONE';

  console.log(`Execution Mode   : ${isReal ? 'REAL_GEMINI (Live Model Evaluation)' : 'MOCK_PROTOCOL (Deterministic Mock)'}`);
  console.log(`Model Target     : ${isReal ? modelName : 'MockGenAIAdapter'}`);
  console.log(`Request Limit    : ${rpm} requests/minute (min interval ~${Math.ceil(60/rpm)}s)`);
  console.log(`Credential Status: ${isReal ? `Configured (${maskedKey})` : 'Not supplied (Mock mode)'}`);
  console.log(`Isolation Level  : 100% In-Memory Fixtures (Zero Redis, BullMQ, Prisma, Shopify, WhatsApp)`);
  console.log('----------------------------------------------------------------------\n');

  const onProgress = (event) => {
    if (event.type === 'rate_limit_wait') {
      const sec = (event.waitMs / 1000).toFixed(1);
      console.log(`   ⏳ [Rate Limiter] Pausing ${sec}s to stay under ${rpm} requests/min limit...`);
    } else if (event.type === 'quota_backoff') {
      const sec = (event.waitMs / 1000).toFixed(1);
      console.warn(`   ⚠️ [429 Backoff] Rate limit received. Waiting ${sec}s before retry ${event.attempt}/${event.maxRetries}...`);
    } else if (event.type === 'scenario_resumed') {
      console.log(`   ⏩ [Resumed from Checkpoint] Scenario ${event.scenarioId} (Passed: ${event.passed})`);
    } else if (event.type === 'quota_interrupted') {
      console.warn(`   ⛔ [Quota Exceeded] Execution paused on ${event.scenarioId}. Details: ${event.error}`);
    }
  };

  const harness = new ZaraEvaluationHarness({
    apiKey: apiKey || null,
    modelName,
    requestsPerMinute: rpm,
    onProgress
  });

  // -------------------------------------------------------------------------
  // STEP 1: Pre-Flight Connectivity Probe (Single Inexpensive Request)
  // -------------------------------------------------------------------------
  if (isReal) {
    console.log(`[Step 1/3] Probing model availability (${modelName})...`);
    try {
      const probeRes = await harness.verifyModelAccess();
      console.log(`✅ [Pre-Flight] Model "${probeRes.model}" accessible! Response: "${probeRes.response}"\n`);
    } catch (probeErr) {
      console.error(`\n❌ [Pre-Flight FAILED] Model "${modelName}" returned error:`);
      console.error(`   ${probeErr.message}\n`);
      console.error('Execution halted to protect quota and prevent unnecessary requests.');
      process.exit(1);
    }

    // -------------------------------------------------------------------------
    // STEP 2: Canary Multi-Turn Product Conversation
    // -------------------------------------------------------------------------
    console.log(`[Step 2/3] Verifying multi-turn product conversation & tool loop...`);
    const canaryScenario = HELD_OUT_SCENARIOS.find(s => s.id === 'SCENARIO_07_MULTI_TURN_PRODUCT_PRONOUN') || HELD_OUT_SCENARIOS[0];
    const canaryRes = await harness.runScenario(canaryScenario);

    if (!canaryRes.passed) {
      console.error(`\n❌ [Canary Turn FAILED] Scenario ${canaryRes.scenarioId} did not pass:`);
      canaryRes.reason.forEach(r => console.error(`   - ${r}`));
      if (canaryRes.isApiError) {
        console.error(`   API Error Details: ${canaryRes.apiError}`);
      }
      console.error('\nStopping before running full suite.');
      process.exit(1);
    }

    console.log(`✅ [Canary Turn] Tool executed and resolved successfully across ${canaryRes.turns.length} turns!`);
    canaryRes.turns.forEach(t => {
      console.log(`   Turn ${t.turnIndex}: User -> "${t.inbound}"`);
      if (t.toolCalls?.length > 0) {
        console.log(`           Tool -> ${t.toolCalls.map(tc => tc.name).join(', ')}`);
      }
      console.log(`           Zara -> "${t.outbound?.slice(0, 80)}..."`);
    });
    console.log('');
  }

  // -------------------------------------------------------------------------
  // STEP 3: Complete 31-Scenario Evaluation Suite (Resumable)
  // -------------------------------------------------------------------------
  console.log(`[Step 3/3] Executing 31-scenario evaluation scorecard (resumable)...`);
  const startTime = Date.now();
  const report = await harness.runSuite({ resume: true });
  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);

  const apiErrors = report.results.filter(r => r.isApiError);
  const conversationalFailures = report.results.filter(r => !r.passed && !r.isApiError);

  console.log('\n======================================================================');
  console.log('OBJECTIVE EVALUATION SCORECARD');
  console.log('======================================================================');
  console.log(`Evaluation Mode         : ${report.evaluationMode}`);
  console.log(`Model Tested            : ${report.modelTested}`);
  console.log(`API Requests Allowed/Min: ${report.metrics.requestsAllowedPerMinute} rpm`);
  console.log(`API Requests Consumed   : ${report.metrics.requestsConsumed}`);
  console.log(`Execution Time          : ${durationSec}s`);
  console.log(`Total Scenarios         : ${report.metrics.totalScenarios}`);
  console.log(`Completed Scenarios     : ${report.metrics.completedScenarios}`);
  console.log(`Passed Scenarios        : ${report.metrics.passedScenarios}`);
  console.log(`Behavioral Failures     : ${report.metrics.behavioralFailures}`);
  console.log(`API / Quota Errors      : ${report.metrics.apiFailures}`);
  console.log(`Pass Rate (Completed)   : ${report.metrics.passRatePercent}%`);
  console.log(`Quota Interrupted       : ${report.quotaInterrupted ? 'YES (paused cleanly)' : 'NO'}`);
  console.log(`Checkpoint Saved To     : ${report.checkpointFile}`);
  console.log('----------------------------------------------------------------------');

  if (apiErrors.length > 0) {
    console.log(`\n⚠️ MODEL / API TRANSPORT ERRORS (${apiErrors.length}):`);
    apiErrors.forEach(r => {
      console.log(`• [${r.scenarioId}] (${r.category}):`);
      console.log(`    - Error: ${r.apiError || 'Model error'}`);
    });
  }

  if (conversationalFailures.length > 0) {
    console.log(`\n⚠️ GENUINE CONVERSATIONAL FAILURES (${conversationalFailures.length}):`);
    conversationalFailures.forEach(r => {
      console.log(`• [${r.scenarioId}] (${r.category}):`);
      r.reason.forEach(msg => console.log(`    - ${msg}`));
    });
  }

  if (report.quotaInterrupted) {
    console.log('\n⛔ Evaluation paused due to provider rate limit/quota.');
    console.log('Completed scenarios have been safely saved. Run `npm.cmd run eval:gemini` to resume.\n');
    process.exit(0);
  } else if (report.metrics.behavioralFailures > 0) {
    console.log('\n----------------------------------------------------------------------\n');
    process.exit(1);
  } else {
    console.log(`\n🎉 All ${report.metrics.completedScenarios} completed scenarios PASSED successfully under ${report.evaluationMode}!\n`);
    process.exit(0);
  }
}

main().catch(err => {
  console.error('\nFatal execution error:', err.message);
  process.exit(1);
});
