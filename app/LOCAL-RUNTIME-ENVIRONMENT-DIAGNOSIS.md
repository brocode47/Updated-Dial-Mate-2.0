# Local Runtime Environment Diagnosis

Based on an inspection of the project files and local environment state, here is the diagnosis of why the runtime services are currently unavailable and what is required to get them running.

## 1. Docker Status
- **Docker Installed:** Yes (Docker version 29.8.0, build 88096ef).
- **Docker Compose Installed:** Yes (v5.5.1).
- **Docker Desktop Installed:** Yes (cli-plugin is present).
- **Docker Daemon Running:** **No**. 
  - `docker info` returned: `failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine; check if the path is correct and if the daemon is running: open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.`

## 2. PostgreSQL Status
- **Availability:** PostgreSQL is not currently running. It is not running as a local Windows service or standalone installation.
- **Intended Setup:** It is intended to run via **Docker**, as defined in `server/docker-compose.yml` (using image `postgres:15-alpine` mapped to port `5432`).

## 3. Redis Status
- **Availability:** Redis is not currently running. It is not running as a local Windows service or standalone installation.
- **Intended Setup:** It is intended to run via **Docker**, as defined in `server/docker-compose.yml` (using image `redis:alpine` mapped to port `6379`).

## 4. Dial Mate Server Requirements
- **Dial Mate API:** Expected to be started via `npm run dev` or `npm run start` (which runs `node src/index.js`), using port `8787` (default) or the port specified in `PORT`.
- **Dial Mate Worker:** Expected to be started via `npm run worker` (which runs `node src/workers/index.js`).

## 5. WA-AKG Requirements
- **Location:** `D:\AI Projects\WA-AKG-AUDIT`
- **Intended Setup:** WA-AKG is a Next.js / TypeScript application. It relies on a MySQL database (configured in its own `docker-compose.yml`).
- **Start Mechanism:** It is intended to be started using the `./start.sh` script or `npm run dev` (`npx tsx src/server/index.ts`).
- **Port:** It expects to run on port `3000` by default.

## 6. Required Environment Variables
Based on static analysis of the source code, the following environment variables are required by the Dial Mate services (Values are NOT shown):

**Dial Mate (Server/Worker):**
- `PORT`
- `APP_URL`
- `FRONTEND_URL`
- `JWT_SECRET`
- `DATABASE_URL` (implied for Prisma)
- `REDIS_URL`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER` (or `TWILIO_PHONE_NUMBER`)
- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SHOPIFY_WEBHOOK_SECRET`
- `GEMINI_API_KEY`
- `WA_AKG_BASE_URL`
- `WA_AKG_API_KEY`
- `WA_AKG_SESSION_ID`
- `WA_AKG_WEBHOOK_SECRET`

*(Feature flags like `APP_MODE`, `FEATURE_BILLING`, etc., are optional but used).*

**WA-AKG:**
- `PORT`
- `AUTH_SECRET`
- `MYSQL_ROOT_PASSWORD`
- `MYSQL_DATABASE`
- `ADMIN_PASSWORD`
- `NEXT_PUBLIC_SWAGGER_PASSWORD`
- *And others defined in its `.env.example`.*

## 7. Correct Startup Order
Based strictly on the architecture and dependencies, the services must be brought up in the following order:

1. **Docker Infrastructure:** Start Docker Desktop application.
2. **Databases (PostgreSQL & Redis):** Spin up containers for Dial Mate.
3. **Database (MySQL):** Spin up containers for WA-AKG.
4. **Database Migrations:** Push schema to PostgreSQL (Dial Mate) and MySQL (WA-AKG).
5. **WA-AKG Service:** Start WA-AKG first since Dial Mate relies on it for WhatsApp capabilities.
6. **Dial Mate API:** Start the main backend server.
7. **Dial Mate Worker:** Start the background jobs worker.
8. **Dial Mate Frontend:** Start the Vite React app.

## 8. Exact Commands That SHOULD Be Run Later (Do Not Run Now)
**1. Start Docker Desktop (Manually via Windows Start Menu)**

**2. Start Dial Mate Infrastructure:**
```bash
cd server
docker-compose up -d
```

**3. Start WA-AKG Infrastructure & App:**
```bash
cd "D:\AI Projects\WA-AKG-AUDIT"
docker-compose up -d db
npm install
npm run db:push
npm run dev
# OR use ./start.sh
```

**4. Run Dial Mate Migrations:**
```bash
cd server
npm install
npx prisma db push
# or npx prisma generate
```

**5. Start Dial Mate API:**
```bash
cd server
npm run dev
```

**6. Start Dial Mate Worker:**
```bash
cd server
npm run worker
```

**7. Start Dial Mate Frontend:**
```bash
cd .. # root directory
npm install
npm run dev
```

## 9. Blockers
- **Docker is not running:** The primary blocker is that the Docker Desktop engine is not active. The `docker-compose.yml` for PostgreSQL and Redis cannot be executed until Docker is running.
- **Environment Configuration:** Proper `.env` files must be verified in both the `server/` directory and the `WA-AKG` directory before startup to avoid boot crashes.
