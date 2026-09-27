# API Map

This document outlines the current backend routes exposed by the Express application in `server/src`.

## 1. Frontend API Routes (`/api`)
Defined in `server/src/routes/api.js`. Requires `tenantMiddleware`.

- `GET /api/features`
  - **Purpose:** Returns feature flags for the frontend UI.
- `GET /api/shops/:shop/orders`
  - **Purpose:** Fetch recent orders for the dashboard.
- `GET /api/shops/:shop/calls`
  - **Purpose:** Fetch call history logs for the dashboard.
- `GET /api/shops/:shop/compliance`
  - **Purpose:** Fetch compliance/audit logs.
- `POST /api/shops/:shop/orders/:orderId/tag`
  - **Purpose:** Manually update an order's tag/status from the dashboard.
- `POST /api/shops/:shop/orders/:orderId/call`
  - **Purpose:** Manually trigger a "Call Now" or "Retry" action from the dashboard. Creates a Twilio call.

## 2. Twilio Webhook Routes (`/twilio`)
Defined in `server/src/routes/twilio.js`.

- `POST|GET /twilio/voice`
  - **Purpose:** Initial Twilio webhook when a call connects. Initiates the AI agent, outputs initial TwiML `<Gather>`.
- `POST|GET /twilio/gather`
  - **Purpose:** Receives user speech or DTMF digits from Twilio. Passes speech to `agent.sendMessage()`, executes state machine transitions (Confirm/Cancel), outputs next TwiML response.
- `POST|GET /twilio/status`
  - **Purpose:** Twilio Call Status Callback. Tracks call outcome, handles automated retries if call failed/busy.

## 3. Shopify Webhook Routes (`/webhooks`)
Defined in `server/src/routes/webhooks.js`.

- `POST /webhooks/orders/create`
  - **Purpose:** Receives new orders from Shopify. Verifies HMAC, upserts to database, computes risk score, and asynchronously triggers a Twilio call.
- `POST /webhooks/orders/updated`
  - **Purpose:** Receives order updates. Currently a no-op (ignores to prevent duplicate calling).

## 4. Auth Routes (`/auth`)
Defined in `server/src/routes/auth.js` (Contents not fully detailed, assumed basic/mocked based on overall architecture).

## 5. System Routes
- `GET /` - Health check (Text)
- `GET /api/health` - Health check (JSON)
