# Deployment Difference Report: 2ba8c6f vs 483b405

**Repository:** `https://github.com/brocode47/Updated-Dial-Mate-2.0`  
**Base (Production Verified):** `2ba8c6f`  
**Target (Current HEAD):** `483b405`  
**Date:** 2026-10-01  

---

## 1. Overview

This report provides the detailed technical diff between the currently running production commit (`2ba8c6f`) and the Phase 4 automated COD platform commit (`483b405`).

Total Files Changed: **17**  
Additions: **3,391 lines**  
Deletions: **384 lines**  

---

## 2. Backend Files Changed

### A. New Services Created
1. `app/server/src/services/orderEligibilityService.js` (422 lines)
   - **Purpose:** Pure deterministic business rules engine. Evaluates whether a Shopify order should receive an automated confirmation call.
   - **Key Rules:** Merchant AI calling enabled, Cash on Delivery payment gateway detection, phone normalization (`cleanPhoneNumber` with `+92` E.164 formatting), unfulfilled/open status, in-flight call locking, retry limit threshold, order value min/max boundaries, excluded tags, and store operating hours window.

2. `app/server/src/services/callWorkflowService.js` (419 lines)
   - **Purpose:** End-to-end telephony orchestration and lifecycle manager.
   - **Key Functions:**
     - `initiateCall({ orderId, shopDomain, force })`: Validates eligibility, creates `Call` record in database, initiates Twilio outbound call (or runs in dry-run mode if unconfigured), updates `Order.callStatus = 'calling'`.
     - `handleCallResult({ orderId, shopDomain, callId, digits, transcript, callStatus, durationSec, recordingUrl })`: Interprets call outcome via `AICallInterpretationService`, executes state transitions, schedules automated retries, and triggers WhatsApp fallback when retries are exhausted.

3. `app/server/src/services/aiCallInterpretationService.js` (245 lines)
   - **Purpose:** Multi-modal call interpretation (DTMF digits, dialogue transcript, speech text, Twilio carrier status).
   - **Key Functions:** Zero-latency deterministic pattern classification supporting Urdu, Roman Urdu, and English utterances.

4. `app/server/src/services/whatsappFallbackService.js` (249 lines)
   - **Purpose:** Automated WhatsApp follow-up via existing WA-AKG Baileys gateway when phone calls are unanswered.
   - **Key Functions:** Formats localized confirmation templates (Urdu, Roman Urdu, English), routes via multi-tenant session ID, creates dashboard inbox messages.

### B. Modified Routes & APIs
1. `app/server/src/routes/api.js` (+349 lines, -107 lines)
   - Added `GET /api/dashboard/stats` real-time COD KPIs (today's orders, calls, confirmed, cancelled, success rate, avg duration).
   - Added `GET /api/analytics/cod` dedicated COD conversion metrics.
   - Enhanced `POST /api/orders/:orderId/call` manual trigger with rate limiting and `CallWorkflowService.initiateCall`.
   - Added `GET /api/shop/settings` & `PUT /api/shop/settings` for merchant operating hours, retry limits, and COD rules.

2. `app/server/src/routes/twilio.js` (+107 lines, -45 lines)
   - Enhanced `/twilio/voice` and WebSocket `/twilio/media` media streaming.
   - Added `/twilio/gather` DTMF keypad processing with `CallWorkflowService.handleCallResult`.
   - Updated `/twilio/status` callback to record duration, recording URLs, and trigger retry/fallback.

3. `app/server/src/routes/webhooks.js` (+99 lines, -40 lines)
   - Added registration and handling for `orders/cancelled`.
   - Forwarded `/webhooks/call-status` and `/webhooks/gather` to `CallWorkflowService`.

4. `app/server/src/services/OrderStateMachine.js` (+9 lines)
   - Added state transition hooks for Shopify tag synchronization (`COD_CONFIRMED`, `COD_CANCELLED`, `HUMAN_REVIEW_NEEDED`).

---

## 3. Worker Changes

1. `app/server/src/workers/callWorker.js` (+53 lines, -15 lines)
   - Replaced legacy `triggerCall` with `CallWorkflowService.initiateCall`.
   - Added support for `initiate-call`, `retry-call`, and `callback` jobs with deterministic idempotency keys (`call-init-${shopId}-${orderId}`).

2. `app/server/src/workers/webhookWorker.js` (+217 lines, -45 lines)
   - Integrated `OrderEligibilityService.checkOrderEligibility`.
   - If eligible: updates order to `callStatus: 'queued'`, enqueues job to BullMQ `callQueue`.
   - If ineligible: marks order `callStatus: 'ineligible'`, records compliance log with specific skip reason.
   - Handles `orders/updated` and `orders/cancelled`.

---

## 4. Frontend Files Changed

1. `app/src/pages/DashboardPage.jsx` (+238 lines, -42 lines)
   - Pure real database metrics: orders waiting confirmation, calls today, confirmed orders, cancelled orders, COD success rate, failure rate. 0 mock data.
   - Quick action to trigger manual confirmation call with real-time spinner.

2. `app/src/pages/OrdersPage.jsx` (+136 lines, -35 lines)
   - Order grid with eligibility badges, call status (`queued`, `calling`, `confirmed`, `failed`, `ineligible`), and manual "Call Now" button.

3. `app/src/pages/CallsPage.jsx` (+66 lines, -28 lines)
   - Real call logs with duration, provider CallSid, customer name, recording links, and outcome tags.

4. `app/src/pages/AnalyticsPage.jsx` (+107 lines, -30 lines)
   - COD conversion analytics, agent performance breakdown, intent distribution.

5. `app/src/pages/SettingsPage.jsx` (+285 lines, -45 lines)
   - Controls for AI Calling toggle, operating hours window (e.g. 09:00 - 21:00), max call attempts, retry delay, COD-only rule, and WhatsApp fallback toggle.

---

## 5. Database Changes & Migrations

- **Database Migrations Required:** **NONE** (0 migrations required).
- **Prisma Schema:** `app/server/prisma/schema.prisma` is completely unchanged.
- All needed columns (`Order.callStatus`, `Order.callSid`, `Order.lastCallAt`, `Order.retryCount`, `Order.totalAmount`, `Call.outcome`, `Call.intent`, `Call.sentiment`, `Call.durationSec`, `Call.recordingUrl`, `Call.transcript`, `Call.providerCallSid`) already exist in the database from earlier phases.
- Zero risk of schema collision or data loss during deployment.

---

## 6. Environment & Configuration Requirements

- `DATABASE_URL`: `postgresql://dialmate:dialmatepassword@db:5432/dialmate` (Preserved)
- `REDIS_URL`: `redis://redis:6379` (Preserved)
- `JWT_SECRET`: Preserved
- `APP_URL`: `https://api.sundaybazaaar.com` (Preserved)
- `FRONTEND_URL`: `https://app.sundaybazaaar.com` (Preserved)
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`: Handled gracefully in dry-run mode if unconfigured or unverified.
- `WA_AKG_BASE_URL`: `http://wa-akg:3000` (Direct container-to-container network communication)

---

## 7. Deployment Readiness Assessment

- **Backend tests:** 7/7 suites passed, 62/62 tests passed.
- **Frontend build:** Clean production build created (`dist/assets` generated in 12.9s).
- **Remaining Fixes needed prior to production container deployment:**
  1. Fix enum contract in `AICallInterpretationService.js` (`CANCELLED` instead of `REJECTED`).
  2. Fix TwiML gather route in `webhooks.js` to point to `/twilio/gather`.
  3. Fix Caddyfile reverse proxy port for WA-AKG (`wa-akg:3000`).
