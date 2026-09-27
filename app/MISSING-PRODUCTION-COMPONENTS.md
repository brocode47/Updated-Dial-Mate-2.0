# Missing Production Components

To transform this repository into a production-grade multi-tenant SaaS for Shopify merchants, the following components must be built:

## 1. Shopify OAuth Onboarding Flow
- **Current State:** Missing.
- **Requirement:** A full implementation of Shopify's OAuth 2.0 flow to dynamically acquire and store `accessToken` for new merchants when they install the app from the Shopify App Store.

## 2. Background Task Queue (Redis / BullMQ)
- **Current State:** Uses `setTimeout()`.
- **Requirement:** A persistent message queue to handle scheduling delayed retries, webhook processing, and batch data syncing. This ensures no data is lost during server restarts.

## 3. Billing and Subscriptions (Stripe / Shopify Billing)
- **Current State:** Flags exist, logic is absent.
- **Requirement:** Integration with Shopify Billing API (for App Store apps) or Stripe to manage tiered plans and meter usage for usage-based billing per-call/per-minute.

## 4. True Realtime AI Voice (Websockets)
- **Current State:** Twilio `<Gather>` with TTS. High latency, robotic interaction.
- **Requirement:** Twilio Media Streams connecting to a websocket server that pipes raw audio to Gemini's Multimodal Live API. This allows for low latency, interruption handling (barge-in), and natural conversational flow.

## 5. Authentication System
- **Current State:** Custom basic auth or mocked.
- **Requirement:** Robust authentication using JWTs or a provider like Auth0/Clerk/Supabase Auth, tightly coupled to Shopify Session tokens for embedded apps.

## 6. Distributed State Management (Redis)
- **Current State:** In-memory `Map()`.
- **Requirement:** Move call session state to a shared datastore to allow horizontal scaling of the backend Node.js servers.

## 7. Webhook Signature Validation Enhancements
- **Current State:** Basic HMAC check exists.
- **Requirement:** Ensure idempotency is bulletproof (using the `WebhookEvent` table properly in all edge cases) and that old webhooks are periodically pruned.

## 8. Analytics Aggregation Engine
- **Current State:** Missing.
- **Requirement:** Scheduled jobs or optimized SQL queries/views to aggregate call data into metrics (Pickup Rate, Cancellation Rate, Avg Duration) for the dashboard UI.
