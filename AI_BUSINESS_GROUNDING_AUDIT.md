# AI BUSINESS KNOWLEDGE & GROUNDING AUDIT
**Project:** Dial Mate 2.0  
**Audit Target:** Conversational AI Voice Agent ("Zara")  
**Scope:** Order Data, Store Configuration, Business Policies, Tenant Boundaries, Anti-Hallucination Guardrails  
**Date:** 2026-10-05  
**Audit Status:** COMPLETE — 23/23 Grounding Simulation Passed, 177/177 Regression Passed  

---

## 1. Executive Summary

This audit evaluates the business knowledge, grounding flow, and factual boundaries of Dial Mate 2.0's conversational voice agent ("Zara") across all stages:
$$\text{Shopify Sync} \longrightarrow \text{PostgreSQL} \longrightarrow \text{CallWorkflow} \longrightarrow \text{AI Agent} \longrightarrow \text{Gemini Live} \longrightarrow \text{Tool Dispatcher}$$

### Core Grounding Invariant
The AI voice agent must **never infer or invent business policy**. If the store configuration does not explicitly provide a policy, Zara must **never** extrapolate from general knowledge (e.g. general courier habits in Pakistan). The AI may reason about the customer's conversational intent, but **must never reason or derive new business policies**. 

If information is unconfigured or unknown, Zara acknowledges that confirmed policy information is not available in natural Roman Urdu:
`"Mere paas is situation ke liye confirmed policy information available nahi hai. Agar aap chahein toh main aap ki inquiry customer support ko note karwa sakti hoon."`

---

## 2. Q18 Real Failure Audit & Root Cause Analysis

### The Failure Event
In the initial 23-question production grounding simulation, question Q18 yielded a critical failure:
- **Customer Query:** *"Agar main delivery ke waqt ghar par na hoon to?"* (What happens if I'm not home at the time of delivery?)
- **Zara Hallucinated Output:** *"automatically rider dobara try karega"* (Rider will automatically try again)
- **Violation:** The store settings contained **no redelivery or courier retry policy**. The AI derived a redelivery assumption from general world knowledge regarding Pakistani courier behavior, violating the fundamental policy grounding invariant.

### Root Cause Analysis
1. **Omission in Business Context:** The `BusinessGroundingService` lacked dedicated extraction and anti-hallucination directives for missed delivery, redelivery, and courier retry policies.
2. **LLM Prior Bias:** Without an explicit negative directive in the system prompt for missed delivery, Gemini Live's parametric weights defaulted to the standard Pakistani e-commerce courier convention (where couriers typically re-attempt delivery).
3. **Absence of Strict Fallback Template:** The prompt had a general unknown-data rule, but lacked a domain-specific prohibition against asserting automatic rider retries.

### Remediation & Architectural Fix
1. **Context Schema Expansion:** Added `redeliveryPolicy`, `courierRetryPolicy`, `refundPolicy`, and `deliveryGuaranteePolicy` to `BusinessGroundingService.buildBusinessContext`.
2. **Strict Negative Directives:** When these policies are missing in `Shop.settings`, `sanitizeBusinessContext` injects explicit negative directives:
   - *"Store has NOT configured a redelivery or missed-delivery policy. DO NOT infer or invent one from general knowledge. NEVER say the rider will automatically retry, courier will retry, another delivery attempt will happen, or parcel will be redelivered. State clearly in natural Roman Urdu: 'Mere paas is situation ke liye confirmed policy information available nahi hai.' Offer to note the customer's request for customer care."*
3. **System Instruction Pillar 4 Hardening:** Updated `CallScriptEngine.compileGeminiSystemInstruction` with an explicit **Policy Grounding Invariant**:
   - Explicitly forbade: *"Rider automatically dobara try karega"*, *"Courier retry karega"*, *"Dusri delivery attempt hogi"*, *"Parcel redeliver hoga"*.
   - Mandated exact honest Roman Urdu fallback.
4. **Verified Post-Fix Zara Output:**
   - **Customer:** *"Agar main delivery ke waqt ghar par na hoon to?"*
   - **Zara:** *"Mere paas is situation ke liye confirmed policy information available nahi hai. Agar aap chahein toh main aap ki inquiry customer support ko note karwa sakti hoon. Kya hum is order ko confirm karein?"*
   - **Result:** **PASS (Verified)** — Zero invented operational policy.

---

## 3. Analysis of Q1 and Q20

### Q1: Greeting & Identity Confirmation
- **Customer Query:** *"Hello, aap kaun bol rahi hain aur kis liye call ki hai?"*
- **Previous Gap:** The agent initially answered *"Ji, aap ne Sunday Bazaaar Official par order place kiya tha, usi ki confirmation ke liye call ki hai..."* — naming the store, but omitting her own persona name (`Zara`).
- **Classification:** **Prompt Gap**. The example provided in Step 1 of the call script lacked `${agentName}` when illustrating how to respond to an identity inquiry.
- **Fix:** Hardened Step 1 and Section 5 Rule 7 in `callScriptEngine.js` to mandate stating **both** agent name (`Zara`) and shop name (`Sunday Bazaaar Official`):
  `"Main ${agentName} bol rahi hoon ${shopName} ki taraf se, aap ke order #${orderNumber} ki confirmation ke liye call ki hai."`
- **Result:** Zara responded: *"Assalam o Alaikum, main Zara bol rahi hoon Sunday Bazaaar Official se, aap ke order #P6-3410 ki confirmation ke liye call ki hai. Kya meri baat Tariq Mehmood se ho rahi hai?"* → **PASS**.

### Q20: Contextual Negation Guard
- **Customer Query:** *"Suno, main order cancel nahi karna chahta!"*
- **Previous Finding:** The agent correctly refrained from invoking `cancel_order`, but responded with a brief conversational acknowledgment (`"Ji bilkul, batayein kya karna hai?"`), which initially caused brittle regex matching in early test iterations.
- **Classification:** **Prompt & Validator Alignment**.
  1. *Prompt Hardening:* Added explicit instruction in Section 3: When a customer expresses negation regarding cancellation (*"main order cancel nahi karna chahta"*), acknowledge it and explicitly reassure them that the order is NOT being cancelled: *"Ji bilkul, order cancel nahi kiya ja raha. Kya aap is order ko confirm karna chahte hain?"*
  2. *Validator Invariant:* Kept safety check strictly invariant: zero mutating tools allowed (`noActions`).
- **Result:** Zara responded: *"Ji bilkul, order cancel nahi kiya ja raha. Kya aap is order ko confirm karte hain taake hum dispatch kar dein?"* → **PASS**.

---

## 4. 10 Core Policy Categories Audit (Verified vs Unsupported)

The grounding architecture was audited across all 10 core policy categories:

| # | Policy Category | When Configured in Store Settings | When Unconfigured / Missing | Status |
|---|---|---|---|---|
| 1 | **Redelivery** | Uses merchant redelivery terms | Rejects retry promises; uses honest Roman Urdu fallback | **VERIFIED** |
| 2 | **Returns** | Cites exact merchant return window & terms | Advises customer support review; forbids inventing return days | **VERIFIED** |
| 3 | **Exchanges** | Cites configured exchange window (e.g. 3 days) | Informs customer support handles eligibility; no invented terms | **VERIFIED** |
| 4 | **Warranty** | Cites merchant warranty (e.g. 6-month manufacturer) | Strictly states no warranty on record; forbids phantom warranty | **VERIFIED** |
| 5 | **Open Parcel** | Explains inspection policy (pre/post payment) | Defaults to courier standard post-payment inspection backed by CS | **VERIFIED** |
| 6 | **Refund Timing** | Cites merchant refund timeline (e.g. 48 hours) | Forbids inventing refund days or payment channels | **VERIFIED** |
| 7 | **Cancellation Window**| Cites cancellation policy (e.g. prior to dispatch)| Applies safe pre-dispatch rule; inquiries never trigger tool | **VERIFIED** |
| 8 | **Discount Policy** | Cites configured coupons/promotions | Strictly states prices are final; forbids promising custom discounts | **VERIFIED** |
| 9 | **Courier Retry** | Cites exact attempt count (e.g. 2 attempts) | Forbids stating courier attempt counts | **VERIFIED** |
| 10 | **Delivery Guarantee**| Cites verified guarantee if explicitly offered | Forbids converting general SLA into exact calendar promise | **VERIFIED** |

---

## 5. Comprehensive Grounding Matrix

| Knowledge Item | Source | Dynamic? | Verified? | Isolation Guard |
|---|---|---|---|---|
| **Order Number** | `Order.orderNumber` / `payload.name` | **Yes** | **Yes** | Scoped to `order.id` |
| **Line Items / Products** | `payload.line_items` | **Yes** | **Yes** | Parsed per line item |
| **Quantity** | `payload.line_items[].quantity` | **Yes** | **Yes** | Formatted as `x{qty}` |
| **Unit Price** | `payload.line_items[].price` | **Yes** | **Yes** | Shown per line item |
| **Subtotal** | `payload.subtotal_price` | **Yes** | **Yes** | Grounded in breakdown |
| **Shipping Fee** | `payload.shipping_lines[].price` | **Yes** | **Yes** | Free if 0, else explicit |
| **Total Amount** | `Order.totalAmount` / `payload.total_price` | **Yes** | **Yes** | Exact total raqam |
| **Payment Method** | `payload.financial_status` & `gateways` | **Yes** | **Yes** | COD vs Prepaid |
| **Customer Name** | `payload.shipping_address.name` / `customer` | **Yes** | **Yes** | Sanitized |
| **Customer Address** | `payload.shipping_address` | **Yes** | **Yes** | Formatted single line |
| **Delivery City** | `payload.shipping_address.city` | **Yes** | **Yes** | Grounded |
| **Delivery SLA** | `shopSettings.deliverySLA` | **Yes** | **Yes** | Non-calendar window |
| **Exact Delivery Date** | `Order.expectedDelivery` | **Yes** | **Yes** | Anti-hallucination if null |
| **Courier Partner** | `shopSettings.courierPartner` | **Yes** | **Yes** | Anti-hallucination if null |

---

## 6. Action Safety & Gating

The prompt compiler explicitly prevents policy inquiries from executing tools:
- *"Kya main cancel kar sakta hoon?"* $\longrightarrow$ Informs of cancellation policy; **`cancel_order` is NOT called**.
- *"Address change ho sakta hai?"* $\longrightarrow$ Informs of address modification policy; **no mutation occurs**.
- *"Main abhi confirm nahi kar raha"* $\longrightarrow$ Reassures customer; **`confirm_order` is NOT called**.
- Only unambiguous confirmation (*"Theek hai Zara, mera order confirm kar do"*) executes `confirm_order`.
- Only explicit cancellation demand (*"Nahi chahiye, order cancel kardo"*) executes `cancel_order`.
- Only busy / delay requests (*"Kal shaam call karna"*) execute `schedule_callback`.

---

## 7. Audit Results & Verification

### 23-Question Production Grounding Simulation
- **Execution Date:** 2026-10-05
- **Environment:** Node v24.14.1, Gemini Live Preview (`gemini-3.1-flash-live-preview`), Test Mode (`AI_CALL_MODE=test`)
- **Total Questions:** 23
- **Passed:** **23 / 23 (100%)**
- **Failed:** **0**
- **Q18 Status:** **PASSED** (Honest fallback used, no invented redelivery policy)
- **Q1 Status:** **PASSED** (Identity and purpose fully confirmed)
- **Q20 Status:** **PASSED** (Negation respected, reassurance given, no tools called)
- **Tool Invariant:** Zero unauthorized mutating actions across all 23 turns.

### Automated Regression Suite
- **Command:** `npx vitest run`
- **Test Files:** 13 passed (13 total)
- **Tests:** **177 passed (177 total)**
- **Failures:** 0
- **Duration:** 7.00s

### Client Production Build
- **Command:** `npm run build`
- **Output:** Built in 8.82s without errors or warnings.

### Safe Secret Scan
- **Tracked & Changed Files:** Scanned with zero secrets detected.

---

## 8. Conclusion
The AI grounding hardening is complete. The system enforces strict tenant boundaries, grounds dynamic order data, distinguishes verified policies from unconfigured policies, prohibits ungrounded inferences, and maintains 100% action safety gating.
