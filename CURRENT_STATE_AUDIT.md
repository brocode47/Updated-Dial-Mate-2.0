# Dial Mate 2.0 — Current State & Architecture Audit

**Repository:** `https://github.com/brocode47/Updated-Dial-Mate-2.0`  
**Current Git HEAD:** `483b4056ef964f6f93ac1f7aa5db3be80e875585`  
**Verified Production Commit:** `2ba8c6f92d1fdf32946a125523ddfe3900b514a5`  
**Verified Production Store:** `0qwck2-s1.myshopify.com`  
**Audit Date:** 2026-10-01  
**Runtime Environment:** Docker (`dialmate_api`, `dialmate_db` Postgres 15, `dialmate_redis`, `dialmate_worker`, `caddy`, `wa_akg_app`, `wa_mysql`)  

---

## 1. Executive Summary & Verification Context

Dial Mate 2.0 is transitioning from a **Shopify order dashboard** into a **fully automated AI Cash on Delivery (COD) confirmation platform**.

### Deployed Architecture vs GitHub State
1. **Production Infrastructure:**
   - Frontend: `https://app.sundaybazaaar.com` (Static assets served by Caddy, Last-Modified: Sep 30 2026, 22:30 GMT)
   - Backend API: `https://api.sundaybazaaar.com` (Docker container `dialmate_api` running on port 8787 behind Caddy reverse proxy)
   - WhatsApp Gateway: `https://wa.sundaybazaaar.com` (502 Bad Gateway due to port mapping misconfiguration in Caddyfile)
   - Database: PostgreSQL 15 (`dialmate_db`) on internal network `deployment_internal` (alias `db`)
   - Redis: Redis Alpine (`dialmate_redis`) on internal network `deployment_internal`

2. **Commit Status:**
   - **Verified Production Commit (`2ba8c6f`):** Fixed Caddy reverse proxy routing (`/api*` and `/auth*`), added `router.use(express.json())` to `apiRouter()`, and added the Twilio initialization guard.
   - **GitHub / Repository HEAD (`483b405`):** Implemented Phase 4 services (`orderEligibilityService.js`, `callWorkflowService.js`, `aiCallInterpretationService.js`, `whatsappFallbackService.js`), enhanced `webhookWorker.js` and `callWorker.js`, expanded dashboard and settings pages, and created test suite `phase4-cod-workflow.test.js`.
   - **Deployment Gap:** While commit `483b405` exists in the repository, the production Docker containers have not yet been redeployed from this commit.

---

## 2. Comprehensive Component Audit

| # | Feature / Area | Current Implementation | Files Involved | Status (Working / Not Working) | Missing Pieces & Gaps | Recommended Next Action |
|---|---|---|---|---|---|---|
| **1** | **Shopify Integration & OAuth** | Standard `@shopify/shopify-api` OAuth flow. `auth.begin` at `/auth/shopify`, callback at `/auth/shopify/callback`. Upserts `Shop`, creates initial JWT token, triggers initial data sync, redirects to frontend with `?token=...`. | `app/server/src/routes/auth.js`<br>`app/server/src/lib/shopify.js`<br>`app/server/src/middleware/tenant.js` | **WORKING** in production with `0qwck2-s1.myshopify.com` | None for core auth. Auto-renewal of offline tokens during Shopify token expiry edge cases is not explicit. | Keep untouched; preserve existing JWT and cookie handling. |
| **2** | **Shopify Data Sync** | Manual & post-auth REST sync for Orders, Customers, Products with tenant scoping. | `app/server/src/services/shopifySync.js`<br>`app/server/src/integrations/shopify/*`<br>`app/server/src/routes/api.js` (`POST /api/shopify/sync`) | **WORKING** | Sync is currently on-demand / manual via button or post-auth; bulk recurring sync cron is optional. | Reuse existing sync service without modification. |
| **3** | **Webhook Handling & Ingestion** | Ingests `orders/create`, `orders/updated`, `orders/cancelled`. Verifies HMAC signature with `crypto.timingSafeEqual`, checks `WebhookEvent` table for idempotency, enqueues to BullMQ `webhookQueue`, and immediately returns HTTP 200. | `app/server/src/routes/webhooks.js`<br>`app/server/src/lib/webhookVerify.js`<br>`app/server/src/workers/webhookWorker.js` | **WORKING** (Code level)<br>*Pending production container rollout* | In `webhooks.js` line 383, `gatherUrl` is set to `${appUrl}/gather` instead of `${appUrl}/twilio/gather` or `${appUrl}/webhooks/gather`. Root `/gather` returns 404 if hit by Twilio. | Fix gather URL reference in `webhooks.js` to ensure consistent routing to `/twilio/gather`. |
| **4** | **Order Eligibility Engine** | Pure deterministic business rules: checks merchant `aiCalling.enabled`, COD payment method, valid phone number format (`cleanPhoneNumber` with `+92...`), not cancelled, not confirmed, not in-progress, within max attempts, order value min/max, excluded tags, and operating hours window. | `app/server/src/services/orderEligibilityService.js`<br>`app/server/src/lib/risk.js` | **WORKING** (All 27 test cases pass) | No automated re-queueing for orders temporarily held due to `OUTSIDE_OPERATING_HOURS`. | Add scheduled delay when an order arrives outside operating hours to re-queue at store open time. |
| **5** | **Confirmation Queue & Workers** | BullMQ queues (`callQueue`, `webhookQueue`, `whatsappQueue`, `whatsappDeadLetterQueue`) running on Redis. Workers handle `initiate-call`, `retry-call`, `callback`, and webhook processing. Exponential backoff and job idempotency keys (`call-init-${shopId}-${orderId}`). | `app/server/src/lib/queues.js`<br>`app/server/src/lib/redis.js`<br>`app/server/src/workers/index.js`<br>`app/server/src/workers/callWorker.js`<br>`app/server/src/workers/webhookWorker.js` | **WORKING** (62/62 server unit/integration tests pass) | In-flight Redis lock should explicitly guard against simultaneous webhook and manual dashboard "Call Now" triggers. | Worker pipeline is solid; maintain current concurrency limits (5 for calls, 10 for webhooks, 1 for WhatsApp). |
| **6** | **Twilio Integration & Outbound Calling** | Dual flow: WebSocket Media Stream (`/twilio/voice` -> `wss:///twilio/media`) for live bidirectional audio streaming, with DTMF Keypad fallback (`/twilio/gather`: 1 = confirm, 2 = cancel). Supports dry-run when unconfigured. | `app/server/src/routes/twilio.js`<br>`app/server/src/calls/twilio.js`<br>`app/server/src/services/callWorkflowService.js`<br>`app/server/src/utils/audioCodec.js` | **WORKING** in dry-run and live credential modes | Legacy IVR in `webhooks.js` duplicates `/gather` logic from `twilio.js`. | Deprecate duplicate `triggerCall` in `webhooks.js` and ensure all outbound calls route through `CallWorkflowService`. |
| **7** | **AI Engine & Live Conversation** | Bidirectional voice streaming via `@google/genai` Live API (`Agent` class in `agent.js`). Audio codec converts Twilio 8kHz mu-law to Gemini PCM16. Tool declarations for `confirm_order`, `cancel_order`, `schedule_callback`. | `app/server/src/integrations/ai/agent.js`<br>`app/server/src/integrations/ai/client.js`<br>`app/server/src/integrations/ai/dispatcher.js`<br>`app/server/src/integrations/ai/tools.js`<br>`app/server/src/integrations/ai/prompts.js` | **WORKING** | In `agent.js`, model is hardcoded as `gemini-3.1-flash-live-preview`; should fall back to stable `gemini-2.0-flash-exp` or configurable model from env. | Ensure model name is environment-configurable (`GEMINI_LIVE_MODEL`). |
| **8** | **AI Output Classification** | Deterministic + NLP parser classifying Urdu, Roman Urdu, and English utterances, DTMF digits, and Twilio status callbacks into structured decisions with confidence score. | `app/server/src/services/aiCallInterpretationService.js` | **WORKING** | Target contract mismatch: Service currently returns `result: 'REJECTED'` whereas the Phase 4 specification requires `result: 'CANCELLED'`. | Standardize `result` enum to `CONFIRMED | CANCELLED | CALLBACK_REQUESTED | UNKNOWN`. |
| **9** | **Order State Machine & Shopify Update** | Validates status transitions (`Pending` -> `Confirmed` / `Cancelled` / `Human Transfer`). Updates Shopify tags (`COD_CONFIRMED`, `COD_CANCELLED`, `HUMAN_REVIEW_NEEDED`) via REST API before committing database changes. | `app/server/src/services/OrderStateMachine.js`<br>`app/server/src/integrations/shopify/orders.js` | **WORKING** | Does not add note attributes or update order fulfillment hold status in Shopify. | Tag updates work; optional note attributes can be added if requested by merchant. |
| **10** | **WhatsApp Fallback (WA-AKG)** | Uses existing WA-AKG Baileys gateway to send localized WhatsApp messages (Urdu, Roman Urdu, English) when phone calls are unanswered after maximum attempts. | `app/server/src/services/whatsappFallbackService.js`<br>`app/server/src/integrations/whatsapp/client.js`<br>`app/server/src/workers/whatsappWorker.js` | **PARTIALLY WORKING** (Code is complete; WA-AKG container is unreachable in prod) | **Production Bug:** `wa.sundaybazaaar.com` returns 502 Bad Gateway because Caddyfile proxies to `wa-akg:8787` instead of `wa-akg:3000`. | Update `app/deployment/Caddyfile` line 6 from `reverse_proxy wa-akg:8787` to `reverse_proxy wa-akg:3000`. |
| **11** | **Database Schema (Prisma)** | Models for `Shop`, `Order`, `Customer`, `Call`, `WebhookEvent`, `ComplianceLog`, `WhatsAppIntegration`, `Product`, `AIInteractionLog`, `CustomerProfileMemory`. | `app/server/prisma/schema.prisma` | **WORKING** | None. All required fields (`callStatus`, `callSid`, `lastCallAt`, `retryCount`, `riskScore`, `durationSec`, `outcome`, `recordingUrl`) already exist. | No database schema migrations required. Maintain tenant isolation on all queries. |
| **12** | **Existing APIs** | 25 REST endpoints covering stats, orders, calls, compliance, settings, conversations, and analytics. All secured by `tenantMiddleware` using JWT. | `app/server/src/routes/api.js` | **WORKING** | None. Rate limiting and tenant isolation are enforced. | Preserve existing route signatures. |
| **13** | **Merchant Dashboard** | React + Vite dashboard displaying real database KPIs: orders waiting confirmation, calls today, confirmed orders, cancelled orders, COD success rate, failure rate. Manual "Call Now" trigger with in-flight loading state. | `app/src/pages/DashboardPage.jsx`<br>`app/src/pages/OrdersPage.jsx`<br>`app/src/pages/CallsPage.jsx`<br>`app/src/pages/AnalyticsPage.jsx`<br>`app/src/pages/SettingsPage.jsx` | **WORKING** (Build succeeds in 12.9s) | Live polling interval could be optimized with server-sent events or WebSocket for instant dashboard refresh. | Keep pure database-driven metrics (0 mock data). |
| **14** | **Deployment & Networking** | Docker Compose running `caddy`, `api`, `worker`, `db`, `redis`, `wa-akg`, `wa-mysql`. Caddy handles SSL and reverse proxying. | `app/deployment/docker-compose.prod.yml`<br>`app/deployment/Caddyfile` | **WORKING for API & App**<br>**FAILING for WA-AKG** | `wa.sundaybazaaar.com` reverse proxy target port is 8787 instead of 3000. | Fix Caddyfile port for WA-AKG. |

---

## 3. Discovered Production Discrepancies & Critical Bugs

### Bug 1: Caddyfile Port Mismatch for WA-AKG (502 Bad Gateway)
- **Location:** `app/deployment/Caddyfile` line 5–7:
  ```caddy
  wa.sundaybazaaar.com {
      reverse_proxy wa-akg:8787
  }
  ```
- **Issue:** `app/wa-akg/Dockerfile` sets `ENV PORT=3000` and `EXPOSE 3000`. The container listens on port 3000, not 8787. This causes Caddy to return `502 Bad Gateway` on `https://wa.sundaybazaaar.com`.
- **Fix:** Update Caddyfile:
  ```caddy
  wa.sundaybazaaar.com {
      reverse_proxy wa-akg:3000
  }
  ```

### Bug 2: AI Classification Result Contract Mismatch (`REJECTED` vs `CANCELLED`)
- **Location:** `app/server/src/services/aiCallInterpretationService.js`
- **Issue:** The service returns `result: 'REJECTED'`, but the target specification strictly defines:
  ```json
  {
    "result": "CONFIRMED" | "CANCELLED" | "CALLBACK_REQUESTED" | "UNKNOWN",
    "confidence": 0.95
  }
  ```
- **Fix:** Update `AICallInterpretationService.js` to return `CANCELLED` (and alias `REJECTED` to `CANCELLED` for backwards compatibility in existing tests).

### Bug 3: Duplicate and Misrouted Twilio Gather Paths
- **Location:** `app/server/src/routes/webhooks.js` line 383 vs `app/server/src/routes/twilio.js` line 186
- **Issue:** `webhooks.js` sets `gatherUrl` to `${appUrl}/gather`, but `index.js` mounts `webhooksRouter` at `/webhooks` and `twilioRouter` at `/twilio`. A call to `${appUrl}/gather` will return 404 from Express.
- **Fix:** Standardize all TwiML gather actions to `${appUrl}/twilio/gather`.

---

## 4. Existing Reusable Architecture (Do NOT Re-Create)

1. **Authentication & Tenant Isolation:**
   - `tenantMiddleware` in `app/server/src/middleware/tenant.js`
   - Shopify OAuth in `app/server/src/routes/auth.js`
   - Store normalization in `app/server/src/lib/shopify.js`
2. **Order State Machine & Shopify Sync:**
   - `OrderStateMachine` in `app/server/src/services/OrderStateMachine.js`
   - Shopify REST client & tagging in `app/server/src/integrations/shopify/orders.js`
   - Real-time data sync in `app/server/src/services/shopifySync.js`
3. **Queue Infrastructure:**
   - BullMQ connection and queues in `app/server/src/lib/queues.js`
   - Redis connection pool in `app/server/src/lib/redis.js`
   - Multi-concurrency workers in `app/server/src/workers/index.js`
4. **WhatsApp System:**
   - Multi-tenant Baileys gateway in `app/wa-akg`
   - WhatsApp client in `app/server/src/integrations/whatsapp/client.js`
   - Fallback messaging service in `app/server/src/services/whatsappFallbackService.js`
5. **AI Telephony & Voice Engine:**
   - Audio conversion in `app/server/src/utils/audioCodec.js`
   - Live media streaming bridge in `app/server/src/routes/twilio.js`
   - Tool calling dispatcher in `app/server/src/integrations/ai/dispatcher.js`

---

## 5. Next Steps for Production Rollout

1. **Harmonize Enum Contracts:**
   - Update `AICallInterpretationService.js` to output `CANCELLED` while supporting `REJECTED` gracefully.
2. **Fix TwiML Gather URL in `webhooks.js`:**
   - Point gather action directly to `/twilio/gather`.
3. **Fix Caddyfile WA-AKG Proxy Port:**
   - Point `wa.sundaybazaaar.com` reverse proxy to `wa-akg:3000`.
4. **Verify Real Store Safety Protocol:**
   - With verified store `0qwck2-s1.myshopify.com`, test the safe dry-run flow:
     `Shopify Webhook -> Order Ingestion -> Eligibility Check -> BullMQ Job -> Call Creation (Dry Run) -> Status Callback -> Database & Tagging`.
5. **Deployment:**
   - Rebuild Docker container `dialmate_api` and `caddy` from the verified code.
