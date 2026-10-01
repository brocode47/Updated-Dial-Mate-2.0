# Phase 6: Real AI Calling Pipeline Audit Report
**Dial Mate 2.0 — AI Commerce Assistant**  
**Date:** October 2026  
**Target Domain:** `0qwck2-s1.myshopify.com` / `api.sundaybazaaar.com`

---

## 1. Executive Summary

This audit assesses the end-to-end readiness of Dial Mate 2.0 to transition from **Safe Dry-Run Calling** (`DRY_RUN_CALLS=true`) to **Controlled Real AI Telephony** (`AI_CALL_MODE=test|production`). The platform's voice architecture pairs **Twilio Voice Media Streams** with **Gemini Live 2.0 Multimodal AI** for real-time bidirectional audio streaming in Roman Urdu and English.

---

## 2. Component-by-Component Review

### 2.1 `orderEligibilityService.js` (Deterministic Pre-Call Gate)
- **Current Responsibilities**:
  - Validates merchant feature flag (`aiCalling.enabled`).
  - Enforces Cash-on-Delivery (COD) exclusivity (skipping online prepaid orders).
  - Sanitizes and validates E.164 phone format (+92 for Pakistan).
  - Verifies cancellation/confirmation state (prevents duplicate calls).
  - Enforces order value range (`minOrderValue` - `maxOrderValue`).
  - Checks excluded Shopify tags (`VIP`, `PREPAID`, `NO_CALL`).
  - Evaluates business calling hours window (Default: 09:00 - 21:00 PKT).
- **Audit Findings**:
  - ✅ **Strong**: Pure deterministic code; zero LLM hallucination risk.
  - ⚠️ **Gap**: Lacks an **Emergency Kill Switch** check (`EMERGENCY_STOP=true` or shop-level emergency pause).
  - ⚠️ **Gap**: Lacks a **Daily Call Quota counter** to prevent runaway billing in case of webhook storm.

### 2.2 `webhookWorker.js` (BullMQ Webhook Consumer)
- **Current Responsibilities**:
  - Ingests `orders/create`, `orders/updated`, and `orders/cancelled`.
  - Computes algorithmic risk score via `computeRiskScore`.
  - Resolves or creates `Customer` database row.
  - Upserts `Order` row in PostgreSQL.
  - Enqueues eligible orders into `callQueue` (`initiate-call`) with deterministic deduplication key `call-init-${shopId}-${orderId}`.
- **Audit Findings**:
  - ✅ **Strong**: BullMQ job deduplication prevents duplicate calls for the same order webhook.
  - ✅ **Strong**: Immediate handling of `orders/cancelled` cancels in-flight and queued attempts.

### 2.3 `callWorker.js` (BullMQ Dialer Consumer)
- **Current Responsibilities**:
  - Processes `initiate-call`, `retry-call`, and `callback` jobs.
  - Resolves shop tenant domain and calls `CallWorkflowService.initiateCall()`.
- **Audit Findings**:
  - ✅ **Strong**: Decoupled from HTTP request cycle; resilient against process restarts.

### 2.4 `callWorkflowService.js` (Telephony Orchestrator)
- **Current Responsibilities**:
  - Initiates Twilio outbound calls or dry-run simulation based on `process.env.DRY_RUN_CALLS`.
  - Creates `Call` record (`outcome: 'Created'`).
  - Sets `order.callStatus = 'calling'`.
  - Dispatches Twilio call to `/twilio/voice` webhook with custom query parameters.
  - Handles call completion (`handleCallResult`): DTMF interpretation, retries schedule, and WhatsApp fallback trigger.
- **Audit Findings**:
  - ⚠️ **Gap**: Binary `DRY_RUN_CALLS=true` does not allow **staged rollout** or **admin-only testing**.
  - ⚠️ **Gap**: Needs an `AI_CALL_MODE` system (`test` vs `production`) with an **Admin Whitelist** (`ADMIN_TEST_NUMBERS`). In `test` mode, calls to unapproved numbers must be safely diverted to dry-run simulation.

### 2.5 `twilio.js` (`routes/twilio.js` & `calls/twilio.js`)
- **Current Responsibilities**:
  - `/twilio/voice`: Generates TwiML `<Connect><Stream url="wss://.../twilio/media">` passing HMAC-authenticated session tokens.
  - `/twilio/media` (WebSocket): Bidirectional media bridge. Transcodes audio between Twilio `8kHz μ-law` and Gemini `16kHz PCM16` via `AudioCodec`.
  - `/twilio/status`: Twilio status callback handler tracking call duration, call status, and recording URL.
  - `/twilio/gather`: DTMF keypad fallback handler (1 = Confirm, 2 = Cancel).
- **Audit Findings**:
  - ✅ **Strong**: WebSocket authentication uses SHA256 HMAC tokens preventing stream hijacking.
  - ✅ **Strong**: Fallback to DTMF IVR if Gemini Live audio stream disconnects.
  - ⚠️ **Gap**: Script prompt needs a structured 5-step conversational protocol tailored for Pakistani COD commerce.

### 2.6 `aiCallInterpretationService.js` (Decision & Intent Engine)
- **Current Responsibilities**:
  - Classifies customer responses into: `CONFIRMED`, `CANCELLED`, `CALLBACK_REQUESTED`, `NO_ANSWER`, `BUSY`, `FAILED`, `UNKNOWN`.
  - Uses regex and keyword pattern matching for Roman Urdu, pure Urdu script, and English.
- **Audit Findings**:
  - ✅ **Strong**: Zero-latency deterministic classifier with confidence scoring.
  - ⚠️ **Gap**: Needs support for `WRONG_NUMBER` intent (customer stating "Ghalat number hai / I didn't order this").
  - ⚠️ **Gap**: Needs structured summary and `customerEmotion` extraction (`Neutral`, `Positive`, `Frustrated`, `Hesitant`).

---

## 3. Failure Points & Risk Analysis

| # | Risk / Failure Point | Probability | Impact | Mitigation Strategy |
|---|---|---|---|---|
| 1 | **Accidental Mass Calling** to live customers during staging/testing | Medium | Critical | Implement `AI_CALL_MODE=test` with strict `ADMIN_TEST_NUMBERS` whitelist. Non-whitelisted calls simulate dry-run. |
| 2 | **Carrier Balance Drain / Runaway Loop** caused by Shopify webhook storm | Low | High | Implement `DAILY_CALL_LIMIT` (e.g. 50 calls/day default per shop) and `EMERGENCY_STOP` switch. |
| 3 | **Unsocial Hour Dialing** (calls placed at 2 AM PKT) | Low | High | Enforce `isWithinOperatingHours` (09:00 - 21:00 PKT) in `OrderEligibilityService`. |
| 4 | **Gemini Live Stream Interruption / Latency Spikes** | Medium | Medium | Maintain TwiML `<Gather>` DTMF fallback (Key 1 to confirm, Key 2 to cancel). |
| 5 | **Repeatedly Calling Dead / Unreachable Numbers** | High | Low | Exponential retry delay (15m, 30m, 60m) capped at `maxAttempts` (3), followed by auto-switch to WhatsApp fallback. |

---

## 4. Required Environment Variables for Production AI Calling

```env
# Telephony Mode Configuration
AI_CALL_MODE=test                    # "test" (whitelist only) or "production" (live customer calling)
ADMIN_TEST_NUMBERS=+923001234567     # Comma-separated E.164 phone numbers allowed in test mode
EMERGENCY_STOP=false                 # Global emergency kill switch (immediately pauses all outbound calls)
DAILY_CALL_LIMIT=100                 # Maximum allowed calls per store per rolling 24 hours

# Twilio Trunk Credentials
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxx # Live Twilio Account SID
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxx  # Live Twilio Auth Token
TWILIO_FROM_NUMBER=+1xxxxxxxxxx      # Twilio Verified Outbound Caller ID Phone Number

# Gemini Conversational AI
GEMINI_API_KEY=AIzaxxxxxxxxxxxxxxxx  # Google AI Studio API Key for Gemini Live bidirectional voice
APP_URL=https://api.sundaybazaaar.com # Public HTTPS URL for Twilio webhook resolution
```

---

## 5. Phase 6 Implementation Plan

1. **Step 2: Twilio Production Mode with Whitelist Protection**
   - Refactor `callWorkflowService.js` to inspect `AI_CALL_MODE` and `ADMIN_TEST_NUMBERS`.
   - In `test` mode: dial real carrier ONLY if `phone` is in `ADMIN_TEST_NUMBERS`; otherwise safely execute dry-run simulation.
2. **Step 3: Configurable AI Call Script Engine**
   - Standardize the 5-step Urdu dialogue flow: Greeting & Identity &rarr; Order & Items &rarr; Total Amount &rarr; Delivery Confirmation &rarr; Professional Goodbye.
3. **Step 4: AI Conversation Intelligence Upgrade**
   - Extend `AICallInterpretationService.js` with `WRONG_NUMBER` intent, emotion detection, and structured summary formatting.
4. **Step 5: End-to-End Real Phone Test**
   - Run verified live call test to whitelisted phone number, logging call SID, audio, transcript, and database updates.
5. **Step 6: Safety Controls & Emergency Stop Switch**
   - Add daily call counter, operating hours hardening, and global `EMERGENCY_STOP` trigger.
6. **Step 7: Final Phase 6 Report**
   - Complete production verification report and readiness checklist.
