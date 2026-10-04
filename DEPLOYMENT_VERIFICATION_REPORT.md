# Dial Mate 2.0 — Deployment & Verification Report

**Verification Date:** 2026-10-04  
**Target Host:** `193.123.73.113` (Oracle Cloud Infrastructure, user `opc`)  
**Deployment Repository:** `/opt/dialmate/app`  
**GitHub Repository:** `https://github.com/brocode47/Updated-Dial-Mate-2.0`  

---

## 1. Git State & Alignment

- **GitHub Baseline Commit:** `cae325f187a1d1fa4356e3b5e408ecbb6e5c5487` (`cae325f`)
- **VM Commit Hash:** `cae325f187a1d1fa4356e3b5e408ecbb6e5c5487` (`cae325f`)
- **Git Alignment:** `VM HEAD == origin/main == local HEAD`
- **Fast-Forward Status:** Successfully fetched and pulled with `--ff-only`.
- **Pre-deployment Rollback Commit:** `0848126c77e1b75f0b25bb83a7a4159906756241`

---

## 2. Container & Service Deployment

- **Deployment Method:** Recreated `api` and `worker` via `docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --no-deps --force-recreate api worker`.
- **Pre-existing Database & Redis:** Untouched. PostgreSQL 15 (`dialmate_db`) and Redis Alpine (`dialmate_redis`) preserved without data loss or restarts.
- **Service Status:**
  - `dialmate_api`: **Up** (listening on `:8787`, port `8787:8787`)
  - `dialmate_worker`: **Up** (connected to Redis, background workers active)
  - `dialmate_db`: **Up 6 days** (PostgreSQL 15 accepting connections)
  - `dialmate_redis`: **Up 12 days** (responding `PONG`)
  - `caddy`: **Up 3 days** (serving reverse proxy on ports 80/443 with TLS)
  - `wa_akg_app`: **Up 3 days** (Baileys WhatsApp gateway active on port 3000)
  - `wa_mysql`: **Up 3 days** (MySQL 8 active on port 3306)

---

## 3. Network DNS & Resolution

- **Internal Docker Network:** `deployment_internal`
- **DNS Resolution Inside `dialmate_api`:**
  - `db` $\rightarrow$ `172.18.0.3` (Verified via `getent hosts db`)
  - `redis` $\rightarrow$ `172.18.0.4` (Verified via `getent hosts redis`)
- **DNS Resolution Inside `dialmate_worker`:**
  - `db` $\rightarrow$ `172.18.0.3` (Verified via `getent hosts db`)
  - `redis` $\rightarrow$ `172.18.0.4` (Verified via `getent hosts redis`)
- **Fix Applied:** Ensured `db.js` and `redis.js` preserve internal Docker container hostnames (`db:5432`, `redis:6379`) when running inside Docker containers (`/.dockerenv`), eliminating localhost loopback connection errors.

---

## 4. Environment & Integration Health

| Component | Status | Verification Detail |
| :--- | :--- | :--- |
| **DATABASE_URL** | **CONFIGURED** | Resolves to `postgresql://dialmate:***@db:5432/dialmate`. Queries succeed. |
| **PostgreSQL Database** | **HEALTHY** | `pg_isready -U dialmate` returns accepting connections. 54 real orders present. |
| **REDIS_URL** | **CONFIGURED** | Resolves to `redis://redis:6379`. Both API and worker connected. |
| **Redis Server** | **HEALTHY** | Responding `PONG`. Queues `callQueue`, `webhookQueue`, `whatsappQueue` ready. |
| **GEMINI_API_KEY** | **CONFIGURED** | Successfully injected from host `.env.prod`. Valid 53-character key active. |
| **TWILIO_ACCOUNT_SID** | **CONFIGURED** | Valid SID format starting with `AC`. |
| **TWILIO_AUTH_TOKEN** | **CONFIGURED** | Valid 32-character token. |
| **TWILIO_FROM_NUMBER** | **CONFIGURED** | Valid E.164 phone. |
| **Voice Webhook** | **CONFIGURED** | `https://api.sundaybazaaar.com/twilio/voice` responds HTTP 200. |
| **Status Callback** | **CONFIGURED** | `https://api.sundaybazaaar.com/twilio/status` responds HTTP 200. |
| **Media Stream** | **CONFIGURED** | `wss://api.sundaybazaaar.com/twilio/media` endpoint bound. |
| **WA-AKG Gateway** | **RUNNING** | Baileys engine active; tenant session connection pending merchant setup. |

---

## 5. Calling Safety Controls

- **`AI_CALL_MODE`:** `test` (Enforced on both API and Worker)
- **`ADMIN_TEST_NUMBERS`:** Configured with `+923001234567` (All non-whitelisted calls safely diverted to dry-run)
- **`EMERGENCY_STOP`:** `false` (Untriggered; immediate kill-switch available)
- **`DAILY_CALL_LIMIT`:** `100` (Enforced daily quota)
- **Carrier Dialing Safety:** Fully verified. No customer call can take place outside `ADMIN_TEST_NUMBERS`.

---

## 6. Safe Test Order Verification

- **Order Identifier:** `P6-3410` (Database UUID: `2db2e9e7-f8fa-4928-94cb-b7993547132b`)
- **Merchant:** `0qwck2-s1.myshopify.com` (`Sunday Bazaaar Official`)
- **Customer Name:** `Tariq Mehmood`
- **Customer Phone:** `+923001234567` (Whitelisted in `ADMIN_TEST_NUMBERS`)
- **Order Total:** PKR 3,200 (Cash on Delivery)
- **Order Status:** `Pending Confirmation`
- **Call Status:** `failed` (Previous test call, ready for controlled live test)
- **Terminal Status:** `false` (Order is NOT confirmed or cancelled)
- **Eligibility Check:** `OrderEligibilityService.checkOrderEligibility` returned `eligible: true, reason: 'ELIGIBLE_FOR_CONFIRMATION_CALL'`.

---

## 7. Regression & Build Status

- **Automated Tests:** 151/151 tests pass across 11 test suites (`npx vitest run`).
- **Zero Regressions:** 0 failed tests.
- **Frontend Production Build:** Vite build succeeds without errors in 3.85s (`npm run build`).

---

## 8. Controlled Live Call Readiness

- **Current State:** The production VM is running the exact commit `cae325f` matching GitHub `origin/main`.
- **Telemetry & Containers:** Healthy, connected to PostgreSQL and Redis.
- **Safety Mode:** `test` mode active. Whitelist locked to `ADMIN_TEST_NUMBERS`.
- **Verdict:** **READY FOR CONTROLLED LIVE TEST**
- **Action:** No call placed. Waiting for explicit user authorization.
