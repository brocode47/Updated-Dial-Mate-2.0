# Technical Debt

## 1. Retry Logic relies on `setTimeout`
**File:** `server/src/routes/twilio.js` & `server/src/routes/webhooks.js`
**Issue:** Delays (like retrying a call in 60s, or waiting 100ms before triggering a call) use Node.js `setTimeout()`. If the Node process crashes or restarts, all pending retries are permanently lost.
**Solution:** Implement a durable background job queue (e.g., BullMQ with Redis, or AWS SQS).

## 2. Lack of Bidirectional Streaming
**File:** `server/src/routes/twilio.js`
**Issue:** The AI Agent is built on a turn-based request/response cycle using Twilio's `<Gather>` verb. This means high latency, lack of interruption capability (barge-in), and stilted conversations.
**Solution:** Upgrade to Twilio Media Streams (WebSockets) paired with Gemini's Live API for true realtime voice.

## 3. Mocked Shopify Tagging
**File:** `server/src/routes/twilio.js`
**Issue:** `addShopifyOrderTag` currently just logs a message (`[Mock] Shopify tag added`) instead of executing the actual Shopify REST API call, even though the real function exists in `integrations/shopify/orders.js`.
**Solution:** Wire up the actual service layer function.

## 4. Single-tenant shortcuts in Multi-tenant App
**File:** `server/src/middleware/tenant.js` (Assumed), `api.js`
**Issue:** Routes are prefixed with `/shops/:shop`, assuming the frontend simply passes the shop name in the URL. There is no cryptographic guarantee that the user requesting the data actually owns that shop.
**Solution:** Implement robust JWT/session-based auth tied to the Shopify OAuth flow.

## 5. In-Memory State for Active Calls
**File:** `server/src/routes/twilio.js`
**Issue:** `const activeCalls = new Map();` stores live Agent sessions in server memory. This precludes horizontally scaling the Node server (e.g., across multiple pods in Kubernetes) because subsequent Twilio webhooks might hit a different server instance.
**Solution:** Store conversation history in a shared database (PostgreSQL/Redis) and re-hydrate the AI agent on every request.
