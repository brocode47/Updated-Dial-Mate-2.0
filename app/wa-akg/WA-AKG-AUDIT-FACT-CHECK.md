# WA-AKG Audit Fact Check

## 1. Claims Verified

*   **Next.js Version**: 16.1.1 (Verified in package.json).
*   **Prisma Version**: ^5.22.0 (Verified in package.json).
*   **Baileys Version**: ^7.0.0-rc.9 (Verified in package.json).
*   **Node.js Requirement**: ^20 (Verified in package.json under @types/node).
*   **Session Storage**: AuthState model in Prisma stores credentials (Verified in prisma/schema.prisma).
*   **Session Ownership**: Users are bound to sessions via the Session table userId field (Verified in src/lib/api-auth.ts).

## 2. Claims Partially Verified

*   **Voice/PTT Support**:
    *   **Sending**: The media/route.ts API sets ptt: true in Baileys if 	ype === 'voice'. (Verified in src/modules/whatsapp/chat.service.ts).
    *   **Receiving**: The webhook payload identifies audio natively, and media is saved to data/media before the webhook is dispatched.

## 3. Claims Incorrect or Unsupported

*   **Webhook Signatures**: The previous audit claimed Webhooks lacked cryptographic signatures. This is **INCORRECT**. src/lib/webhook.ts uses HMAC (crypto.createHmac("sha256", secret)) and passes it via the X-Webhook-Signature header if a secret is provided.
*   **Media Delivery Flow**: The previous audit guessed the Dial Mate flow required an explicit download handshake. This is partially incorrect in practice. WA-AKG automatically downloads all incoming media synchronously using downloadMediaMessage (Baileys) and stores it in /data/media BEFORE firing the webhook. The webhook payload contains a ileUrl pointing to the local path which can be served via the /download/[messageId]/media route.

## 4. Security Findings

*   **Tenant Isolation**: **HIGH CONFIDENCE**.
    *   Route: src/app/api/messages/[sessionId]/[jid]/send/route.ts
    *   Logic: It calls wait canAccessSession(user.id, user.role, sessionId);.
    *   File: src/lib/api-auth.ts.
    *   Result: Tenant A cannot access Tenant B's session unless explicitly shared via the SessionAccess table or if Tenant A is a SUPERADMIN.
*   **API Authentication**: **HIGH CONFIDENCE**.
    *   Uses x-api-key header to look up the User in Prisma before authorizing API calls.

## 5. Webhook Reliability

*   **Implementation**: src/lib/webhook.ts
*   **Timeout**: Hardcoded to 10 seconds (AbortSignal.timeout(10000)).
*   **Retries**: **NONE**. If etch(url) throws or fails, it catches the error, logs it, and moves on.
*   **Idempotency**: No idempotency keys are sent in the header.
*   **Failed Events**: If Dial Mate is offline or returns 500, the event is permanently lost from the webhook perspective. (It is logged in WebhookLog table, but no auto-retry mechanism exists).

## 6. Session Architecture

*   **In-Memory Mapping**: **HIGH CONFIDENCE**.
    *   File: src/modules/whatsapp/manager.ts.
    *   Class WhatsAppManager holds private sessions: Map<string, WhatsAppInstance> = new Map();.
*   **Persistence**: Process restarts are safe because the Baileys auth credentials are saved in the Prisma AuthState table. The QR code does not need to be scanned again.

## 7. Scalability

*   **Claim**: "Expect instability beyond 100-200 concurrent active WhatsApp sessions."
*   **Fact Check**: This claim **cannot be definitively proven** without a load test, but it is structurally grounded. Because manager.ts uses an in-memory Map, all Baileys sockets for a given instance must live in the same Node.js heap.
*   **Horizontal Scaling**: **IMPOSSIBLE AS-IS**. Two Node processes cannot share active Baileys WebSocket connections. If you put WA-AKG behind a standard Round Robin load balancer, an API request for Session A might hit Container B, which does not have Session A in its memory map.
*   **Required Changes for Scaling**: You would need a Sticky Session load balancer (Session Affinity) based on the sessionId URL parameter, or a Redis Pub/Sub backplane to route API commands to the specific container holding the socket. Neither exists in the source code.

## 8. Voice/Media Compatibility

*   **Incoming Voice Message**:
    1.  Message arrives at Baileys (instance.ts).
    2.  webhook.ts intercepts it and calls downloadAndSaveMedia().
    3.  Baileys downloads the buffer; it is saved to /data/media/sessionId-messageId.ext.
    4.  dispatchWebhook fires with ileUrl populated.
*   **Outgoing Voice Message**:
    1.  Dial Mate POSTs an audio buffer/Base64 to /api/messages/[sessionId]/[jid]/media with 	ype="voice".
    2.  chat.service.ts converts this to { audio: buffer, mimetype: 'audio/mp4', ptt: true }.
    3.  Baileys sends it as a native voice note.
*   **Compatibility**: **HIGH CONFIDENCE**.

## 9. Meta/WhatsApp Platform Considerations

*   **Ban Risk**: The claim "Meta actively detects and permanently bans phone numbers using unofficial APIs" is an **OPERATIONAL RISK** based on community consensus, not a technical fact found in the source code. Baileys inherently violates WhatsApp's Terms of Service.
*   **Messaging Restrictions**: As an unofficial API, WA-AKG bypasses the official 24-hour customer service window and template requirements.

## 10. Dial Mate Compatibility

*   **Architecture Matching**: WA-AKG requires Prisma/Next.js. Dial Mate is Express/Node.
*   **Redis/BullMQ**: WA-AKG has NO Redis or BullMQ integration.
*   **Deployment**: WA-AKG **MUST** be deployed as a separate service/container. It cannot simply be imported into the Dial Mate Express server without severe refactoring.

## 11. Required Changes

If integrating with Dial Mate:
1.  **Deploy as Microservice**: Run WA-AKG in its own Docker container alongside the Dial Mate API.
2.  **Dial Mate Queue Layer**: Dial Mate MUST instantly acknowledge WA-AKG webhooks with 200 OK and push the payload into BullMQ for asynchronous Gemini Live processing. If Dial Mate blocks the webhook for AI generation, WA-AKG's 10-second timeout will trip.
3.  **Webhook Internal Network**: WA-AKG webhooks should target Dial Mate's internal Docker IP (e.g., http://dialmate:3000/webhook) rather than the public internet for security and speed.

## 12. Remaining Unknowns

*   Exact memory overhead per idle Baileys session in this specific Next.js/Prisma implementation (requires live benchmarking).

## 13. Recommended Architecture Boundary

**B. Deploy as a separate service.**
WA-AKG is a complete Next.js full-stack application. Stripping out its API routes to embed its WhatsApp Manager into Dial Mate's Express server would require rewriting half the codebase and breaking WA-AKG's own dashboard UI. It should be treated as an internal microservice, communicating with Dial Mate exclusively via internal REST APIs and Webhooks.
