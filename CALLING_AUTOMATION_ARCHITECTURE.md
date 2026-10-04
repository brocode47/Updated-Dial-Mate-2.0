# Dial Mate 2.0 — Calling Automation Architecture

## 1. Architectural Overview

Dial Mate 2.0 automates the complete Cash on Delivery (COD) order-confirmation lifecycle for Shopify merchants in Pakistan and emerging markets. The architecture couples deterministic event-driven orchestration with an autonomous multimodal voice agent ("Zara") powered by Google Gemini Live over Twilio WebSockets.

```mermaid
flowchart TD
    ShopifyOrder[Shopify Order Created] --> WebhookWorker[Webhook Worker: orders/create]
    WebhookWorker --> Eligibility{Order Eligibility Engine}
    Eligibility -- Ineligible --> Skipped[Tag: Ineligible & Log]
    Eligibility -- Outside Hours --> Deferred[Call Queue: Deferred until Opening]
    Eligibility -- Eligible --> Enqueue[Call Queue: initiate-call]
    Enqueue --> CallWorker[Call Worker]
    CallWorker --> WhitelistCheck{Test Whitelist Protection}
    WhitelistCheck -- Non-Whitelisted (Test Mode) --> DryRunSim[Dry-Run Simulation: dry_run_sid]
    WhitelistCheck -- Whitelisted (ADMIN_TEST_NUMBERS) --> TwilioOutbound[Twilio Outbound Carrier Call]
    TwilioOutbound --> StreamWS[Twilio Media Stream WebSocket]
    DryRunSim --> CallInterpretation[AI Call Interpretation Engine]
    StreamWS --> GeminiLive[Gemini Live Multimodal Agent: Zara]
    GeminiLive --> ToolCalls{Tool Execution}
    ToolCalls --> StateMachine[Order State Machine & DB/Shopify Sync]
    StreamWS --> StatusCallback[/twilio/status]
    StatusCallback --> CallWorkflowService[Call Workflow Service]
    CallWorkflowService --> RetryOrDone{Outcome Decision}
    RetryOrDone -- Confirmed --> ConfirmedOrder[Order Confirmed: COD_CONFIRMED]
    RetryOrDone -- Cancelled --> CancelledOrder[Order Cancelled: COD_CANCELLED]
    RetryOrDone -- Human Transfer --> HumanEscalate[Escalation: HUMAN_REVIEW_NEEDED]
    RetryOrDone -- Callback --> CallbackQueue[Callback Queue Job]
    RetryOrDone -- Unreachable (Attempts < Max) --> RetryQueue[Retry Queue Job]
    RetryOrDone -- Unreachable (Attempts >= Max) --> WAFallback[WhatsApp Fallback via WA-AKG]
```

---

## 2. End-to-End Automated Calling Workflow

The complete calling lifecycle consists of nine deterministic stages:

1. **Order Ingestion (`webhookWorker.js`)**:
   - Captures `orders/create` webhook with raw HMAC-SHA256 signature verification.
   - Extracts customer identity, Pakistani phone normalization (`+92...`), line items, and COD financial/gateway indicators.
   - Upserts order in PostgreSQL with initial `status: 'Pending Confirmation'`.

2. **Deterministic Eligibility Evaluation (`orderEligibilityService.js`)**:
   - Zero LLM delegation: pure deterministic checks.
   - Verifies merchant AI calling enablement, COD gateway, valid 10-15 digit phone, absence of cancellation, absence of prior confirmation, in-flight calling lock, value constraints, excluded merchant tags, and store operating hours.

3. **Call Queuing (`lib/queues.js`)**:
   - Enqueues `initiate-call` into BullMQ `callQueue` with deterministic deduplication key `call-init-${shopRecord.id}-${orderId}`.
   - If outside operating hours, automatically calculates millisecond delay until store opening window (`calculateDelayUntilNextOperatingWindow`) and queues deferred job.

4. **Job Processing (`callWorker.js`)**:
   - Re-checks terminal order state (`Confirmed`, `Cancelled`, `do_not_call`). If terminal, safely discards job.
   - Enforces in-flight concurrency lock (`callStatus === 'calling'`).
   - Resolves tenant isolation and invokes `CallWorkflowService.initiateCall`.

5. **Telephony & Whitelist Enforcement (`callWorkflowService.js`)**:
   - Emergency Stop switch check (`EMERGENCY_STOP=true` or merchant toggle).
   - Daily call limit enforcement (`DAILY_CALL_LIMIT`).
   - Whitelist enforcement: under `AI_CALL_MODE=test`, calls to numbers outside `ADMIN_TEST_NUMBERS` are simulated via safe dry-run (`dry_run_${uuid}`) without placing carrier calls. Calls to whitelisted numbers initiate real Twilio outbound calls.

6. **Conversational AI Session (`routes/twilio.js` & `agent.js`)**:
   - Twilio executes `<Connect><Stream>` to `/twilio/media`.
   - Bidirectional audio streaming between μ-law 8kHz and PCM16 24kHz using `AudioCodec`.
   - "Zara" speaks naturally in Roman Urdu, Urdu, and English, grounded in real line items, customer name, and order total.

7. **Structured AI Tool Execution (`dispatcher.js`)**:
   - Tools available: `get_order`, `get_customer`, `confirm_order`, `cancel_order`, `add_order_tag`, `schedule_callback`, `request_human_transfer`.
   - Tool calls execute securely inside verified tenant context with schema validation via Zod.

8. **AI Interpretation & State Transition (`aiCallInterpretationService.js` & `OrderStateMachine.js`)**:
   - Classifies customer decision into `CONFIRMED`, `CANCELLED`, `WRONG_NUMBER`, `DO_NOT_CALL`, `HUMAN_TRANSFER`, `CALL_BACK`, or unreachable (`NO_ANSWER`, `BUSY`, `FAILED`).
   - Contextual negation protection ensures customer saying "main cancel nahi karna chahta" is never wrongly cancelled.

9. **Side Effect Synchronization & Retries**:
   - Confirmed/Cancelled/Escalated orders update PostgreSQL and Shopify tags (`COD_CONFIRMED`, `COD_CANCELLED`, `HUMAN_REVIEW_NEEDED`).
   - Unreachable calls trigger controlled retries with exponential backoff up to `maxAttempts`.
   - When attempts are exhausted, triggers WhatsApp fallback via WA-AKG.

---

## 3. Order Eligibility Policy

| Rule | Evaluation Logic | Ineligible Outcome |
| :--- | :--- | :--- |
| **Merchant Feature Flag** | `shop.settings.aiCalling.enabled !== false` | `AI_CALLING_DISABLED_BY_MERCHANT` |
| **Payment Method** | Gateway contains COD terms or financial status `pending`/`authorized` | `NON_COD_ORDER` |
| **Phone Number** | Pakistani mobile (`03...` -> `+923...`) or international 10-15 digits | `INVALID_OR_MISSING_PHONE_NUMBER` |
| **Cancellation Check** | `order.status === 'Cancelled'` or payload `cancelled_at` | `ORDER_ALREADY_CANCELLED` |
| **Prior Confirmation** | `order.status === 'Confirmed'` or fulfillment `fulfilled` | `ORDER_ALREADY_CONFIRMED` |
| **In-Flight Lock** | `order.callStatus === 'calling' \|\| 'in-progress'` | `CALL_ALREADY_IN_PROGRESS` |
| **Maximum Attempts** | `order.retryCount >= shop.settings.aiCalling.maxAttempts` (default 3) | `MAX_CALL_ATTEMPTS_EXCEEDED` |
| **Customer Opt-Out** | Order or customer tags include `do_not_call`, `dnc`, `opt_out` | `CUSTOMER_DO_NOT_CALL` |
| **Excluded Tags** | Matches merchant configured excluded tags | `ORDER_HAS_EXCLUDED_TAG` |
| **Order Value Range** | Order total between `minOrderValue` and `maxOrderValue` | `ORDER_VALUE_BELOW_MINIMUM` / `EXCEEDS_MAXIMUM` |
| **Operating Hours** | Current store time within `callingHours` (e.g. `09:00 - 21:00`) | `OUTSIDE_OPERATING_HOURS` (Deferred) |

---

## 4. Call State Machine & Lifecycle

The order state transitions follow strict directed acyclic paths managed by `OrderStateMachine.js`:

```
PENDING ('Pending Confirmation')
   │
   ├──► IN_PROGRESS ('In Progress')
   │        │
   │        ├──► CONFIRMED ('Confirmed') ──► HUMAN_REQUIRED
   │        ├──► CANCELLED ('Cancelled') [TERMINAL]
   │        └──► HUMAN_REQUIRED ('Human Transfer')
   │
   ├──► CONFIRMED ('Confirmed')
   ├──► CANCELLED ('Cancelled')
   └──► HUMAN_REQUIRED ('Human Transfer')
            │
            ├──► CONFIRMED
            └──► CANCELLED
```

### Order `callStatus` Attribute Progression:
- `pending`: Newly ingested or scheduled for retry.
- `queued`: Successfully placed into BullMQ `callQueue`.
- `scheduled`: Deferred for store opening.
- `calling`: Active call in-flight with Twilio/carrier.
- `confirmed`: Customer gave unambiguous positive confirmation.
- `cancelled`: Customer requested cancellation or wrong number.
- `callback_requested`: Customer requested callback at a specific time.
- `human_transfer`: Escalated to human merchant team.
- `do_not_call`: Customer requested blacklist / opt-out.
- `failed`: Retries exhausted or unrecoverable carrier error.
- `ineligible`: Order disqualified by deterministic eligibility engine.

---

## 5. BullMQ Queue Architecture & Deduplication

Dial Mate uses Redis-backed BullMQ queues:
1. `callQueue`: Handles `initiate-call`, `retry-call`, and `callback` jobs.
2. `webhookQueue`: Processes Shopify incoming webhooks (`orders/create`, `orders/updated`, `orders/cancelled`).
3. `whatsappQueue`: Processes WhatsApp automated follow-ups via WA-AKG.

### Idempotency Keys:
- Initial call: `jobId: call-init-${shopId}-${orderId}`
- Retry call: `jobId: retry-${shopId}-${orderId}-${attempt}`
- Callback: `jobId: cb-${shopId}-${orderId}-${delayMinutes}m`

Duplicate submissions to BullMQ with the same `jobId` are discarded by Redis, guaranteeing zero duplicate outbound calls.

---

## 6. Deterministic Retry & Backoff Policy

When a call outcome is `NO_ANSWER`, `BUSY`, or transient telephony failure (`FAILED`):

$$\text{Next Attempt} = \text{retryCount} + 1$$

- If $\text{Next Attempt} < \text{maxAttempts}$:
  - Delay: $\text{retryDelayMinutes} \times 60 \times 1000 \text{ ms}$ (default 15 minutes).
  - Enqueue `retry-call` job with deterministic ID `retry-${shopId}-${orderId}-${nextAttempt}`.
  - Update order: `retryCount = nextAttempt`, `callStatus = 'pending'`.
- If $\text{Next Attempt} \ge \text{maxAttempts}$:
  - Retries exhausted.
  - Update order: `callStatus = 'failed'`, `tag = 'Max Call Retries Reached'`.
  - Trigger WhatsApp fallback if enabled (`WhatsAppFallbackService.sendFallback`).

---

## 7. Callback Scheduling System

When customer requests a callback ("main driving kar raha hoon, 1 ghante baad call karein"):
- AI detects callback request and parses natural language delay (e.g., "kal shaam" $\rightarrow$ 180 min, "tomorrow" $\rightarrow$ 1440 min, "ghanta" $\rightarrow$ 60 min).
- Enqueues BullMQ `callback` job with `delay: delayMinutes * 60 * 1000`.
- Deterministic deduplication key: `cb-${shopId}-${orderId}-${delayMinutes}m`.
- Order updated to `callStatus: 'callback_requested'`.
- When the callback job fires, `callWorker.js` verifies that the order has not been confirmed or cancelled in the interim.

---

## 8. Telephony Provider Architecture: Twilio

Twilio remains the sole and current voice telephony provider. No provider changes, no Telnyx, and no GSM/Android implementations are active in this phase.

### Outbound Call Initialization:
- Twilio REST API: `twilioClient.calls.create({ to, from, url: voiceUrl, statusCallback, statusCallbackEvent })`.
- Parameters passed via query string: `orderId`, `callId`, `customerName`, `productName`, `productPrice`, `orderNumber`.

### Audio Pipeline:
- Twilio Media Streams send 8,000 Hz μ-law audio packets over WebSockets.
- `AudioCodec` decodes μ-law $\rightarrow$ Linear PCM16 and resamples $8\text{ kHz} \rightarrow 24\text{ kHz}$ for Gemini Live.
- Agent response audio is downsampled $24\text{ kHz} \rightarrow 8\text{ kHz}$ and encoded to μ-law before being streamed back to Twilio.

---

## 9. Failure Recovery & System Resilience

- **Twilio Carrier Outage**: Caught and logged; Call record updated to `outcome: 'Failed'`, Order `callStatus: 'failed'`. The server does not crash.
- **Gemini Live Stream Interruption**: If the Gemini WebSocket disconnects prematurely, `ws.on('close')` captures the accumulated conversation transcript and persists it to PostgreSQL.
- **Shopify API 5xx Failure**: `OrderStateMachine` catches Shopify tag errors, logs warning, and completes PostgreSQL state transition to prevent stranded DB states.
- **Worker Crash / Server Restart**: BullMQ stores active jobs in Redis. Upon restart, unacknowledged jobs are retried according to backoff rules.
- **Terminal State Lock**: Workers check order terminal status prior to dialing, preventing calls on already confirmed/cancelled orders.

---

## 10. Production Safety & Whitelist Enforcement

During this phase, full production calling to real Shopify customers remains **strictly disabled**:
- `AI_CALL_MODE=test` is enforced by default.
- `ADMIN_TEST_NUMBERS` defines the explicit comma-separated list of safe destination numbers.
- Any outbound call targeting a number not in `ADMIN_TEST_NUMBERS` is safely diverted to an in-memory simulation (`dry_run_${uuid}`), generating complete database records, audit logs, and simulated webhook responses without contacting external cellular carriers.
- Emergency stop switch (`EMERGENCY_STOP=true` or merchant settings) provides an instantaneous kill-switch for all outbound telephony.

---

## 11. Future Android / GSM Gateway Migration Path

In future phases, Dial Mate may optionally support local Pakistani SIM / GSM gateways (via Android telephony services or SIP trunking) to reduce international calling costs. The current architecture was intentionally decoupled:
- `CallWorkflowService` abstracts provider interaction through clean boundaries (`initiateCall`, `handleCallResult`).
- All business logic, eligibility checks, state transitions, and AI interpretation remain provider-agnostic.
- When an Android/GSM gateway is introduced in a future phase, it can implement the same `providerCallSid` contract without modifying the BullMQ queue, state machine, or Gemini Live conversational engine.
