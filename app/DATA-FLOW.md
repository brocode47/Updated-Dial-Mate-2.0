# Data Flow

## 1. Automated Order Confirmation Flow
This is the primary automated flow triggered by a customer placing an order on Shopify.

1. **Trigger:** Customer completes checkout on Shopify.
2. **Ingestion:** Shopify fires `orders/create` webhook.
3. **Verification:** `server/src/routes/webhooks.js` verifies HMAC signature.
4. **Storage:** Order payload is saved/upserted in `Order` table.
5. **Risk Assessment:** `computeRiskScore` evaluates the payload.
6. **Trigger Call:** `triggerCall()` is invoked asynchronously (via `setTimeout` to avoid blocking Shopify).
7. **Twilio Handshake:** Backend creates a Twilio call using `client.calls.create`. Twilio rings the customer.
8. **Call Connected:** Customer answers. Twilio hits `/twilio/voice`.
9. **AI Initialization:** Backend initializes `Agent` (Gemini), returns TwiML with `<Gather>` to ask the user for confirmation in Roman Urdu.
10. **Customer Response:** Customer speaks. Twilio hits `/twilio/gather` with transcript.
11. **Processing:**
    - Speech is passed to `Agent.sendMessage()`.
    - Gemini evaluates intent and may trigger a function call (e.g. `confirm_cod_order`).
    - Fallback: Regex/DTMF evaluation if AI fails.
12. **State Transition:** `OrderStateMachine` updates DB status to `Confirmed`/`Cancelled`.
13. **Sync to Shopify:** `addOrderTag` is called via API to tag the order in Shopify (`COD_CONFIRMED`).
14. **Completion:** TwiML is returned to hang up the call.

## 2. Manual Call Trigger (Dashboard)
1. **Trigger:** Merchant clicks "Call Now" in React UI.
2. **API Request:** Frontend calls `POST /api/shops/:shop/orders/:orderId/call`.
3. **Database Check:** Validates order exists, extracts phone number.
4. **Call Initialization:** Initiates Twilio call via `placeOutboundCall()`.
5. **Execution:** Joins the exact same Twilio Handshake loop (Step 8 above).

## 3. Call Retry Flow
1. **Trigger:** Twilio hits `/twilio/status` with `CallStatus = busy` or `no-answer`.
2. **Evaluation:** Checks `retryCount` in DB. If `< 2`, increments counter.
3. **Schedule:** Uses `setTimeout(..., 60000)` to wait 1 minute.
4. **Re-trigger:** Calls `triggerCall()` again.
