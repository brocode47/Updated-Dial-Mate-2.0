# Live AI Agent Latest Call Report — Order #1643

**Test Date/Time:** 2026-10-05 19:36–19:40 PKT (14:36–14:40 UTC)  
**Shop Domain:** `0qwck2-s1.myshopify.com` (`Sunday Bazaaar Official`)  
**Target Number:** `+923333255998`  
**Twilio From Number:** `+14354171092`  
**Twilio Call SID:** `CA74a37ea0a3a5c27d1d103dd976a4111b`  
**Internal Call Record ID:** `90dd5ae2-30d0-400e-afdc-0aa0d41b5721`  
**Call Duration:** 230 seconds (3 minutes 50 seconds)  
**Final Call Outcome:** `Confirmed`  
**Final Order State:** `Confirmed` (`tag: COD Confirmation Queued`)  
**Retry Count:** `0` (retained 0, exactly 0 retries scheduled)  
**Carrier Status:** `completed`  

---

## 1. Executive Summary

A full end-to-end outbound AI call was placed to `+923333255998` for Shopify Order `#1643` (Magnetic Nasal Dilator, Rs. 1,198 COD). 
The call successfully connected to Twilio Media Streams and Gemini Live 2.0 (`gemini-3.1-flash-live-preview`), maintaining continuous low-latency two-way conversational audio for nearly 4 minutes across more than 10 conversational turns.

The non-terminal Twilio status callback fix implemented immediately prior to this call was **100% successful**: Twilio delivered `initiated`, `ringing`, and `in-progress` webhooks, all of which updated telemetry without triggering premature retry increments or spurious BullMQ jobs. Exactly one outbound call was made, and `retryCount` remained at `0`.

---

## 2. Verified Test Results Matrix

### PASS (Working as Intended)

| Feature / Invariant | Status | Evidence from Live Logs & Database |
| :--- | :---: | :--- |
| **Non-Terminal Status Callback Filtering** | **PASS** | `initiated`, `ringing`, and `in-progress` status callbacks were intercepted and logged as intermediate events. `handleCallResult()` was **NOT** invoked during call setup. |
| **Single Call & Zero Spurious Retries** | **PASS** | Exactly 1 carrier call SID (`CA74a37ea0a3a5c27d1d103dd976a4111b`) was generated. `retryCount` stayed at `0`. No duplicate BullMQ jobs were scheduled. |
| **Gemini Live WebSocket Connection** | **PASS** | Twilio Media Stream connected cleanly to `/twilio/media/.websocket`. Live session established using `AudioCodec` (16kHz PCM $\leftrightarrow$ 8kHz $\mu$-law). |
| **Real-time Two-Way Audio** | **PASS** | Customer speech was recognized and transcribed in real time. Agent audio streamed back with natural conversational cadence. |
| **Multi-Turn Conversational Capability** | **PASS** | Customer asked 10+ open-ended questions across Urdu, Hindi, and English. The agent maintained coherent conversational context throughout the 230-second duration. |
| **Business Grounding & Hallucination Prevention** | **PASS** | When customer asked for company name, agent accurately stated `"Sunday Bazaaar Official"`. When asked for delivery timeline, stated `"3 se 5 business days"`. When asked for boss's name, accurately stated lack of data rather than hallucinating. |
| **Out-of-Scope Product Query Handling** | **PASS** | When customer asked about an uncatalogued product ("chair protection cover") and its price, agent adhered strictly to policy: stating details are unavailable and offering customer support inquiry without inventing prices. |
| **Tool Execution During Live Call** | **PASS** | Both `request_human_transfer` and `confirm_order` tools executed successfully in-session against the active order record. |
| **Order Confirmation State Machine** | **PASS** | Upon explicit customer confirmation, `confirm_order` transitioned Order `#1643` status to `Confirmed`. Terminal status idempotency guard prevented state regressions on call completion. |
| **Complete Transcript Capture** | **PASS** | 2,774 characters of full multi-turn dialogue was recorded and persisted to PostgreSQL `Call.transcript`. |

---

### FAIL (Observed Defects During Call)

| Defect | Severity | Observed Behavior | Expected Behavior |
| :--- | :---: | :--- | :--- |
| **Voice Gender Mismatch** | High | Agent identified herself as "Zara" (female persona), but the synthesized voice emitted by Gemini Live sounded unmistakably **MALE**. | Synthesized voice must match the persona (female-sounding voice, e.g. Gemini prebuilt voice `Aoede` or `Kore`). |
| **No Telephony Call Termination on Goodbye** | High | Both Zara and customer exchanged "Allah Hafiz" / "Cut the call please" multiple times, but the telephony carrier call did **NOT** hang up. The customer had to remain on the line or manually disconnect. | Call should automatically terminate via Twilio REST disconnect or `<Hangup/>` once farewell exchange is complete. |
| **Human Handoff Incomplete** | Medium | Agent executed the `request_human_transfer` tool and told the customer she would connect them to customer support, but no actual PSTN transfer/dialing occurred on the active carrier call. | If human transfer is promised, either a SIP/PSTN transfer must be executed via Twilio `<Dial>` or the agent must clarify that support will call back later. |

---

### NEEDS FIX (Action Items for Future Session)

1. **Configure Explicit Female Voice in Gemini Live Config:**
   - In `app/server/src/integrations/ai/agent.js`, inject `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName` (`Aoede` or `Kore`) into `ai.live.connect` configuration.
2. **Deterministic Carrier Call Hangup:**
   - When a farewell/closing turn completes or customer says "Allah Hafiz" / "bye" / "cut the call", execute an explicit Twilio Call termination (`twilioClient.calls(callSid).update({ status: 'completed' })`) or close the WebSocket with carrier hangup trigger.
3. **Clarify or Bridge Human Transfer:**
   - Align spoken prompt with real capability: state clearly that human support will *call back* via phone/WhatsApp, OR trigger Twilio `<Dial>` to transfer to merchant support number.

---

## 3. Complete Verbatim Transcript from Live Call

```text
Zara: Assalam o Alaikum, main Zara bol rahi hoon Sunday Bazaaar Official se. Kya meri baat Test order se ho rahi hai?
Customer: आप कौन?
Zara: Main Zara bol rahi hoon Sunday Bazaaar Official se, aap ne order #1643 place kiya tha, usi ki tasdeeq ke liye call ki hai.
Customer: अच्छा लेकिन आवाज आपकी तो मद्धम सी है।
Zara: Maazrat chahti hoon agar aapko awaz mein masla aa raha hai. Kya hum order ki details confirm kar sakte hain?
Customer: जी, बताएं मुझे क्या ऑर्डर कराना है?
Zara: Aapke order mein Magnetic Nasal Dilator - Anti Snoring Kit valid 4 Sizes shamil hai aur total Cash on Delivery raqam Rs. 1198 hai. Kya main ise confirm kar doon? Order confirm
Customer: अगर मैं इसे कंफर्म करता हूं तो कितने टाइम में मुझे यह ऑर्डर रिसीव होगा?
Zara: hone ke 3 se 5 business days mein aapko delivery mil jayegi. Kya dispatch ke liye confirm kar doon?
Customer: आपके कंपनी का नाम क्या है?
Zara: Hamari company ka naam "Sunday Bazaaar Official" hai. Kya aap order confirm karte hain?
Customer: और आपके बॉस का नाम क्या है?
Zara: Is baare mein mere paas confirmed data available nahi hai. Kya hum order ki confirmation ki baat karein?
Customer: मुझे किसी रियल बंदे से बात करवाओ आप, से नहीं करनी बात मुझे।
Zara: Theek hai, main aapki baat customer support team se karwati hoon. Woh aapse rabta karein ge. Allah Hafiz.
Customer: TKL office
Zara: Bohat shukriya. Allah Hafiz.
Customer: Okay, Allah Hafiz. Cut the call, please.
Zara: Ji bilkul, Allah Hafiz.
Customer: Auf Wiedersehen. Bye.
Zara: Allah Hafiz.
Customer: भाई बंद करना यार, क्या कर रहा है?
Zara: Aapki baat main team se karwa rahi hoon, woh jald rabta karein ge. Allah Hafiz.
Customer: Okay, Allah Hafiz.
Zara: Allah Hafiz.
Customer: Baadshah na tum gaane sunte ho?
Zara: Main ek virtual assistant hoon, main gaane nahi sun sakti. Kya aapko koi aur masla hai order ke hawalay se?
Customer: तो मैं कितने बनाया है?
Zara: Mujhe Sunday Bazaaar Official ki team ne banaya hai taake main aap ke order ki confirmation mein help kar sakoon. Kya we confirm karein?
Customer: अच्छा मुझे मुझे और एक प्रोडक्ट भी चाहिए। चेयर प्रोटेクション कवर चाहिए मुझे तो वो मिल सकता है?
Zara: Chair protection cover hamari website par available ho sakta hai. Aap check kar sakte hain, ya agar aap chahein toh main is baare mein customer support se pooch sakti hoon. Kya order confirm kar dein?
Customer: मुझे पहले बता दें कि चेयर कोटेक एंड कवर अवेलेबल है आपके पास और कितने का है?
Zara: Is waqt mere paas chair protection cover ki availability aur price ki confirmed details nahi hain. Main aap ki inquiry customer support ko bhej sakti hoon. Kya hum abhi is order ko confirm karein?
Customer: जी, तो कंफर्म कर दें।
Zara: Bohat shukriya! Aap ka order confirm ho gaya hai aur jald dispatch kar diya jayega. Allah Hafiz.
Customer: اللہ حافظ
Zara: Allah Hafiz.
```

---

## 4. Current State Confirmation

- **Shopify Order:** `#1643`
- **Database Status:** `Confirmed`
- **Call Record Outcome:** `Confirmed`
- **Carrier Call SID:** `CA74a37ea0a3a5c27d1d103dd976a4111b`
- **Total Call Duration:** 230 seconds
- **Queue State:** 0 waiting, 0 delayed, 0 active
- **Production Server:** Healthy, all containers Up, retry bugfix active.
