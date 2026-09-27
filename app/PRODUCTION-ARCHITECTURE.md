# Dial Mate 2.0 Production Architecture Baseline

This document provides a single, reconciled architecture baseline for transitioning Dial Mate 2.0 from its current prototype state into a robust, horizontal, multi-tenant SaaS application.

## A. System Architecture

**Current State (Prototype):**
- Monolithic Express.js backend and React/Vite frontend.
- Uses `ngrok` hardcoded in frontend components for API communication.
- Background tasks (like call retries) rely on ephemeral Node.js memory (`setTimeout`).
- In-memory data structures (`Map`) manage active Twilio calls and AI context.

**Planned State (Production):**
- **Frontend:** React application integrated into Shopify App Bridge or served from a dedicated domain with dynamic environment configuration.
- **API/Backend:** Horizontally scalable Express.js REST/GraphQL API.
- **PostgreSQL/Prisma:** Primary relational datastore for tenants, users, orders, calls, and logs.
- **Redis:** Centralized, distributed cache for maintaining active call state across multiple server instances, rate limiting, and queue management.
- **Background Workers:** Dedicated queue consumers (e.g., BullMQ) for outbound calls, retries, webhook processing, and analytics aggregation.
- **AI Service:** Google Gemini integration via standard SDKs with decoupled function-calling routing.
- **Telephony (Twilio):** Media Streams / WebSockets for true real-time duplex audio instead of discrete `<Gather>` steps.
- **Shopify Integration:** Strict Webhook handling with signature verification and robust OAuth flow.
- **Observability:** Centralized structured logging (e.g., Pino + Datadog/CloudWatch) with PII redaction and APM.

## B. Authentication and Authorization

**Current State:**
- Missing secure session/JWT strategy; identity partially relies on route params (`/shops/:shop`).
- Basic `auth.js` exists but lacks secure handoff to the frontend UI.

**Planned State:**
- **User Authentication:** JWT-based session tokens issued after successful Shopify OAuth.
- **Tenant Identification:** Extracted securely from JWT payload, not from raw URL parameters.
- **Shopify OAuth:** Full implementation of Shopify OAuth 2.0 to securely acquire and rotate `accessToken` per tenant.
- **API Authorization:** Middleware validating `Authorization: Bearer <Token>` against database roles (Owner, Admin, Viewer).
- **Internal Service Auth:** Shared secrets or mTLS for queue workers communicating with the main API if separated.
- **Webhook Verification:** Strict HMAC-SHA256 signature verification for all incoming Shopify webhooks (currently implemented but requires rigorous testing).

## C. Multi-tenancy

**Current State:**
- Schema supports it (`Organization`, `User`, `Shop`).
- Application logic enforces it weakly through URL path checking (`req.params.shop`).

**Planned State:**
- **Tenant Model:** 1 Organization : N Shops : N Users.
- **Data Isolation:** All database queries must include a `shopId` or `organizationId` filter (logical isolation). 
- **Request Tenant Resolution:** Resolved securely via JWT claims at the API Gateway/Middleware layer, completely disregarding client-provided parameters.
- **Prevention of Cross-tenant Access:** Database interaction functions wrapped in context-aware services that automatically scope queries.

## D. Call Architecture

**Current State:**
- Uses Twilio `<Gather>` and discrete webhooks (`/voice`, `/gather`, `/status`).
- Call state stored in process memory (`const activeCalls = new Map();`).

**Planned State:**
- **Call Creation:** Background worker dequeues a call request and triggers Twilio REST API.
- **Call State:** Maintained in Redis (indexed by `CallSid`) to survive server crashes and allow horizontal scaling.
- **Twilio Webhooks/Streams:** Initial webhook upgrades the connection to a WebSocket for continuous audio streaming (Twilio Media Streams + Gemini Live API).
- **STT/TTS:** Handled dynamically via the bidirectional stream for lower latency and barge-in support.
- **Tool/Function Calling:** Gemini tools defined for order lookup, confirmation, and cancellation.
- **Failure Handling:** If the stream drops, Twilio `/status` webhook updates DB and schedules a retry job via the queue.
- **Human Transfer:** "Transfer to Agent" tool triggers a Twilio `<Dial>` verb or SIP forward.

## E. Queue Architecture

**Current State:**
- Missing. `setTimeout` is used.

**Planned State (Required):**
All asynchronous work must move to a robust job queue (e.g., BullMQ backed by Redis).
- **Queue Names & Responsibilities:**
  - `call-outbound`: Executes Twilio `calls.create`.
  - `call-retry`: Manages backoff and schedules delayed outbound calls.
  - `shopify-sync`: Pushes updates/tags to Shopify (`COD_CONFIRMED`).
  - `webhook-process`: Processes incoming Shopify payloads after initial HMAC validation.
  - `analytics-agg`: Runs periodically to update dashboard metrics.
- **Reliability:**
  - **Retry Strategy:** Exponential backoff.
  - **Dead-letter Handling:** Failed jobs moved to a Dead Letter Queue (DLQ) for operator review.
  - **Idempotency:** Webhook processor must verify the `WebhookEvent` table to prevent processing the same Shopify ID twice.

## F. Database Architecture

**Current State:**
- Good baseline using Prisma with PostgreSQL.

**Planned Entities (Verified & Needed):**
- **Tenants:** `Organization`, `Shop` (Linked to Shopify domain/access token).
- **Users:** `User` (RBAC).
- **Customers:** `Customer` (Unified customer profile).
- **Orders:** `Order` (Includes risk score, status, total amount).
- **Calls/Conversations:** `Call`, `Conversation`, `Message` (Tracks outcomes, durations, transcripts).
- **Webhooks:** `WebhookEvent` (Idempotency log).
- **Audit/Compliance:** `ComplianceLog` (Tracks all critical state changes).
- *(New)* **Jobs:** If using Postgres for queuing, otherwise BullMQ uses Redis.
- *(New)* **Billing:** `Subscription`, `UsageRecord` (For tracking per-call/per-minute limits).
- *(New)* **AI Logs:** `AIToolCall` (Audit trail for when AI triggers `confirm_order` or `transfer`).

## G. Shopify Architecture

**Current State:**
- `orders/create` webhook is verified. Tagging is mocked (`[Mock] Shopify tag added`).

**Planned State:**
- **OAuth:** Mandatory dynamic installation flow.
- **Token Storage:** Encrypted `accessToken` in `Shop` table.
- **Webhooks:** Fast acknowledgement (200 OK) -> Save to `WebhookEvent` -> Queue for processing.
- **Order Updates:** Sync status changes back to Shopify via REST/GraphQL API using the stored token. Ensure "mocking" is fully replaced with the actual `@shopify/shopify-api` calls.
- **Rate Limiting:** Abide by Shopify's leaky bucket API limits.

## H. AI Architecture

**Current State:**
- Static `@google/genai` usage mapped inside a Twilio Gather loop.

**Planned State:**
- **Provider Abstraction:** Wrapper around the LLM client to allow swapping or upgrading models.
- **System Prompts:** Version-controlled prompts defining agent persona, rules, and constraints (Urdu/Roman Urdu specs).
- **Conversation State:** Managed in Redis during the call, persisted to `Message` table post-call.
- **Tool Calling:** Strict JSON schemas for `confirm_order`, `cancel_order`, `escalate_to_human`.
- **Hallucination Protection:** The backend must independently validate the order status and IDs before blindly executing a tool call requested by the AI.

## I. Security Architecture

**Current State:**
- Severe issues: URL parameter-based tenant resolution, PII logged in plain text, lack of rate limiting.

**Planned State:**
- **Authentication/Authorization:** JWT + RBAC. No reliance on URL params for identity.
- **Tenant Isolation:** Enforced at the ORM/Service layer.
- **Secret Management:** Environment variables strictly injected; access tokens encrypted at rest.
- **Webhook Verification:** Cryptographic HMAC checks on all inbound Twilio and Shopify requests.
- **API Abuse Prevention:** Redis-backed rate limiting on manual "Call Now" endpoints.
- **PII Protection:** Redaction middleware for logs.

## J. Frontend Architecture

**Current State:**
- Contains hardcoded `ngrok` URLs.

**Planned State:**
- **API Client:** Axios/Fetch wrapper that dynamically reads the API base URL from Vite environment variables (`import.meta.env.VITE_API_URL`).
- **Auth/Session:** React Context wrapping App Bridge authentication to pass JWT tokens in headers.
- **Tenant Context:** Injected dynamically based on the authenticated session.
- **Error Handling:** Global error boundaries and toast notifications for API failures.

## K. Deployment Architecture

**Planned State:**
- **Frontend:** Built and served statically (CDN/S3) or served via the Express backend.
- **API / Web Worker:** Node.js containers orchestrated via Docker/Kubernetes/ECS.
- **Background Worker:** Separate scalable container instances consuming the Redis queue.
- **Databases:** Managed PostgreSQL (e.g., AWS RDS, Supabase) and Managed Redis (e.g., AWS ElastiCache, Upstash).
- **Infrastructure:** HTTPS termination at the Load Balancer, dynamic secrets injection via AWS Secrets Manager or Vault.

## L. Implementation Order

**Phase 1: Foundation & Security (Blockers for everything else)**
1. **Authentication & Multi-tenancy:** Implement JWT sessions and proper Shopify OAuth. Eliminate `x-shop-domain` header/URL dependency.
2. **Frontend Config:** Remove hardcoded ngrok URLs; configure dynamic environment variables.
3. **Database Constraints:** Enforce tenant isolation in queries.

**Phase 2: Reliability Infrastructure**
4. **Redis & Queues:** Set up Redis and BullMQ.
5. **Worker Migration:** Move `setTimeout` logic (retries, call scheduling) into durable queue jobs.
6. **State Management:** Move Twilio `activeCalls` Map into Redis.

**Phase 3: Core Business Logic**
7. **Shopify API:** Replace mocked tagging with actual API calls.
8. **Twilio/AI Integration:** Refactor to use WebSockets/Media Streams and Gemini Live API for real-time voice.

**Phase 4: Production Readiness**
9. **Security Hardening:** Implement rate limiting, API authorization, and PII log redaction.
10. **Billing & Analytics:** Implement subscription tiers and usage aggregation.
11. **Deployment Pipeline:** CI/CD for separate API and Worker containers.
