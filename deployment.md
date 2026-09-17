# Deployment Plan — Render + Docker (free tier)

Target stack:

| Concern | Service | Plan |
|---|---|---|
| API + BullMQ worker | Render Web Service (Docker) | Free |
| PostgreSQL | Neon | Free |
| Redis (BullMQ) | Render Key Value | Free |
| Keep-alive pinger | cron-job.org | Free |
| SMTP (optional) | Resend / Brevo | Free |

> Free-tier limits change. Treat the numbers here as "what to verify on the
> pricing page", not as guarantees.

---

## 0. The one decision that shapes everything

`src/index.ts` starts the HTTP server, the BullMQ **worker**, the reconciler and
the session-cleanup job **in the same process**. The textbook Render layout
would be two services — a Web Service for the API and a Background Worker for
BullMQ — but on the free tier that is the wrong call:

- Render's free tier gives **750 instance-hours/month across all free services**.
  One service running 24/7 is ~730h. Two services is ~1460h — you blow the
  budget halfway through the month and everything stops.
- Render **Background Workers have no free plan** anyway (Starter and up only).

So: **keep the single-process design.** One Web Service runs API + worker. This
plan is written for that. §9 covers the split for when you move to paid.

### The free-tier spin-down problem (read this before anything else)

A free Render Web Service **spins down after ~15 minutes with no inbound HTTP
traffic** and cold-starts (~30–60s) on the next request. The worker dies with it.

Consequence for scheduled publishing: a post scheduled for 3:00 AM **will not
publish at 3:00 AM** if the service is asleep. It publishes when the service
next wakes.

Your codebase already has the correct recovery mechanism —
`src/jobs/scheduled-publication.reconciler.ts` re-reads `PENDING` rows from
Postgres on boot and re-enqueues anything Redis forgot. So nothing is *lost*,
it is only *late*. Two mitigations, use both:

1. **External keep-alive ping** (§7). Hit `/api/v1/health` every 10 minutes so
   the service never idles out. ~730h/month — fits inside 750h for one service.
2. **Accept the reconciler as the safety net.** `SCHEDULER_RECONCILE_INTERVAL_MS=60000`
   means at most ~60s of extra lag after a wake-up, on top of the cold start.

If on-time publishing is a hard requirement, this needs a paid plan. Say so in
the README rather than discovering it in production.

---

## 1. Code changes required before deploying

Four small changes. Do these first — the Dockerfile depends on them.

### 1.1 Stop importing the app env into the Prisma config (`prisma7.config.ts`)

The config currently imports `./src/config/env.js`, which runs the full Zod
schema. In the production image `src/` will not exist (only `dist/`), and
running migrations would demand every unrelated var (`JWT_SECRET`, `FRONTEND_URL`, …).
Read `process.env` directly.

```ts
// prisma7.config.ts
import "dotenv/config";
import { defineConfig } from "prisma/config";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL must be set to run Prisma CLI commands");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url },
});
```

### 1.2 Use Neon's *unpooled* URL as the single `DATABASE_URL`

This project uses **one** connection string for both the app and the Prisma
CLI. That makes the choice of which Neon string to use load-bearing:

- The **pooled** URL (host contains `-pooler`) routes through PgBouncer in
  transaction mode, which **cannot run migrations** — no session state, no
  advisory locks. `prisma migrate deploy` against it fails or hangs.
- The **direct/unpooled** URL works for both.

So use the **direct** one. The usual argument for the pooler — many short-lived
serverless instances exhausting connections — does not apply here: this is a
single long-lived Node process with its pg pool capped at 5 (§3). Neon's free
compute allows far more than that, so pooling buys nothing and costs you the
ability to migrate.

```
DATABASE_URL=postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
                                          ^ no "-pooler"
```

Get it from the Neon dashboard with **Connection pooling toggled off** — don't
hand-edit `-pooler` out of the pooled string, since the rest of the host can
differ.

> If you later scale to several instances, revisit this: reintroduce the pooled
> URL for the app and a separate direct URL for migrations only.

### 1.3 Make the readiness probe check Redis too (`src/routes/health.routes.ts`)

Right now `/health/ready` only pings Postgres. On Render, Key Value is the
dependency most likely to be the one that's down. Add it, guarded so
`SCHEDULER_ENABLED=false` does not make the probe fail:

```ts
if (env.SCHEDULER_ENABLED) {
  await getRedisConnection().ping();
}
```

Keep `/health` (liveness) dependency-free as it is — that is the endpoint the
keep-alive pinger and Render's health check will hit.

### 1.4 Redis TLS support (`src/config/redis.ts`)

Render Key Value's internal URL is plain `redis://` on the private network, so
no change is strictly needed. But if you ever point `REDIS_URL` at Upstash
(§4, alternative B) it will be `rediss://` — ioredis handles the `rediss://`
scheme natively, so **no code change**. Just be aware the scheme differs.

---

## 2. Docker setup

### 2.1 `.dockerignore` (create at repo root)

This one matters more than usual: `node_modules/` here is a Linux-x64 build of
native modules (`@node-rs/argon2`) from *your* machine. Leaking it into the
build context can shadow the container's own install.

```
node_modules
dist
src/generated
.git
.env
.env.*
!.env.example
*.log
npm-debug.log*
.vscode
.idea
.DS_Store
docker-compose.yml
*.md
!prisma/SCHEMA.md
```

### 2.2 `Dockerfile` (create at repo root)

Notes on the choices:

- **`node:22-bookworm-slim`, not alpine.** `@node-rs/argon2` is a native NAPI
  module. Its glibc prebuilds are the best-tested path; musl prebuilds exist but
  are a extra thing that can go wrong on a free tier where you cannot easily
  debug. Slim costs you ~40MB and saves you an afternoon.
- **`prisma generate` runs in the build.** `src/generated/` is gitignored, so
  the client does not exist in a fresh clone — without this step `tsc` fails.
- **Three stages.** The runtime image carries no TypeScript, no ESLint, no
  source — just `dist/`, production `node_modules`, and `prisma/` (needed for
  `migrate deploy`).
- **`npm ci --omit=dev` then re-add `prisma`.** The Prisma CLI is a devDependency
  but the release command needs it. Installing it explicitly in the runtime
  stage is smaller than shipping all devDependencies.
- **Exec-form `CMD`.** Node runs as PID 1 and receives Render's `SIGTERM`
  directly; `src/index.ts` already registers a `SIGTERM` handler that drains the
  BullMQ worker before exiting, which is exactly what you want mid-publish.

```dockerfile
# syntax=docker/dockerfile:1

# ---------- deps: full install, cached on lockfile only ----------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- build: generate client, compile TS ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY tsconfig.json ./
COPY src ./src
# src/generated/ is gitignored, so the client must be generated here.
RUN npx prisma generate
RUN npm run build

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && \
    npm install --no-save prisma@^7.10.0 && \
    npm cache clean --force

# The generated client is imported from dist/ at runtime, and `prisma generate`
# must be re-run against the production node_modules so the engine files match.
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/generated ./src/generated
COPY prisma ./prisma
COPY prisma7.config.ts ./

USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
```

> **As built, two details differ from the sketch above** (verified by an actual
> `docker build` + run):
>
> - `COPY --from=build /app/src/generated` is **not needed**. The generator
>   writes TypeScript into `src/generated/`, and although `tsconfig.json`
>   *excludes* that path, `tsc` still compiles it because `src/` imports it —
>   so the client lands in `dist/generated/prisma-client/` as plain JS. Prisma 7
>   with the `pg` driver adapter ships no engine binary, so there is nothing
>   else to copy and no `prisma generate` is required in the runtime stage.
> - The build stage needs a **placeholder `DATABASE_URL`**. After change 1.1,
>   `prisma7.config.ts` throws when the var is unset, and `prisma generate`
>   loads the config even though it never opens a connection. A dummy value set
>   with `ENV` in the build stage is enough; it never reaches the runtime image.

### 2.3 Verify locally before pushing

```bash
docker build -t cp-api .
docker run --rm -p 4000:4000 --env-file .env cp-api
curl localhost:4000/api/v1/health
```

Point `.env`'s `DATABASE_URL`/`REDIS_URL` at your `docker-compose.yml` services
(use `host.docker.internal` or `--network host`) so you are testing the real
image, not a different one.

---

## 3. PostgreSQL on Neon

1. Create a project at [neon.tech](https://neon.tech). **Pick the same region
   as your Render service** (e.g. both `us-east` / Ohio) — cross-region adds
   50–100ms to every query.
2. From the dashboard, copy the **direct (unpooled)** connection string —
   toggle **Connection pooling off**. See §1.2 for why the pooled one is the
   wrong choice when a single URL serves both the app and migrations.
3. Append `?sslmode=require` if not already present.

```
DATABASE_URL=postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
```

### Neon free-tier gotchas

- **Compute autosuspends after ~5 min idle.** The first query after a suspend
  takes ~500ms–1s extra. Combined with Render's cold start, a truly idle stack
  can take several seconds on the first request. The keep-alive ping (§7) keeps
  both warm.
- **Connection limits.** Connecting directly means your own pool is the only
  thing standing between you and the compute's connection ceiling — so cap it.
  In `src/config/prisma.ts`:
  ```ts
  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
    max: 5, // free tier: stay well under the limit
  });
  ```
- **Storage/compute-hour quota.** Free plan has a monthly compute-hour budget.
  Autosuspend is what keeps you inside it — do not disable it.

### Running migrations

`prisma migrate deploy` is **not** in the Docker `CMD`. Two processes booting at
once would race the migration lock. Use Render's **Pre-Deploy Command** instead
(§5), which runs once, before the new instance starts.

---

## 4. Redis for BullMQ

BullMQ needs a real Redis with blocking commands (`BZPOPMIN`) and long-lived
connections. This rules out most "serverless Redis over HTTP" offerings.

### Option A — Render Key Value (recommended)

Render's own managed Valkey/Redis. Free plan: ~25MB, **no persistence**,
accessible over the private network from your Render service in the same region.

- ✅ Same-region private networking, no egress, no TLS setup, one dashboard.
- ⚠️ **No persistence.** A restart wipes the queue.

The no-persistence caveat is survivable *specifically because of your
architecture*: `scheduled_publications` rows in Postgres are the source of
truth, and the reconciler re-enqueues anything missing within
`SCHEDULER_RECONCILE_INTERVAL_MS`. That is exactly the failure this file was
written for — see its doc comment. Verify the reconciler actually recovers a
wiped queue as part of §8.

Setup: Render dashboard → **New → Key Value** → Free plan → same region as the
web service → copy the **Internal Key Value URL** into `REDIS_URL`.

### Option B — Upstash (if you want persistence)

Upstash's free tier includes a Redis-protocol TCP endpoint (`rediss://`), is
BullMQ-compatible, and persists. The catch is a **monthly command quota** —
and BullMQ is chatty: workers poll, and your reconciler runs `hasQueuedJob` for
every pending row every 60s.

If you use Upstash, reduce the polling pressure:

```
SCHEDULER_RECONCILE_INTERVAL_MS=300000   # 5 min instead of 1
SCHEDULER_CONCURRENCY=2
```

Set `REDIS_URL` to the `rediss://` URL. ioredis handles TLS from the scheme.

### Option C — Aiven free Valkey

Also viable, persists, but is a separate provider in a separate region from
Render — expect higher latency on every queue operation.

**Recommendation:** start with **A**. Your reconciler makes the persistence
tradeoff cheap, and same-region private networking beats the alternatives.

---

## 5. Render service setup

### 5.1 Create the Web Service

Dashboard → **New → Web Service** → connect the GitHub repo.

| Setting | Value |
|---|---|
| Language / Runtime | **Docker** |
| Dockerfile Path | `./Dockerfile` |
| Region | Same as Key Value; closest to Neon |
| Branch | `main` |
| Instance Type | **Free** |
| Health Check Path | `/api/v1/health` |
| Pre-Deploy Command | `npx prisma migrate deploy` |
| Auto-Deploy | On (or off if you prefer manual) |

The **Pre-Deploy Command** is the important one: Render runs it in the new
image, once, before routing traffic. That is the correct place for
`migrate deploy` — not in `CMD`, not in the app's boot path.

### 5.2 Environment variables

Set these in the Render dashboard (**Environment** tab). Never commit them.

```bash
NODE_ENV=production
PORT=4000                      # must match EXPOSE / what the app binds

# --- Database (Neon) ---
DATABASE_URL=<neon direct/unpooled url>

# --- Redis (Render Key Value internal URL) ---
REDIS_URL=<render key value internal url>

# --- Proxy: Render puts exactly one proxy in front of you ---
TRUST_PROXY=1

# --- URLs ---
FRONTEND_URL=https://your-frontend.example.com
API_PUBLIC_URL=https://<service-name>.onrender.com
CORS_ORIGINS=https://your-frontend.example.com

# --- Cookies: env.ts *rejects* COOKIE_SECURE=false in production ---
COOKIE_SECURE=true
# Cross-site frontend (different domain) needs none+secure.
# Same domain? use lax.
COOKIE_SAMESITE=none

# --- JWT (generate: openssl rand -base64 48) ---
JWT_SECRET=<48+ random chars>
JWT_ISSUER=content-publishing-api
JWT_AUDIENCE=content-publishing-web
ACCESS_TOKEN_TTL_S=900
REFRESH_TOKEN_TTL_DAYS=30

# --- Logging ---
LOG_LEVEL=info

# --- Scheduler ---
SCHEDULER_ENABLED=true
SCHEDULER_CONCURRENCY=2          # 512MB / 0.1 CPU: keep this low
SCHEDULER_MAX_ATTEMPTS=5
SCHEDULER_BACKOFF_MS=30000
SCHEDULER_RECONCILE_INTERVAL_MS=60000

# --- Rate limiting ---
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100
AUTH_RATE_LIMIT_MAX=10

# --- Mail ---
MAIL_TRANSPORT=smtp
MAIL_FROM=Content Publishing <no-reply@yourdomain.com>
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<user>
SMTP_PASS=<key>

# --- OAuth: all three or none (env.ts enforces this) ---
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=
```

Three of these are easy to get wrong and your `env.ts` will hard-fail the boot
on all three — which is the right behaviour, but know what you're looking at in
the logs:

- `COOKIE_SECURE` must be `true` when `NODE_ENV=production`.
- `JWT_SECRET` must be ≥32 characters.
- Google OAuth vars are all-or-nothing.

And one that won't fail loudly: `TRUST_PROXY=0` behind Render's proxy means
`express-rate-limit` sees Render's IP for every request and rate-limits your
entire userbase as one client. Set it to `1`.

### 5.3 `render.yaml` (optional, Infrastructure-as-Code)

Lets you recreate the whole thing from the repo. Secrets stay `sync: false`
(entered in the dashboard, never in git).

```yaml
services:
  - type: web
    name: content-publishing-api
    runtime: docker
    plan: free
    region: ohio
    dockerfilePath: ./Dockerfile
    healthCheckPath: /api/v1/health
    preDeployCommand: npx prisma migrate deploy
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 4000
      - key: TRUST_PROXY
        value: 1
      - key: COOKIE_SECURE
        value: true
      - key: COOKIE_SAMESITE
        value: none
      - key: SCHEDULER_ENABLED
        value: true
      - key: SCHEDULER_CONCURRENCY
        value: 2
      - key: REDIS_URL
        fromService:
          type: keyvalue
          name: content-publishing-kv
          property: connectionString
      - key: DATABASE_URL
        sync: false
      - key: JWT_SECRET
        sync: false
      - key: FRONTEND_URL
        sync: false
      - key: API_PUBLIC_URL
        sync: false
      - key: CORS_ORIGINS
        sync: false
      - key: SMTP_HOST
        sync: false
      - key: SMTP_USER
        sync: false
      - key: SMTP_PASS
        sync: false

  - type: keyvalue
    name: content-publishing-kv
    plan: free
    region: ohio
    ipAllowList: []   # empty = private network only
```

---

## 6. Memory budget (512MB, 0.1 CPU)

The free instance is small and you are running API + worker + reconciler in it.
Two things to watch:

- **`@node-rs/argon2`.** Argon2 is memory-hard *by design* — that is the point
  of it. Default parameters can allocate tens of MB per hash. On 0.1 CPU a
  password hash may take noticeably longer than on your laptop. If logins time
  out, tune the argon2 memory cost down in `src/services/password.service.ts`
  before blaming anything else.
- **Cap the Node heap.** Add to the Dockerfile runtime stage:
  ```dockerfile
  ENV NODE_OPTIONS=--max-old-space-size=384
  ```
  This makes Node GC rather than get OOM-killed by Render, which is a much
  better failure mode — an OOM kill loses in-flight jobs.

Keep `SCHEDULER_CONCURRENCY=2`. Five concurrent publishes, each opening Prisma
transactions, on 0.1 CPU, is not a good trade.

---

## 7. Keep-alive pinger

Prevents the 15-minute spin-down so the BullMQ worker stays alive.

1. [cron-job.org](https://cron-job.org) (free) → new cron job.
2. URL: `https://<service>.onrender.com/api/v1/health`
3. Schedule: every 10 minutes.
4. Expect HTTP 200.

`/api/v1/health` is the right target — it touches no dependency, so the ping
costs you nothing in Neon compute-hours or Redis commands. Do **not** point it
at `/health/ready`, which queries Postgres every time and would keep Neon's
compute awake 24/7, burning your Neon quota.

~4,400 pings/month, well inside cron-job.org's free limits.

> This is a workaround for a free-tier constraint, not a design. On a paid
> Render plan, delete the cron job — services don't spin down.

---

## 8. Post-deploy verification

Work through these in order. Each one checks something the previous one cannot.

```bash
API=https://<service>.onrender.com

# 1. Liveness
curl -i $API/api/v1/health

# 2. Readiness — proves Postgres (and Redis, after change 1.3) are reachable
curl -i $API/api/v1/health/ready

# 3. Migrations landed
#    Neon dashboard → SQL editor:
#    SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at;

# 4. Security headers + CORS
curl -I $API/api/v1/health
curl -i -H "Origin: https://your-frontend.example.com" $API/api/v1/content

# 5. Auth round-trip — confirms argon2 works and cookies come back Secure
curl -i -X POST $API/api/v1/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"<12+ chars>","name":"Test"}'
```

Then the two that actually matter for this app:

**6. Scheduled publish, end to end.** Create an item, schedule it ~2 minutes
out, and watch Render's logs for the worker picking it up. This is the only
test that exercises Render → Key Value → BullMQ → Neon in one path.

**7. Reconciler recovery.** This is the one people skip. Schedule a publish,
then restart the Key Value instance from the Render dashboard (wiping the
queue), and confirm the reconciler re-enqueues it within a minute — look for
`"Scheduled publication reconcile ran"` with `enqueued: 1` in the logs. If this
doesn't work, Option A's lack of persistence is no longer acceptable and you
need §4 Option B.

**8. Rate limiting sees real client IPs.** Hammer a login endpoint from one IP
and confirm you get 429 — and that a second IP is unaffected. If both get
blocked together, `TRUST_PROXY` is wrong.

---

## 9. When you outgrow free

In rough order of what to buy first:

1. **Render Starter for the web service (~$7/mo).** Kills the spin-down. Delete
   the cron pinger. Scheduled publishes become on-time. This is the single
   biggest correctness improvement available.
2. **Split the worker into its own Background Worker service.** Now affordable,
   and it stops a slow publish from competing with request handling. Mechanics:
   - Same Docker image, different `CMD` → add `dist/worker.js` with a
     worker-only entrypoint (no `app.listen`).
   - Web service: `SCHEDULER_ENABLED=false` — this is exactly what that flag
     and the lazy `getRedisConnection()` were built for. The web process still
     *enqueues* (that path checks the flag; you'd want an `ENQUEUE_ENABLED`
     split, or keep the flag true and simply not start the worker).
   - Cleaner: add a `WORKER_ENABLED` env var so enqueueing and consuming are
     independently switchable. Worth doing when you make the split.
3. **Neon paid** when autosuspend latency or compute-hours start to bite.
4. **Persistent Redis** so the reconciler is a safety net rather than a
   load-bearing component.

---

## Checklist

- [x] `prisma7.config.ts` reads `DATABASE_URL` from `process.env` (1.1)
- [x] `DATABASE_URL` switched to Neon's **unpooled** string (1.2)
- [x] `/health/ready` pings Redis (1.3)
- [x] `.dockerignore` created (2.1)
- [x] `Dockerfile` created (2.2)
- [ ] Image builds and runs locally against local Postgres/Redis (2.3)
- [ ] Neon project created, same region, unpooled URL copied (3)
- [x] `PrismaPg` pool capped at `max: 5` (3)
- [ ] Render Key Value created, same region, internal URL copied (4)
- [ ] Web Service created: Docker, free, health check, pre-deploy command (5.1)
- [ ] All env vars set; `TRUST_PROXY=1`, `COOKIE_SECURE=true` (5.2)
- [ ] `NODE_OPTIONS=--max-old-space-size=384` set (6)
- [ ] Keep-alive cron hitting `/api/v1/health` every 10 min (7)
- [ ] Verification steps 1–8 pass, **including 7 (reconciler recovery)** (8)
