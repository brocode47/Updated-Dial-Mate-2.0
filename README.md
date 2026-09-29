# DialMate 2.0

> Enterprise AI Commerce & Automated Call/WhatsApp Platform for Shopify Merchants

DialMate 2.0 integrates WhatsApp AKG messaging, sub-millisecond AI agent routing, live commerce data layers, and a multi-tenant Merchant Dashboard for real-time conversation management, customer intelligence, and analytics.

---

## Current Architecture

```
                    WhatsApp AKG (Webhook Gateway)
                               │
                               ▼
                   Express Webhook (/wa-akg)
                               │
                               ▼
                      BullMQ Job Queue
                               │
                               ▼
                       whatsappWorker.js
                               │
                               ▼
                       Python AI Engine
                        (POST /chat)
                               │
               ┌───────────────┼───────────────┐
               ▼               ▼               ▼
         product_agent    order_agent    support_agent
               │               │               │
               └───────────────┼───────────────┘
                               │
                               ▼
                   Live Commerce Service Layer
               (Product / Inventory / Order APIs)
                               │
                               ▼
                   PostgreSQL (Prisma ORM)
                               │
                               ▼
                  Merchant Control Center (SaaS)
```

---

## Current Milestone: Phase 3 Step 3 Completed

### 1. Conversation Inbox (`#/inbox`)
- Multi-tenant conversation list with status filters (`ACTIVE`, `HUMAN_TAKEOVER`, `RESOLVED`) and customer search.
- Live chat thread displaying customer messages, AI metadata badges (agent, intent, confidence), and timestamps.
- Human takeover toggle: pauses automated AI replies, tracks `assignedTo` and `isTakeover=true`.
- Manual merchant replies via `POST /api/conversations/:id/reply` with automated WhatsApp AKG delivery.

### 2. Customer Intelligence (`#/customers`)
- Customer directory with lifetime spend, order volume, and interaction counts.
- AI Profile Memory dossier drawer:
  - Preferred product categories and products
  - Average budget tracking (PKR)
  - Extracted customer preferences and behavioral summaries
- Order history with tracking numbers and courier delivery status.

### 3. AI Analytics Dashboard (`#/analytics`)
- Executive KPI cards:
  - Total conversations & messages
  - AI resolved conversations
  - Human escalations
  - Fallback rate (%)
  - Average response time (ms)
- Daily conversation volume trends.
- Top customer intents distribution and specialized sub-agent execution share.

### 4. Commerce Analytics (`#/analytics`)
- Product search demand intelligence from AI chat logs.
- Inventory Alert Center:
  - Low stock warnings (stock ≤ 5)
  - Unavailable products with customer demand (stock = 0)
- Order inquiry counts, cancellation requests, and fulfillment breakdown.

### 5. Shop Settings (`#/settings`)
- Business Profile: Shop name, domain, contact phone, logo.
- AI Persona Configuration: AI name, conversational tone, language preference, fallback message.
- Business Rules: Working hours, human escalation contact.
- WhatsApp AKG Gateway session status telemetry.

### 6. Security & Multi-Tenant Isolation
- Strict tenant isolation enforced on every endpoint via `shopId` (`tenantMiddleware`).
- Cross-tenant access attempts return `404 Not Found`.

---

## Verification Test Commands

To verify all components:

```bash
# 1. AI Engine Tests
python3 test_memory.py
python3 test_conversation_quality.py
python3 test_integration_offline.py
python3 test_chat_api.py
python3 test_commerce_layer.py

# 2. Node & Gateway Tests
node test_whatsapp_flow.js
node test_dashboard_api.js
```
