# Integration Map

## Shopify
- **Purpose:** Source of truth for orders, inventory, and fulfillment.
- **Client Library:** `@shopify/shopify-api` (v11.14.0)
- **Authentication:** Scopes `read_orders, write_orders` via standard OAuth. (Currently mocked/basic).
- **Inbound Data:** Receives `orders/create` webhooks.
- **Outbound Data:** Hits Shopify REST API (`PUT /orders/{id}`) to append tags (`COD_CONFIRMED`, `COD_CANCELLED`, `HUMAN_REVIEW_NEEDED`).
- **Status:** Functional for webhook receiving. OAuth flow is missing for dynamic tenant onboarding.

## Twilio
- **Purpose:** Telephony provider for making and receiving phone calls.
- **Client Library:** `twilio` (v5.13.1)
- **Inbound Data:** Twilio sends webhooks to `/twilio/voice`, `/twilio/gather`, `/twilio/status`.
- **Outbound Data:** App uses `twilio.calls.create` to initiate outbound calls. Responds to webhooks with TwiML.
- **Status:** Integrated and functional. Uses basic `Gather` (TTS/ASR) instead of live websocket streaming.

## Google Gemini (AI)
- **Purpose:** LLM to evaluate customer intent and process conversations.
- **Client Library:** `@google/genai` (v2.23.0)
- **Integration Point:** `server/src/integrations/ai/agent.js`
- **Method:** Passing strings back and forth using `chat.sendMessage()`. Relies on Gemini Function Calling to execute state transitions.
- **Status:** Implemented in code, but used as a secondary path in the actual `gather` route. Does not use bidirectional voice streaming (`Live API`).

## WhatsApp
- **Purpose:** Fallback messaging channel.
- **Status:** Documented in folders, but 0% implemented.

## Billing (Stripe / Shopify Billing)
- **Purpose:** Charge users for usage/subscriptions.
- **Status:** Missing. Only UI placeholders exist.
