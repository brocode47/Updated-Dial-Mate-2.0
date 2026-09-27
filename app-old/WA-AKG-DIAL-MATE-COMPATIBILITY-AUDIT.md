# WA-AKG DIAL MATE 2.0 COMPATIBILITY AUDIT
**Objective:** Evaluate WA-AKG as the WhatsApp Gateway/Provider for Dial Mate 2.0.
**Verification Type:** Strict Read-Only Source Code Audit.

## 1. EXECUTIVE SUMMARY
WA-AKG is a modern, feature-rich WhatsApp Web (Baileys) gateway built with Next.js 14 and Prisma. It implements robust session isolation for multi-tenancy and an extensive REST API for almost every WhatsApp feature.
However, **it is strictly a single-node application** and lacks background queuing for its Webhooks. It cannot scale horizontally. Integrating it with Dial Mate 2.0 is highly feasible and cost-effective, but requires wrapping it in a Docker container alongside Dial Mate and accepting the inherent risks of unofficial WhatsApp Web scraping (number bans) versus the official Meta Cloud API.

## 2. WA-AKG ARCHITECTURE
*   **Framework**: Next.js 16.1.1 (React 19) acting as both the frontend UI and the REST API backend.
*   **Language**: TypeScript.
*   **Node.js**: v20+ (via @types/node).
*   **Database / ORM**: Prisma (@prisma/client ^5.22.0).
*   **WhatsApp Library**: @whiskeysockets/baileys (^7.0.0-rc.9).
*   **WebSocket**: socket.io for UI state updates, NOT for client-side API streaming.
*   **Authentication**: Custom API Key validation (x-api-key) and NextAuth for the dashboard.
*   **Queues / Redis**: **None**. It relies entirely on in-memory mapping and 
ode-cron.
*   **Session Storage**: Stored inside the Database (AuthState model) making credentials persistent across restarts.

## 3. WHATSAPP FEATURES
Verified via src/modules/whatsapp/chat.service.ts and src/app/api/messages/...:
*   **Supported**: QR Login, Multi-session, Session persistence, Send/Receive Text, Images, Documents, Audio.
*   **Voice Messages (PTT)**: **Supported**. media/route.ts allows 	ype === 'voice' which maps to ptt: true in Baileys.
*   **Other features**: Groups, Contacts, Read Status, Typing presence.

## 4. API MAP
Key endpoints verified in src/app/api:
*   POST /api/sessions - Create a session.
*   GET /api/sessions/[sessionId]/qr - Get QR code for login.
*   POST /api/sessions/[sessionId]/[action] - Start/Stop session.
*   POST /api/messages/[sessionId]/[jid]/send - Send text.
*   POST /api/messages/[sessionId]/[jid]/media - Send media/audio/voice.
*   **Authentication**: Enforced via x-api-key header on all API routes (src/lib/api-auth.ts).

## 5. WEBHOOKS
Verified via src/lib/webhook.ts:
*   **Events**: message.received, message.sent, message.status, connection.update, etc.
*   **Implementation**: Dispatches using a raw etch(url) loop over registered endpoints.
*   **Delivery Guarantees**: **None (At-most-once)**. No retries, no idempotency keys, no queueing. If Dial Mate is down, the webhook event is permanently lost.
*   **Authentication**: Supports basic URL params, but lacks cryptographic signatures.

## 6. MULTI-TENANCY
Verified via src/lib/api-auth.ts \canAccessSession()\:
*   **Is it safe? YES.** 
*   Tenant A is bound to Session A via userId in the Session table.
*   The API enforces canAccessSession(user.id, user.role, sessionId).
*   Tenant A cannot access Tenant B's API, Webhooks, or Messages.
*   *Path: src/lib/api-auth.ts, src/app/api/messages/[sessionId]/[jid]/send/route.ts*

## 7. SESSION SCALABILITY
*   **Architecture**: Single Node.js Process.
*   **Mechanism**: src/modules/whatsapp/manager.ts uses an in-memory Map<string, WhatsAppInstance>.
*   **Bottleneck**: Because sessions are pinned to the local RAM of the running Node instance, you **cannot** run multiple WA-AKG Docker containers behind a load balancer. If an API request for Session A hits Container B, Container B will not have the Baileys socket in its memory map.
*   **Limit**: Expect instability beyond 100-200 concurrent active WhatsApp sessions on a standard VPS due to Baileys memory overhead.

## 8. SECURITY
*   **Authentication**: Good (UUID-based API keys).
*   **Tenant Isolation**: Good.
*   **Risks**: src/lib/webhook.ts executes arbitrary HTTP POSTs to user-defined URLs. This poses a Server-Side Request Forgery (SSRF) risk if users are allowed to input internal IPs (e.g., http://127.0.0.1:5432).

## 9. RELIABILITY
*   **Disconnects**: src/modules/whatsapp/instance.ts handles Baileys disconnects natively and automatically reconnects up to a defined limit.
*   **Storage**: Auth state is in Prisma (DB), so if the Docker container crashes, it resumes flawlessly without requiring re-scanning the QR code.
*   **Comparison**: Dial Mate uses Redis + BullMQ for robust job execution. WA-AKG lacks this entirely. A spike in incoming messages could choke the WA-AKG event loop.

## 10. DIAL MATE COMPATIBILITY
*   **Compatibility**: **HIGH**.
*   WA-AKG acts exactly as the clean provider boundary you specified.
*   Dial Mate's Webhook endpoint can parse the incoming WA-AKG JSON, map the sender to a Shopify customer, and route to the Gemini AI Agent dispatcher.
*   Dial Mate's Agent can respond by invoking an HTTP client targeting WA-AKG's /send or /media endpoints.

## 11. WHATSAPP VOICE MESSAGE FLOW
*   **Customer → WA-AKG**: Customer sends PTT. WA-AKG receives it.
*   **WA-AKG → Dial Mate**: WA-AKG fires webhook containing the media. *Wait! Baileys messages require media downloading.* WA-AKG provides an API to download media: GET /api/messages/[sessionId]/download/[messageId]/media.
*   **Dial Mate Processing**: Dial Mate downloads the .ogg file from WA-AKG, sends it to a Speech-to-Text API (or Gemini Multimodal).
*   **Dial Mate → WA-AKG**: Gemini generates text → Text-to-Speech (e.g. ElevenLabs) generates .mp3 → Dial Mate sends POST /api/messages/[sessionId]/[jid]/media with 	ype=voice.
*   **Conclusion**: **Technically Possible and Supported.**

## 12. PLATFORM / POLICY CONSIDERATIONS
*   WA-AKG uses **Baileys (WhatsApp Web Protocol)**.
*   **Technical**: Free, no per-conversation costs, supports arbitrary messaging without 24-hour template restrictions.
*   **Risk**: **CRITICAL**. Meta actively detects and permanently bans phone numbers using unofficial APIs. Using this for a multi-tenant SaaS transfers severe ban risk to your merchants. If a merchant's main business number gets banned, they will blame your SaaS.

## 13. COMPARE THREE OPTIONS
| Feature | WA-AKG (Baileys) | Wechaty | Meta Cloud API (Official) |
| :--- | :--- | :--- | :--- |
| **Cost per msg** | Free | Free | **Paid** (per conversation) |
| **Ban Risk** | **High** | **High** | **Zero** |
| **SaaS Scaling** | Single-node bound | Single-node bound | **Infinite (Stateless)** |
| **24h Rule** | No restrictions | No restrictions | **Strict Templates Required** |
| **Onboarding** | Scan QR Code | Scan QR Code | Complex Facebook Business Setup |
| **Complexity** | Medium | High | Low |

## 14. MISSING CAPABILITIES & REQUIRED CHANGES
If integrating WA-AKG into Dial Mate 2.0:
1.  **Webhook Queues**: You MUST build a queuing layer in Dial Mate to acknowledge WA-AKG webhooks immediately (return 200 OK), then process the AI generation asynchronously, otherwise WA-AKG will timeout.
2.  **SSRF Protection**: If users can input their own webhook URLs in the WA-AKG dashboard, restrict internal network access.
3.  **Media Bridge**: Dial Mate must implement the media download handshake to fetch voice notes from WA-AKG.

## 15. FINAL ASSESSMENT
**INTEGRATION POSSIBLE WITH REQUIRED CHANGES**
WA-AKG is structurally compatible and exposes the exact REST/Webhook interface needed by Dial Mate. It perfectly isolates tenants in the database. However, due to its single-node architecture and lack of webhook retries, Dial Mate must absorb the reliability burden (using its BullMQ queues). Furthermore, as an enterprise SaaS, you must accept the severe operational risk of Meta banning your merchants' numbers.
