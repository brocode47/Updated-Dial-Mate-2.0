# Dial Mate 2.0 — Comprehensive AI Conversational Agent Audit & Architectural Blueprint

**Document Version:** 1.0.0  
**Target Repository:** `brocode47/Updated-Dial-Mate-2.0`  
**Target Architecture:** Gemini Live Multimodal AI + Twilio Voice Media Streams  
**Shopify Target Store:** `0qwck2-s1.myshopify.com`  
**Date:** October 2026  

---

## Executive Summary

Dial Mate 2.0 has successfully implemented the foundational telephony and real-time streaming bridge pairing **Twilio Voice Media Streams** (`8kHz μ-law`) with **Google Gemini Live 2.0** (`PCM16`). Outbound calls connect, bidirectional WebSocket streams negotiate HMAC security tokens, and stateful audio transcoding functions as expected.

However, the conversational AI agent ("Zara") is currently heavily constrained by an **overly rigid, linear 5-step script** (`CallScriptEngine.compileGeminiSystemInstruction`), hardcoded dialog lines, a lack of factual store/order context (such as delivery address and shipping policies), missing transcript persistence on live calls, schema mismatches in tool declarations, and premature call termination. 

This audit details the exact code-level findings across the 20 audit criteria, identifies hallucination and safety risks, and provides a production-grade architectural blueprint for transitioning Zara into a true, dynamic, grounded conversational AI agent.

---

## 1. Current Architecture

```
                    ┌──────────────────────────────────────────────┐
                    │               Shopify Store                  │
                    │        (0qwck2-s1.myshopify.com)             │
                    └──────────────────────┬───────────────────────┘
                                           │ orders/create webhook
                                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Dial Mate Backend                           │
│                                                                  │
│  ┌──────────────────────┐         ┌───────────────────────────┐  │
│  │   webhookWorker.js   │ ───►    │ orderEligibilityService   │  │
│  │   (BullMQ Ingestion) │         │ (COD, E.164, Hours, Quota)│  │
│  └──────────┬───────────┘         └───────────────────────────┘  │
│             │ eligible                                           │
│             ▼                                                    │
│  ┌──────────────────────┐         ┌───────────────────────────┐  │
│  │    callWorker.js     │ ───►    │   callWorkflowService     │  │
│  │  (BullMQ Processor)  │         │ (Whitelist, Safety, Twilio│  │
│  └──────────────────────┘         └─────────────┬─────────────┘  │
│                                                 │                │
│                                                 │ Twilio REST API│
│                                                 ▼                │
└─────────────────────────────────────────────────┼────────────────┘
                                                  │
                                                  ▼
                                      ┌───────────────────────┐
                                      │  Twilio Voice Trunk   │
                                      │ (+1234... -> Phone)   │
                                      └───────────┬───────────┘
                                                  │
                                                  │ Webhook / Voice URL
                                                  ▼
┌──────────────────────────────────────────────────────────────────┐
│             Twilio Media Streaming Bridge (twilio.js)            │
│                                                                  │
│  1. GET/POST /twilio/voice ──► Generates TwiML <Connect><Stream> │
│  2. WSS /twilio/media      ──► Bidirectional WebSocket           │
│                                                                  │
│      Twilio 8kHz μ-law  ◄──[ AudioCodec ]──► Gemini 16/24kHz PCM16
│                                  │                               │
│                                  ▼                               │
│                       ┌─────────────────────┐                    │
│                       │      Agent.js       │                    │
│                       │ (@google/genai Live)│                    │
│                       └──────────┬──────────┘                    │
│                                  │                               │
│                                  ▼                               │
│                       ┌─────────────────────┐                    │
│                       │    dispatcher.js    │                    │
│                       │ (confirm/cancel/cb) │                    │
│                       └──────────┬──────────┘                    │
│                                  │                               │
│                                  ▼                               │
│                       ┌─────────────────────┐                    │
│                       │ OrderStateMachine.js│                    │
│                       │ (Shopify Tags & DB) │                    │
│                       └─────────────────────┘                    │
└──────────────────────────────────────────────────────────────────┘
```

### Key Architectural Files
- **Media Stream Handler:** [`app/server/src/routes/twilio.js`](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/server/src/routes/twilio.js)
- **Gemini Live Client:** [`app/server/src/integrations/ai/agent.js`](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/server/src/integrations/ai/agent.js)
- **Audio Transcoding:** [`app/server/src/utils/audioCodec.js`](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/server/src/utils/audioCodec.js)
- **Script & Prompt Engine:** [`app/server/src/services/callScriptEngine.js`](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/server/src/services/callScriptEngine.js) & [`prompts.js`](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/server/src/integrations/ai/prompts.js)
- **Tool Definitions & Dispatcher:** [`app/server/src/integrations/ai/tools.js`](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/server/src/integrations/ai/tools.js) & [`dispatcher.js`](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/server/src/integrations/ai/dispatcher.js)
- **Telephony Lifecycle:** [`app/server/src/services/callWorkflowService.js`](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/server/src/services/callWorkflowService.js)
- **Post-Call Intent & Analytics:** [`app/server/src/services/aiCallInterpretationService.js`](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/server/src/services/aiCallInterpretationService.js)

---

## 2. Answers to the 20 Specific Audit Questions

### Q1: Is Gemini Live currently being used for real-time audio conversation?
**Yes, architecturally, but blocked by environment and model naming.**
- **Code:** In [`twilio.js`](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/server/src/routes/twilio.js#L66-L188), Twilio connects to `/twilio/media` via WebSocket. Incoming 8kHz μ-law audio is transcoded to 16kHz PCM16 base64 by [`AudioCodec.twilioToGemini`](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/server/src/utils/audioCodec.js#L22-L52) and sent to Gemini Live via `agent.sendAudio()`. Returning audio is transcoded from 24kHz PCM16 to 8kHz μ-law and sent to Twilio.
- **Defects:**
  1. Production `.env.prod` has `GEMINI_API_KEY=your_gemini_api_key_here` (placeholder).
  2. In [`Agent.js` line 9](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/server/src/integrations/ai/agent.js#L9), the model string is `gemini-3.1-flash-live-preview`. The official Google GenAI Live models are `gemini-2.0-flash-exp` / `gemini-2.0-flash-realtime-exp`.

### Q2: Is Zara currently using a fixed script or a true free-form system instruction?
**A fixed script.**
- [`CallScriptEngine.compileGeminiSystemInstruction`](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/server/src/services/callScriptEngine.js#L55-L98) forces Zara into a rigid:
  - `Step 1: GREETING & IDENTITY CONFIRMATION`
  - `Step 2: ORDER REFERENCE`
  - `Step 3: PRODUCT & COD AMOUNT CONFIRMATION`
  - `Step 4: DELIVERY CONFIRMATION`
  - `Step 5: CLOSING`
- In [`twilio.js` line 178](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/server/src/routes/twilio.js#L178), Zara is initiated with:
  `"The customer ${customerName} has answered the phone call. Please speak your opening greeting now in Roman Urdu according to Step 1."`
  This prevents natural open-ended conversational flow.

### Q3: Does callScriptEngine.js constrain Zara too much?
**Yes, severely.**
- It assumes a compliant user who says nothing other than "Yes" or "No".
- It instructs: *"Keep every sentence short, punchy, and conversational (under 2 sentences per turn)."*
- It commands: *"If confirmed: Call the `confirm_order` tool immediately and say: 'Bohat shukriya! ... Allah Hafiz.'"*
- It lacks any guidance on answering customer inquiries regarding delivery dates, address verification, item sizing/color, open parcel policy, or order modifications.

### Q4: Are there hard-coded responses that should become dynamic AI responses?
**Yes.**
1. [`CallScriptEngine.generateOpening()`](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/server/src/services/callScriptEngine.js#L17-L30) (rigid opening string).
2. [`CallScriptEngine.generateClosing()`](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/server/src/services/callScriptEngine.js#L35-L50) (static closings for CONFIRMED, CANCELLED, CALL_BACK, WRONG_NUMBER).
3. Hardcoded TwiML prompts in [`twilio.js` /gather](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/server/src/routes/twilio.js#L230-L235).
4. Hardcoded drop/transfer messages in [`twilio.js` /media onClose](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/server/src/routes/twilio.js#L151-L158).

### Q5: Can Zara answer questions that are NOT explicitly listed in the current script?
**No.**
- Because no store policy, FAQ context, delivery times, or item variants are supplied, Zara either evades the question or hallucinates an answer (e.g. inventing delivery dates).

### Q6: Can Zara interrupt/handle customer interruptions correctly?
**Partially in telephony, broken in application lifecycle.**
- **Working:** Gemini Live emits `content.interrupted = true` in [`Agent.handleContent`](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/server/src/integrations/ai/agent.js#L75-L77), which calls `onClear()`, sending `{ event: 'clear', streamSid }` to Twilio to stop playing buffered audio.
- **Defects:**
  1. [`AudioCodec`](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/server/src/utils/audioCodec.js) has an internal polyphase resampler buffer that is never cleared on interruption.
  2. In [`twilio.js` lines 166-172](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/server/src/routes/twilio.js#L166-L172), once a tool like `confirm_order` executes, a 4-second hard timeout forcibly disconnects the WebSocket:
     ```javascript
     if (['request_human_transfer', 'confirm_order', 'cancel_order'].includes(toolName)) {
       setTimeout(() => { if (ws.readyState === 1) ws.close(); }, 4000);
     }
     ```
     If the customer interrupts during this 4-second window (e.g. *"Rukein! Address galat hai"*), the call hangs up regardless.

### Q7: Does the system preserve conversation context?
**During the live call session: Yes. Persistently or across drops: No.**
- Gemini Live maintains turns in its active WebSocket session.
- If the WebSocket drops or reconnects, context is 100% lost.
- No transcript is persisted to the database during or after live calls (see Q19).

### Q8: Can Zara access real order information?
**Partially at initialization; tool lookup is unguided.**
- **Initial:** Only `customerName`, `orderNumber`, first line item title (`productName`), and `productPrice` are passed in the initial prompt.
- **Missing from Prompt:** Full item list, item quantities, variant options (size/color), shipping address (street, city), shipping fees vs item cost, and customer note.
- **Tool:** `get_order` exists in [`tools.js`](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/server/src/integrations/ai/tools.js#L2-L12), but the system prompt never explains to Zara that `get_order` exists or when to invoke it.

### Q9: Can Zara access real product information?
**No.**
- There is NO `get_product` or catalog query tool in [`tools.js`](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/server/src/integrations/ai/tools.js).
- If a customer asks about product specifications (e.g., fabric, dimensions, warranty), Zara has zero access to product data.

### Q10: Can Zara safely answer delivery/payment questions?
**No.**
- **Payment:** Zara knows the total COD price, but does not know if delivery charges are included or free.
- **Delivery:** Zara does not have the customer's delivery city or address in her context, nor does she have store shipping SLA rules (e.g., "3-5 business days via PostEx/Trax").

### Q11: Can Zara invoke tools/functions during the conversation?
**Yes.**
- Implemented in [`Agent.handleToolCall`](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/server/src/integrations/ai/agent.js#L89-L127) and passed back to Gemini Live via `sendRealtimeInput([{ toolResponses }])`.

### Q12: Are function calls actually connected to PostgreSQL/Shopify actions?
**Yes.**
- [`dispatcher.js`](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/server/src/integrations/ai/dispatcher.js) connects:
  - `confirm_order`: Sets Prisma status to `Confirmed`, adds Shopify tag `COD_CONFIRMED`.
  - `cancel_order`: Sets Prisma status to `Cancelled`, adds Shopify tag `COD_CANCELLED`, calls Shopify cancel API.
  - `schedule_callback`: Enqueues BullMQ delayed job on `callQueue`.
  - `request_human_transfer`: Sets status to `Human Transfer`, adds Shopify tag `HUMAN_REVIEW_NEEDED`.

### Q13: Can Zara handle CONFIRMED/CANCELLED/CALL_BACK/WRONG_NUMBER safely?
**Currently unsafe.**
- In the live prompt, any generic affirmation word triggers immediate `confirm_order` and disconnects.
- In [`AICallInterpretationService.js`](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/server/src/services/aiCallInterpretationService.js#L106-L170), keyword matching has no negation awareness:
  - *"Main order cancel nahi karna chahta"* &rarr; triggers `CANCELLED` because `cancel` is in `rejectPatterns`.
  - *"Nahi confirm karna"* &rarr; triggers `CONFIRMED` because `confirm` is in `confirmPatterns`.

### Q14: What happens when confidence is low?
- In `aiCallInterpretationService.js`, low confidence (< 0.85) defaults to `UNKNOWN`, which triggers safe retry or merchant review.
- In the live Gemini Live conversation, Zara has NO instructions on asking for clarification when speech is noisy, mumbled, or unclear.

### Q15: What happens when the customer asks something unknown?
- Zara has no negative constraints or fallback rules in her prompt. She is prone to hallucinating plausible-sounding store policies.

### Q16: What happens when the customer asks a question unrelated to the order?
- Zara has no conversational boundary rules. She lacks instructions to politely decline off-topic queries and steer back to the order verification.

### Q17: What happens when the customer refuses to answer the expected script question?
- Because Zara is constrained by the 5-step script, she either blindly repeats Step 4 ("Kya aap is order ko confirm karte hain...") or becomes unhelpful.

### Q18: What happens when the customer changes the subject?
- The linear script structure breaks down because Zara is not given an instruction architecture that permits answering side-questions before seeking confirmation.

### Q19: Is transcript saved?
**NO.**
- In [`Agent.js`](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/server/src/integrations/ai/agent.js#L72-L87), text turns are never captured.
- In [`twilio.js`](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/server/src/routes/twilio.js#L144-L163), `onClose` does not store any transcript.
- Consequently, `Call.transcript` in PostgreSQL remains `NULL` on live calls, leaving the frontend inspector ([`CallsPage.jsx`](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/src/pages/CallsPage.jsx#L717-L730)) empty.

### Q20: Is the complete conversation available to the model during the call?
- Within a single active WebSocket session: Yes.
- Across disconnections or post-call: No.

---

## 3. Detailed Component Flaws & Blocker Analysis

### 3.1 Script Rigidity vs. Free-Form Conversational Agent
The current prompt in `callScriptEngine.js` treats Gemini Live as a dynamic IVR rather than an intelligent persona:
```
Current Prompt Flaw:
Step 1: GREETING -> Step 2: ORDER -> Step 3: PRICE -> Step 4: CONFIRM -> Step 5: CLOSE
```
If a customer answers:
*"Ji main Ali hoon, lekin pehle ye batao delivery kitne din mein hogi aur parcel khol ke check kar sakte hain?"*
Zara currently fails because:
1. She is forced to advance through Steps 2 and 3 before addressing the customer's immediate question.
2. She has no information on whether open-parcel delivery is allowed.

### 3.2 Tool Declaration & Schema Discrepancy
| Tool Name | Declared in `tools.js` | Expected in `dispatcher.js` | Impact |
| :--- | :--- | :--- | :--- |
| `schedule_callback` | `{ reason: STRING, requestedTime: STRING }` | `{ orderId: STRING, reason: STRING, delay_minutes: NUMBER }` | **Validation Failure:** If Gemini sends `requestedTime`, Zod validation in `dispatcher.js` fails or defaults `delay_minutes` to 15m. |
| `get_order` | Declared | Not mentioned in system prompt | Model never invokes `get_order`. |
| `get_product` | **Missing** | **Missing** | Model cannot look up product specifications. |

### 3.3 Premature Disconnect on Terminal Actions
In `app/server/src/routes/twilio.js`:
```javascript
onToolExecuted: (toolName, result) => {
  if (['request_human_transfer', 'confirm_order', 'cancel_order'].includes(toolName)) {
    setTimeout(() => {
      if (ws.readyState === 1) {
        ws.close();
      }
    }, 4000); // 4 seconds for goodbye message
  }
}
```
**Why this is dangerous:**
If the customer says: *"Haan confirm kar do, lekin suno address change karna hai"* (Yes confirm, but listen, I need to change address), the model might immediately execute `confirm_order`. The 4-second timer starts, and when the customer speaks about the address change, the call abruptly hangs up.

### 3.4 Missing Live Transcript Pipeline
In `Agent.js`:
```javascript
handleContent(response) {
  const content = response?.serverContent;
  if (content?.interrupted) this.onClear();
  if (content?.modelTurn?.parts) {
    for (const part of content.modelTurn.parts) {
      if (part.inlineData) this.onAudioOut(part.inlineData.data);
      // BUG: part.text is completely ignored!
    }
  }
}
```
Furthermore, the client config does not request real-time user transcription or store turn-by-turn dialogue into an accumulated transcript buffer.

---

## 4. Redesigned System Prompt Architecture

The system prompt must be restructured from a linear 5-step script into a comprehensive **behavioral and factual specification**:

```
┌─────────────────────────────────────────────────────────────┐
│ 1. ROLE & PERSONA                                           │
│    - Female AI representative "Zara" for [Shop Name]        │
│    - Professional, warm, respectful Pakistani commerce tone│
├─────────────────────────────────────────────────────────────┤
│ 2. AVAILABLE REAL DATA (Injected Context)                   │
│    - Customer name & phone                                  │
│    - Order number & itemized line items with variant details│
│    - Total COD price, subtotal, and shipping fee breakdown  │
│    - Shipping street address, city, and province            │
│    - Store delivery SLA (e.g. 3-5 business days)            │
│    - Store return & open-parcel policy                      │
├─────────────────────────────────────────────────────────────┤
│ 3. PRIMARY OBJECTIVE                                        │
│    - Verify the customer placed the COD order               │
│    - Address customer's questions factually                 │
│    - Obtain definitive confirmation or cancellation         │
├─────────────────────────────────────────────────────────────┤
│ 4. CONVERSATIONAL RULES                                     │
│    - Answer the customer's question FIRST before asking     │
│      for confirmation                                       │
│    - Support natural Roman Urdu, Urdu, English, & code-mix  │
│    - Max 2 concise sentences per turn                       │
│    - Clarify muffled or unclear audio politely              │
├─────────────────────────────────────────────────────────────┤
│ 5. SAFETY & GROUNDING (Anti-Hallucination)                  │
│    - Never invent prices, dates, discounts, or policies     │
│    - If info is unavailable, admit it and offer callback    │
│    - Never execute confirm/cancel on uncertain statements   │
│      ("shayad", "dekh kar bataunga", "soch raha hoon")      │
├─────────────────────────────────────────────────────────────┤
│ 6. TOOL INVOCATION RULES                                    │
│    - `confirm_order`: ONLY upon explicit, unambiguous intent│
│    - `cancel_order`: ONLY upon explicit cancellation demand │
│    - `schedule_callback`: When busy, driving, or requested  │
│    - `request_human_transfer`: On anger, dispute, or demand │
│    - `get_order`: If customer asks about order details      │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Tool Safety & Guardrails Specification

### State Machine Transition Rules
```
                    ┌─────────────────────────┐
                    │  Pending Confirmation   │
                    └────────────┬────────────┘
         ┌───────────────────────┼───────────────────────┐
         │ Explicit              │ Explicit              │ Customer asks
         │ "Confirm/Bhej do"     │ "Cancel/Nahi chahiye" │ for human/dispute
         ▼                       ▼                       ▼
┌─────────────────┐     ┌─────────────────┐     ┌──────────────────┐
│    CONFIRMED    │     │    CANCELLED    │     │  HUMAN_REQUIRED  │
│ (Tag: Confirmed)│     │ (Tag: Cancelled)│     │ (Tag: Review)    │
└─────────────────┘     └─────────────────┘     └──────────────────┘
```

### Action Gate Matrix
| Customer Utterance | Intent | Tool Action | Allowed State Change? |
| :--- | :--- | :--- | :--- |
| "Jee bilkul order confirm kar dein" | Unambiguous Yes | `confirm_order` | **Yes** &rarr; `Confirmed` |
| "Bhej dein, main wait kar raha hoon" | Unambiguous Yes | `confirm_order` | **Yes** &rarr; `Confirmed` |
| "Nahi mujhe nahi chahiye, cancel kardo" | Unambiguous No | `cancel_order` | **Yes** &rarr; `Cancelled` |
| "Ghalti se order ho gaya tha" | Unambiguous No | `cancel_order` | **Yes** &rarr; `Cancelled` |
| "Abhi driving kar raha hoon, baad me call karein" | Busy / Callback | `schedule_callback` | **No** (Remains pending, job queued) |
| "Main kal shaam ko available hunga" | Specific Callback | `schedule_callback` | **No** (Remains pending, job queued) |
| "Ghalat number dial kiya hai aap ne" | Wrong Number | `cancel_order` (wrong_number) | **Yes** &rarr; `Cancelled` |
| "Shayad cancel kar doon" | Hesitant / Uncertain | **None** (Ask clarifying question) | **NO** |
| "Main cancel nahi karna chahta, confirm karo" | Negated Rejection | `confirm_order` | **Yes** &rarr; `Confirmed` |
| "Nahi confirm karna" | Negated Confirmation | `cancel_order` | **Yes** &rarr; `Cancelled` |
| "Aap ki company chor hai, manager se baat karao" | Escalation | `request_human_transfer` | **Yes** &rarr; `Human Transfer` |

---

## 6. Telephony & Real-Time Audio Engine Specification

### Latency & Buffering Optimization
1. **Model Selection:** Use official real-time model `gemini-2.0-flash-exp` (or `gemini-2.0-flash-realtime-exp`) via `@google/genai`.
2. **Audio Resampler Buffer Flushing:** When Gemini emits `interrupted: true`, immediately:
   - Send `{ event: 'clear', streamSid }` to Twilio.
   - Reset `outboundResampler` internal state in `AudioCodec` to prevent residual buffer playback.
3. **Turn-Taking & Barge-In:**
   - Configure Gemini Live voice activity detection (VAD) with sensitivity tailored to mobile telephony noise.
4. **Natural Goodbye & Graceful Hangup:**
   - Do NOT immediately kill the WebSocket on tool execution.
   - Wait for Gemini to finish speaking its natural concluding turn (`turnComplete: true`), then gracefully close after a 1.5-second buffer or let the customer hang up.

---

## 7. 25-Point Verification Test Matrix

A comprehensive automated test suite (`app/server/tests/ai-conversational-agent.test.js`) must be implemented covering:

| # | Test Scenario | Utterance Example | Expected Intent | Expected Tool / Action | Safe Guardrail Verified |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | Standard Confirmation | "Jee haan, bilkul confirm hai." | `CONFIRMED` | `confirm_order` | Status updated to Confirmed |
| 2 | Natural Colloquial Yes | "Bhej do bhai, intezar hai." | `CONFIRMED` | `confirm_order` | Status updated to Confirmed |
| 3 | Natural Cancellation | "Nahi yaar, mera irada badal gaya hai, cancel kar dein." | `CANCELLED` | `cancel_order` | Status updated to Cancelled |
| 4 | Busy / Driving Callback | "Main abhi driving kar raha hoon, 1 ghante baad call karna." | `CALL_BACK` | `schedule_callback` (60m) | Order remains pending; job queued |
| 5 | Wrong Number | "Aap ne kisi ghalat number par call ki hai, maine order nahi kiya." | `WRONG_NUMBER` | `cancel_order` (wrong_number) | Tagged Invalid Phone |
| 6 | Product Inquiry | "Is order mein kon sa color shamil hai?" | Inquiry | Answers from real line-item variant | No state change |
| 7 | Price Breakdown Inquiry | "Is mein delivery charges kitne hain?" | Inquiry | Explains subtotal vs shipping fee | No state change |
| 8 | Quantity Inquiry | "Maine kitne piece mangwaye the?" | Inquiry | Answers exact quantity from data | No state change |
| 9 | Delivery SLA Inquiry | "Delivery kitne din mein hogi?" | Inquiry | States store SLA (e.g. 3-5 days), does not invent date | No state change |
| 10 | Payment / COD Inquiry | "Kya main card se pay kar sakta hoon?" | Inquiry | Explains COD cash policy factually | No state change |
| 11 | Address Verification | "Mera address kya likha hai aap ke paas?" | Inquiry | Reads injected shipping address | No state change |
| 12 | Call Purpose / Origin Inquiry | "Aap ko mera number kahan se mila?" | Inquiry | Explains call is regarding Shopify order on Sunday Bazaar | No state change |
| 13 | Interruption / Barge-in | Customer speaks mid-sentence: "Suno ek minute!" | Interruption | Emits `onClear`, Twilio buffer cleared | No state change |
| 14 | Topic Switching | "Haan theek hai... wese aap ki shop kahan par hai?" | Side-Question | Answers shop location, circles back | No premature disconnect |
| 15 | Roman Urdu Utterance | "Bohat shukriya, bhej dein kal tak." | `CONFIRMED` | `confirm_order` | Natural Roman Urdu response |
| 16 | Pure Nastaliq Urdu | "جی بالکل، میرا آرڈر کنفرم کر دیں۔" | `CONFIRMED` | `confirm_order` | Detects Urdu, responds naturally |
| 17 | English Utterance | "Yes please, go ahead and dispatch it." | `CONFIRMED` | `confirm_order` | Responds in fluent English |
| 18 | Code-Switching (Urdish) | "Yes sure, mera order confirm kar dein please." | `CONFIRMED` | `confirm_order` | Seamless bilingual turn |
| 19 | Muffled / Unclear Response | "(muffled static noise / inaudible)" | `UNKNOWN` | Zara asks for polite clarification | Does NOT confirm or cancel |
| 20 | Hesitant / Low Confidence | "Hmm... pata nahi... shayad main kal bataun." | `HESITANT` | Does not execute destructive tool | Order remains pending |
| 21 | Refusal to Answer Script | "Main ye sawal ka jawab nahi doonga." | Non-compliant | Zara explains why verification is needed politely | No hangup |
| 22 | Unsupported Policy (Open Parcel) | "Kya main rider ke samne parcel khol kar check kar sakta hoon?" | Policy Question | States store policy truthfully; no hallucination | No false promises |
| 23 | Off-Topic / Unrelated Question | "Aaj mausam kaisa hai aap ke shehar mein?" | Out of Scope | Politely declines, steers back to order | Preserves professional boundary |
| 24 | Demand for Human Agent | "Mujhe kisi manager se baat karni hai abhi!" | `HUMAN_TRANSFER` | `request_human_transfer` | Transitions to Human Transfer |
| 25 | Do Not Call / Angry Refusal | "Mujhe dobara kabhi call mat karna! Fraud log ho!" | `DO_NOT_CALL` | `cancel_order` + tags DNC | Escalates to merchant review |

---

## 8. Files Requiring Modification & Remediation Plan

| Component | Target File | Nature of Change |
| :--- | :--- | :--- |
| **System Instruction Engine** | [`app/server/src/services/callScriptEngine.js`](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/server/src/services/callScriptEngine.js) | Replace rigid 5-step script with full Role, Context, Policy, and Dynamic Dialogue engine. |
| **AI Client & Model** | [`app/server/src/integrations/ai/client.js`](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/server/src/integrations/ai/client.js) & [`agent.js`](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/server/src/integrations/ai/agent.js) | Update model to valid real-time Gemini Live model (`gemini-2.0-flash-exp`). Capture text turns for transcript persistence. |
| **Tool Contracts** | [`app/server/src/integrations/ai/tools.js`](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/server/src/integrations/ai/tools.js) & [`dispatcher.js`](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/server/src/integrations/ai/dispatcher.js) | Align `schedule_callback` schema (`delay_minutes`), add `get_order_details` tool context. |
| **Telephony WebSocket** | [`app/server/src/routes/twilio.js`](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/server/src/routes/twilio.js) | Pass complete order context (address, items, SLA), accumulate live transcript, eliminate 4s premature drop, save transcript to DB on close. |
| **Audio Resampling** | [`app/server/src/utils/audioCodec.js`](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/server/src/utils/audioCodec.js) | Add `reset()` / buffer flush method on interruption. |
| **Post-Call NLP Classifier** | [`app/server/src/services/aiCallInterpretationService.js`](file:///C:/Users/engra/.gemini/antigravity-ide/scratch/Updated-Dial-Mate-2.0/app/server/src/services/aiCallInterpretationService.js) | Add negation detection ("cancel nahi", "confirm nahi") to prevent inverted classifications. |
| **Automated Test Suite** | `app/server/tests/ai-conversational-agent.test.js` | Implement full 25-point automated verification suite. |

---

## 9. Conclusion & Next Step

The architecture of Dial Mate 2.0 has the right foundation (Twilio WebSocket streaming, audio resampling, BullMQ queues, and Prisma database state tracking). However, the agent's behavior has been artificially crippled by rigid 5-step script prompts and brittle keyword rules. 

Implementing the architectural redesign specified above will give Zara the conversational agility of a human representative while maintaining 100% deterministic safety and zero hallucination risk.

**Awaiting user review before proceeding with implementation.**
