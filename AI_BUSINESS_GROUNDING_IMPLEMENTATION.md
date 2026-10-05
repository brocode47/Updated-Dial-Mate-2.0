# Dial Mate 2.0 — Production Business Grounding & Safety Implementation

## Executive Summary
This document specifies the technical architecture, data grounding pipelines, tenant isolation invariants, anti-hallucination protocols, unknown information fallbacks, and deterministic validation suite implemented for Dial Mate 2.0's conversational voice agent ("Zara").

The grounding system ensures that the AI voice agent **never infers, deduces, or hallucinates business policy**. If the merchant store configuration does not explicitly provide a policy, Zara is strictly forbidden from extrapolating from general world knowledge (such as Pakistani courier retry habits).

---

## 1. Grounding Data Pipeline & Architecture

### High-Level Flow
```
Shopify Webhook / REST Sync
         ↓
PostgreSQL (Order, Shop, Customer)
         ↓
CallWorkflow (Worker / Queue)
         ↓
Twilio Inbound / Outbound Stream WebSocket
         ↓
BusinessGroundingService.buildBusinessContext({ order, shop, customer })
         ↓
BusinessGroundingService.sanitizeBusinessContext(rawContext, { tenantDomain })
         ↓
CallScriptEngine.compileGeminiSystemInstruction(sanitizedContext)
         ↓
Gemini Live Bidirectional Session (Zara)
         ↓
Action Safety Gating / Tool Dispatcher (Twilio Audio out)
```

### Component Roles
1. **`BusinessGroundingService.buildBusinessContext({ order, shop, customer })`**:
   - Parses the JSON `order.payload` (extracting items, quantities, unit prices, subtotal, shipping charges, discount codes, shipping address, city, province, zip, and payment gateway).
   - Dynamically determines payment mode (`Cash on Delivery (COD)` vs `Prepaid (Online)`) based on `financial_status` and `payment_gateway_names`.
   - Parses `shop.settings` for all 10 core policy categories:
     1. `redeliveryPolicy` / `missedDeliveryPolicy`
     2. `returnPolicy`
     3. `exchangePolicy`
     4. `warrantyPolicy`
     5. `openParcelPolicy` / `allowOpenParcel`
     6. `refundPolicy` / `refundTimingPolicy`
     7. `cancellationPolicy`
     8. `discountPolicy`
     9. `courierRetryPolicy`
     10. `deliveryGuaranteePolicy` / `deliveryGuarantee`
   - Sets negative directives when merchant data is absent so the AI never invents facts.

2. **`BusinessGroundingService.sanitizeBusinessContext(rawContext, { tenantDomain })`**:
   - Enforces strict multi-tenant boundary check: `rawContext.shopDomain === tenantDomain`. Raises fatal `TenantIsolationError` on mismatch.
   - Strips sensitive tokens (Shopify access tokens, API keys, webhook secrets, database credentials).
   - Ensures anti-hallucination directives are attached for missing business fields.

3. **`CallScriptEngine.compileGeminiSystemInstruction(sanitizedContext)`**:
   - Formats the 4 structural pillars of prompt grounding:
     - **SECTION 1: VERIFIED ORDER FACTS**
     - **SECTION 2: VERIFIED BUSINESS POLICIES**
     - **SECTION 3: SYSTEM CAPABILITIES & ACTION GATING**
     - **SECTION 4: UNKNOWN INFORMATION & POLICY GROUNDING INVARIANT**

---

## 2. The 4 Structural Pillars of Prompt Grounding

### SECTION 1: VERIFIED ORDER FACTS
Injects factual, verified order details from the database:
- Customer Name & Customer Phone
- Order Number (e.g. `#P6-3410`)
- Line Items (Titles, Variants, Quantities, Unit Prices)
- Pricing Breakdown (Subtotal, Delivery Fee, Total COD raqam)
- Payment Method (COD vs Prepaid Online)
- Shipping Address & Destination City
- Exact Delivery Date Directive

### SECTION 2: VERIFIED BUSINESS POLICIES
Cites only policies explicitly configured by the merchant in `Shop.settings`. If a policy is unconfigured, it is explicitly marked as `NOT CONFIGURED / UNKNOWN` and carries an anti-hallucination instruction.

### SECTION 3: SYSTEM CAPABILITIES & ACTION GATING
Establishes strict gating between conversational inquiries and action tool calls:
- **Inquiries Are Not Commands:**
  - *"Kya main cancel kar sakta hoon?"* $\longrightarrow$ Informs of cancellation policy; **`cancel_order` is NOT called**.
  - *"Address change ho sakta hai?"* $\longrightarrow$ Informs of address change policy; **no mutation occurs**.
  - *"Main abhi confirm nahi kar raha"* $\longrightarrow$ Reassures customer; **`confirm_order` is NOT called**.
- **Zero Tolerance for Negation Inversion:**
  - *"Cancel nahi karna"* / *"Cancel mat karna"* / *"Main cancel nahi keh raha"* $\longrightarrow$ Reassures customer that order is NOT cancelled; never calls `cancel_order`.
  - *"Confirm nahi karna"* / *"Abhi confirm nahi kar sakta"* $\longrightarrow$ Never calls `confirm_order`.
- **Tool Invocations:**
  - Only unambiguous confirmation (*"Theek hai Zara, mera order confirm kar do"*) calls `confirm_order`.
  - Only explicit cancellation demand (*"Nahi chahiye, order cancel kardo"*) calls `cancel_order`.
  - Only callback requests (*"Kal shaam call karna"*) call `schedule_callback`.

### SECTION 4: UNKNOWN INFORMATION & POLICY GROUNDING INVARIANT
Enforces the fundamental policy grounding invariant:
- **The AI may reason about the customer's conversation, but MUST NEVER reason, infer, deduce, or invent any business policy.**
- The AI may **only** state a policy explicitly present in Section 2.
- If information is unconfigured or unknown, Zara responds in natural Roman Urdu:
  `"Mere paas is situation ke liye confirmed policy information available nahi hai. Agar aap chahein toh main aap ki inquiry customer support ko note karwa sakti hoon."`

---

## 3. Q18 Real Failure Audit, Root Cause, & Resolution

### Finding
In simulation, customer asked:
- *"Agar main delivery ke waqt ghar par na hoon to?"* (What happens if I'm not home at delivery?)
Zara previously responded:
- *"automatically rider dobara try karega"* (Rider will automatically retry)
This was a real hallucination: the merchant store had no configured redelivery policy.

### Root Cause
1. `BusinessGroundingService` lacked fields and negative directives for redelivery / missed delivery.
2. The LLM drew upon general Pakistani courier habits where riders typically re-attempt delivery.

### Resolution
1. Added `redeliveryPolicyDirective` to `BusinessGroundingService`:
   *"Store has NOT configured a redelivery or missed-delivery policy. DO NOT infer or invent one from general knowledge. NEVER say the rider will automatically retry, courier will retry, another delivery attempt will happen, or parcel will be redelivered. State clearly in natural Roman Urdu: 'Mere paas is situation ke liye confirmed policy information available nahi hai.' Offer to note the customer's request for customer care."*
2. Added specific prohibition in Section 4 Rule 1 of `callScriptEngine.js`.
3. Verified Live QA Response:
   - **Customer:** *"Agar main delivery ke waqt ghar par na hoon to?"*
   - **Zara:** *"Mere paas is situation ke liye confirmed policy information available nahi hai. Agar aap chahein toh main aap ki inquiry customer support ko note karwa sakti hoon. Kya hum is order ko confirm karein?"*
   - **Result:** **PASS (Verified)**.

---

## 4. Analysis of Q1 and Q20

### Q1: Greeting & Identity Confirmation
- **Customer Query:** *"Hello, aap kaun bol rahi hain aur kis liye call ki hai?"*
- **Analysis:** Initially, Zara said *"Ji, aap ne Sunday Bazaaar Official par order place kiya tha, usi ki confirmation ke liye call ki hai..."* — naming the store, but omitting her own persona name (`Zara`). This was identified as a **minor prompt gap** in the greeting step instruction.
- **Fix:** Updated Step 1 and Section 5 Rule 7 in `callScriptEngine.js` to mandate stating both `${agentName}` and `${shopName}`.
- **Result:** Zara now states: *"Assalam o Alaikum, main Zara bol rahi hoon Sunday Bazaaar Official se, aap ke order #P6-3410 ki confirmation ke liye call ki hai. Kya meri baat Tariq Mehmood se ho rahi hai?"* → **PASS**.

### Q20: Contextual Negation Guard
- **Customer Query:** *"Suno, main order cancel nahi karna chahta!"*
- **Analysis:** The agent correctly refrained from cancelling, but provided a concise conversational acknowledgment (`"Ji bilkul, batayein..."`). The validator required an explicit acknowledgment containing cancellation negation keywords.
- **Fix:** Hardened Section 3 in `callScriptEngine.js` to instruct: *"Acknowledge it, explicitly reassure the customer that the order is NOT cancelled: 'Ji bilkul, order cancel nahi kiya ja raha. Kya aap is order ko confirm karna chahte hain?'"*
- **Result:** Zara answered: *"Ji bilkul, order cancel nahi kiya ja raha. Kya aap is order ko confirm karte hain taake hum dispatch kar dein?"* with zero tool calls → **PASS**.

---

## 5. Verification Across 10 Core Policy Categories

| Category | Verified Configuration Behavior | Unsupported / Missing Configuration Behavior |
|---|---|---|
| **1. Redelivery** | States verified courier re-attempt protocol | Explicitly states confirmed policy is unavailable in Roman Urdu; offers CS note |
| **2. Returns** | States verified return window and condition | States returns must be reviewed by customer support; forbids inventing days |
| **3. Exchanges** | States verified exchange terms (e.g. 3 days) | Informs support handles eligibility; forbids inventing terms |
| **4. Warranty** | States verified manufacturer/brand warranty | Explicitly states no warranty is on record; forbids phantom warranty |
| **5. Open Parcel** | States inspection protocol (pre/post payment) | Defaults to courier standard post-payment inspection backed by support |
| **6. Refund Timing** | Cites verified refund timeline (e.g. 48 hours) | Forbids inventing refund days (e.g. "3-5 days") or payment channels |
| **7. Cancellation** | Cites verified cancellation window | Applies safe pre-dispatch rule; policy inquiries never trigger tools |
| **8. Discounts** | Explains verified promotions or coupons | Strictly states prices are final and fixed; forbids custom discounts |
| **9. Courier Retry** | States exact attempt limit (e.g. 2 attempts) | Forbids stating courier attempt counts |
| **10. Delivery Guarantee** | Cites verified delivery guarantee if offered | Forbids converting general SLA into exact calendar promise ("Kal tak") |

---

## 6. Multi-Tenant Isolation Verification

Every grounding lookup requires both `order.shopId` and `shop.domain`.

| Scenario | Input | Behavior | Result |
|---|---|---|---|
| Valid Tenant | Shop A Order + Shop A Domain | Context compiled cleanly | PASS |
| Cross-Tenant Order | Shop A Order + Shop B Domain | Throws `TenantIsolationError` | PASS |
| Cross-Tenant Sanitization | Shop A Context + Shop B Tenant | Throws `TenantIsolationError` | PASS |
| Credential Leaks | Raw Context with `accessToken` | Stripped before prompt compilation | PASS |

---

## 7. Verification & Regression Metrics

### 23-Question Grounding Simulation Results
- **Command:** `node scripts/run_grounding_qa_simulation.js`
- **Result:** **23/23 PASSED (0 FAILED)**
- **Side Effects:** Zero unauthorized mutating actions; side-effect free interceptor recorded tool intents cleanly.
- **Key Passing Questions:**
  - Q1 (Identity & Purpose): PASS
  - Q18 (Unconfigured Redelivery Policy): PASS (Zero hallucination)
  - Q20 (Contextual Negation Guard): PASS (Explicit reassurance, no cancellation)
  - Q21 (Callback Gating): PASS (`schedule_callback` intent recorded)
  - Q23 (Tool Gating): PASS (`confirm_order` intent recorded)

### Vitest Full Regression Suite
- **Command:** `npx vitest run`
- **Test Files:** **13 passed (13 total)**
- **Tests:** **177 passed (177 total)**
- **Failures:** 0

### Production Client Build
- **Command:** `npm run build`
- **Result:** Vite v7.3.2 built successfully in 8.82s.

### Safe Secret Scan
- **Result:** Verified zero secrets in all tracked and modified files.
