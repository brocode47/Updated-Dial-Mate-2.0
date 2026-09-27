# Feature Implementation Matrix

| Feature | Status | Notes |
| :--- | :--- | :--- |
| **Shopify Integration** | 🟡 Partially Implemented | Webhooks (`orders/create`) work. Order fetching & tagging (`COD_CONFIRMED`) exists in `orders.js`. Public App OAuth flow is missing/mocked. |
| **COD Order Confirmation** | 🟢 Actually Implemented | Status states and logic exist (`OrderStateMachine.js`). Twilio calls are triggered on new orders. |
| **Twilio Voice Calls** | 🟢 Actually Implemented | `twilio.js` handles `/voice`, `/gather`, and `/status`. Triggers outbound calls successfully. |
| **AI Voice Conversations** | 🟡 Partially Implemented | Foundation laid in `agent.js` using `@google/genai`, but Twilio integration relies heavily on static TTS/DTMF fallbacks (Gather). Bi-directional live speech-to-text via websocket is missing. |
| **Urdu/Roman Urdu/English** | 🟡 Partially Implemented | Prompts are written in Roman Urdu. TwilioTTS `ur-PK` is used. True native Urdu ASR is dependent on Twilio's engine or missing. |
| **Speech-to-Text (ASR)** | 🟡 Partially Implemented | Uses Twilio `<Gather input="speech">`. Quality for Urdu depends strictly on Twilio's built-in ASR. |
| **Text-to-Speech (TTS)** | 🟢 Actually Implemented | Uses Twilio `<Say language="ur-PK">`. |
| **AI Intent Detection** | 🟡 Partially Implemented | Basic regex/keyword fallbacks in `agent/flow.js` and `agent/llm.js`. Gemini agent is defined but not the primary path in all cases. |
| **AI Tool/Function Calling** | 🟡 Partially Implemented | Defined in `agent.js` (`confirm_cod_order`, `cancel_order`, etc.). Executed if Gemini returns function calls, but fragile without robust error handling. |
| **Confirm / Cancel Order** | 🟢 Actually Implemented | Working via DTMF (1 / 2) and `OrderStateMachine.js`. |
| **Request Callback/Reschedule**| 🟡 Partially Implemented | Intent detected in fallback regex, mapped to 'Reschedule Requested', but lacks a scheduling/cron system to actually execute the retry later. |
| **Human Handoff** | 🔴 Mocked / Missing | AI can return `transfer_to_human`, which tags the order `HUMAN_REVIEW_NEEDED`. No actual call transferring/SIP forwarding logic is implemented. |
| **Call History & Transcripts** | 🟡 Partially Implemented | DB tracks calls and outcomes. Transcripts are not robustly saved from full conversations, only static speech results from Twilio Gather. |
| **Analytics** | 🔴 Mocked | Frontend UI has analytics cards, but backend aggregation endpoints are missing or mocked. |
| **Billing / Subscriptions** | 🔴 Planned / Documented | `FEATURE_BILLING` flag exists. No Stripe/Shopify Billing API logic is present. |
| **Usage Tracking** | 🔴 Missing | Missing completely. Required for per-minute/per-call billing. |
| **Multi-tenant Architecture**| 🟡 Partially Implemented | Schema supports it (`Shop`, `Organization`). `tenantMiddleware` exists but often relies on headers/mocked data rather than robust session auth. |
| **Authentication & AuthZ** | 🔴 Mocked / Missing | `auth.js` exists but lacks secure standard OAuth/JWT implementation for production. |
| **Webhooks** | 🟢 Actually Implemented | `webhooks.js` handles signature verification and idempotency correctly. |
| **Background Jobs / Queues** | 🔴 Missing | Uses `setTimeout()` for call retries, which will fail if the server restarts (memory leak/data loss). |
| **Retry & Failure Handling** | 🟡 Partially Implemented | Call status callback handles retries, but uses `setTimeout`. No persistent queue like BullMQ or Redis. |
| **Audit Logs** | 🟢 Actually Implemented | `ComplianceLog` table is actively written to during key events. |
| **Fraud / Risk Scoring** | 🟡 Partially Implemented | `risk.js` has a basic hardcoded heuristic model. Not true AI/ML fraud scoring. |
| **WhatsApp Integration** | 🔴 Planned / Documented | Folder exists (`server/src/integrations/whatsapp`), but no active implementation. |

---

### Legend
- 🟢 **Actually Implemented**: Code exists, is wired up, and functional.
- 🟡 **Partially Implemented**: Code exists but is basic, lacks edge-case handling, or relies on simple heuristics instead of robust systems.
- 🔴 **Mocked/Missing/Planned**: UI might show it, or schema might support it, but backend logic is entirely absent or hardcoded.
