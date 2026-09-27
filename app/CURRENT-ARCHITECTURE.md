# Current Architecture: Dial Mate 2.0

## Overview
Dial Mate 2.0 is designed as a SaaS application for Shopify merchants to automate Order Confirmation calls using AI voice agents (primarily Urdu). It currently exists as a monolithic full-stack JavaScript application split into a React (Vite) frontend and an Express/Node.js backend, using Prisma for database interactions with PostgreSQL.

## Core Components

### 1. Frontend (`/src`)
- **Framework:** React + Vite
- **Styling:** Tailwind CSS (configured via `@tailwindcss/vite`)
- **State Management:** Custom Context API (`store.jsx`)
- **Routing:** Custom Hash-based routing (`App.jsx`)
- **Current Pages:** Dashboard, Orders, Calls, Billing, Settings, Onboarding.
- **Purpose:** Admin panel for merchants to view orders, call analytics, and trigger manual/retry calls.

### 2. Backend (`/server`)
- **Framework:** Express (Node.js)
- **Database ORM:** Prisma (`@prisma/client`)
- **Database Engine:** PostgreSQL (Configured in schema.prisma, SQLite is in package.json but schema says postgresql)
- **Primary Routes:**
  - `/api` - Core REST endpoints for frontend (orders, calls, manual triggers).
  - `/webhooks` - Receives Shopify webhooks (orders/create, orders/updated).
  - `/twilio` - Handles Twilio webhook events (`/voice`, `/gather`, `/status`).
- **Purpose:** Serve API to frontend, receive Shopify webhooks, coordinate Twilio IVR, sync tags back to Shopify.

### 3. Database Layer
- **Schema:** Multi-tenant ready schema containing `Organization`, `User`, `Shop`, `Customer`, `Order`, `Call`, `Conversation`, `Message`, `WebhookEvent`, `ComplianceLog`.
- **Status:** The schema supports a multi-tenant SaaS architecture, but the middleware and auth are partially mocked or tied to single-tenant demo patterns.

### 4. Third-Party Integrations
- **Shopify:** Utilizes `@shopify/shopify-api`. Registers webhooks for `orders/create` and can push tags back to Shopify (e.g., `COD_CONFIRMED`).
- **Twilio:** Handles inbound/outbound telephony. Currently, the actual conversation flow heavily relies on Twilio TwiML (DTMF gather: 1 for confirm, 2 for cancel).
- **AI/LLM (Gemini):** There is a foundational integration with `@google/genai` in `server/src/integrations/ai/agent.js`, equipped with function calls (`confirm_cod_order`, `cancel_order`, etc.), but the primary Twilio router has a fallback to static IVR prompts if the AI fails or is disabled.

## Deployment Profile
- Designed for Node.js environments.
- Uses `dotenv` for environment variables.
- Contains a basic `Dockerfile` and `docker-compose.yml` for containerized deployments.

## Overall Architecture Assessment
The repository demonstrates a **Proof of Concept (PoC) / Beta** maturity level. It lays down a solid database schema and directory structure for a multi-tenant Shopify app, but heavily mocks or simplifies core features (billing, auth, robust background job queues) that are strictly required for production SaaS.
