# Implementation plan — Content publishing API

Auth (register/login/refresh/OAuth/roles) and the Prisma data model are already in place.
This plan covers everything left: the content API surface, the review flow, the scheduled
publisher, and the tests that prove the two hard requirements (§3.3 exactly-once publish,
§6 ownership boundary).

Conventions are inherited from the auth slice and are not re-litigated here:
`routes → validate → controller → service → repository`, `asyncHandler` on every handler,
`sendSuccess` / `sendNoContent` envelopes, `AppError` subclasses for failures, Zod schemas
in `src/validations/`, audit writes through `src/services/audit.service.ts`.

---

## 1. API surface

Base URL `/api/v1`. Three groups, split by who can reach them.

### 1.1 Public (no auth) — `/content`

| Method | Path | Purpose |
|---|---|---|
| GET | `/content` | Page-paginated list of `PUBLISHED` items |
| GET | `/content/:slug` | Published detail by slug |

Both read `ContentItem WHERE status = 'PUBLISHED'` and serve the body from
`publishedVersion`. A draft/pending/unpublished slug returns the same `404` as a
nonexistent one — no existence leak (§3.5).

Query params for the listing: `page` (≥ 1, default 1), `pageSize` (1–50, default 20),
`categorySlug`, `tagSlug`, `q` (optional title prefix), `sort` (`newest` default / `oldest`).

Pagination is **page/offset**: `ORDER BY publishedAt DESC, id DESC LIMIT $pageSize OFFSET
($page - 1) * $pageSize`, with a parallel `count()` over the same `WHERE`. The response
carries a `meta` block so a UI can render numbered pages:

```json
{ "success": true,
  "data": { "items": [ ... ],
            "meta": { "page": 2, "pageSize": 20, "totalItems": 137,
                      "totalPages": 7, "hasPrev": true, "hasNext": true } } }
```

Both the ordering and the filter are served by the existing
`content_items (status, publishedAt DESC, id DESC)` index, so the database still does the
ordering and the slicing — never `findMany()` then `.filter()`/`.slice()` in JS (§6).

Two things page/offset costs us, stated plainly so they don't surprise anyone at the
walkthrough:

- **Deep pages get slower.** Postgres walks and discards the offset rows, so page 5,000 is
  measurably worse than page 1. Mitigated by capping `pageSize` at 50 and rejecting a
  `page` beyond `totalPages` with a 422 rather than scanning to nowhere. Fine at POC
  scale; the honest answer to "does this stay usable at 10M rows" is that the listing
  would move to keyset.
- **Rows can shift between pages.** If something publishes while a reader pages through,
  an item can repeat or be skipped at a boundary. Acceptable for a public listing;
  called out in `api.md`.

`totalItems` comes from a real `COUNT(*)` on the same predicate, issued inside the same
`prisma.$transaction([...])` as the page query so the count and the rows agree.

### 1.2 Authenticated authoring — `/items`

All require `requireAuth` + `requireActiveAccount` + `requireVerifiedEmail`.

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/items` | author, editor | Create item + version 1 in `DRAFT` |
| GET | `/items` | author, editor | List *my* items; editors may pass `authorId`/`status` filters |
| GET | `/items/:id` | owner or editor | Item + current draft + published version summary |
| PATCH | `/items/:id/versions/:versionId` | owner (own draft) or editor | Edit a `DRAFT`/`REJECTED` version |
| POST | `/items/:id/submit` | owner or editor | `DRAFT`/`REJECTED` → `PENDING_REVIEW` |
| POST | `/items/:id/revisions` | owner or editor | Branch a new `DRAFT` from the live version (§3.4) |
| GET | `/items/:id/versions` | owner or editor | Version history, newest first (§3.6) |
| GET | `/items/:id/versions/:versionId` | owner or editor | One historical version, immutable |
| GET | `/items/:id/audit` | owner or editor | Structured event trail for the item (§6) |
| DELETE | `/items/:id` | owner (unpublished only) or editor | Soft delete → `ARCHIVED` |

### 1.3 Editorial — `/editorial`, `requireEditor`

| Method | Path | Purpose |
|---|---|---|
| GET | `/editorial/queue` | `PENDING_REVIEW` versions, oldest `submittedAt` first, page-paginated |
| POST | `/editorial/versions/:versionId/approve` | → `APPROVED`, optional comment |
| POST | `/editorial/versions/:versionId/reject` | → `REJECTED`, **comment required** |
| POST | `/editorial/versions/:versionId/publish` | Publish now (from `PENDING_REVIEW` or `APPROVED`) |
| POST | `/editorial/versions/:versionId/schedule` | → `SCHEDULED` + `ScheduledPublication` row |
| DELETE | `/editorial/versions/:versionId/schedule` | Cancel a pending job → back to `APPROVED` |
| POST | `/editorial/items/:id/unpublish` | `PUBLISHED` → `UNPUBLISHED` (§3.4) |
| POST | `/editorial/items/:id/restore/:versionId` | Republish an old version as a *new* version (§8, optional) |

Every editorial action writes a `Review` row (append-only) plus an `AuditEvent`, in the
same transaction as the state change.

---

## 2. State machine — one place, enforced in the service

`src/services/content-state.ts` owns the legal transitions. Controllers never branch on
status; they call a service function that asserts the transition and throws
`ConflictError` (409) on an illegal one, so "publish a rejected item without review" is
refused before any write (§6 bad input).

```
VersionStatus
  DRAFT          → PENDING_REVIEW (submit) | DISCARDED
  PENDING_REVIEW → APPROVED | REJECTED | PUBLISHED (direct publish) | SCHEDULED
  REJECTED       → PENDING_REVIEW (resubmit after edit)
  APPROVED       → PUBLISHED | SCHEDULED
  SCHEDULED      → PUBLISHED (worker) | APPROVED (schedule cancelled)
  PUBLISHED      → SUPERSEDED (a newer version goes live) | UNPUBLISHED
  UNPUBLISHED    → PUBLISHED (re-publish)
```

Item status follows from the pointer move, never set independently:
`publishedVersionId != null` ⇒ item `PUBLISHED`; unpublish nulls the pointer and sets
`UNPUBLISHED`; `archivedAt` ⇒ `ARCHIVED`.

**Mutability rule:** a version is editable only while `DRAFT` or `REJECTED`. Every other
status is immutable — `PATCH` on one returns 409. This is what keeps a revision from
clobbering the live copy.

---

## 3. Authorization rules

Two layers, both server-side:

1. **Role gate** at the route (`requireEditor` on `/editorial/*`).
2. **Ownership predicate in the query**, not an `if` after the read. Author reads/writes
   go through repository helpers that take a `scope`:
   `{ role: 'EDITOR' }` → no `authorId` predicate; `{ role: 'AUTHOR', userId }` →
   `WHERE authorId = $userId` folded into the same statement.

An author touching another author's item matches zero rows → `NotFoundError` (404, not
403, so IDs aren't enumerable). This is the walkthrough-Q2 answer and is covered by a
dedicated test (§7).

---

## 4. Files to add

```
src/validations/content.validation.ts     item/version create+update, list query, paging
src/validations/editorial.validation.ts   approve/reject/publish/schedule bodies
src/repositories/content-item.repository.ts
src/repositories/content-version.repository.ts
src/repositories/review.repository.ts
src/repositories/scheduled-publication.repository.ts
src/repositories/taxonomy.repository.ts   category/tag upsert-by-slug
src/services/content-state.ts             transition table + assertTransition
src/services/content.service.ts           create / edit / submit / revise / history
src/services/publishing.service.ts        publishVersion, unpublish, restore (transactional)
src/services/editorial.service.ts         approve / reject / publish / schedule / cancel
src/services/public-content.service.ts    public list + detail
src/controllers/content.controller.ts
src/controllers/editorial.controller.ts
src/controllers/public-content.controller.ts
src/routes/content.routes.ts
src/routes/editorial.routes.ts
src/routes/public-content.routes.ts
src/config/redis.ts                       ioredis connection shared by queue + worker
src/queues/scheduled-publication.queue.ts BullMQ Queue — add/remove delayed jobs
src/workers/scheduled-publication.worker.ts BullMQ Worker — consumes the queue, publishes
src/jobs/scheduled-publication.reconciler.ts sweeps DB for SCHEDULED rows missing a queue job
src/utils/pagination.ts                   page/pageSize → skip/take, meta builder
src/utils/slug.ts                         slugify + uniqueness suffix
src/interfaces/content.interface.ts       DTO shapes (scope, list result, version DTO)
```

Touched: `src/routes/index.ts` (mount three routers), `src/index.ts` (start/stop the
worker and the reconciler alongside `startSessionCleanup`), `src/config/env.ts` (job
knobs below), `.env.example`, `package.json` (add `bullmq` + `ioredis`), `api.md`
(restore it and add the content section).

New dependencies: `bullmq`, `ioredis`.

New env vars:

```
REDIS_URL=redis://localhost:6379
SCHEDULER_ENABLED=true
SCHEDULER_CONCURRENCY=5           # BullMQ Worker concurrency
SCHEDULER_MAX_ATTEMPTS=5
SCHEDULER_BACKOFF_MS=30000        # exponential backoff base
SCHEDULER_RECONCILE_INTERVAL_MS=60000
SCHEDULE_MIN_LEAD_MS=30000        # clock-skew allowance for "must be in the future"
```

`docker-compose.yml` gains a `redis:7-alpine` service; the app connects over `REDIS_URL`
the same way it already connects to Postgres over `DATABASE_URL`.

---

## 5. Publishing — the one transaction everything funnels through

`publishing.service.publishVersion(versionId, { actorId, requestId, jobId? })` is the only
code path that makes something live. Whether the trigger is an editor clicking publish or
the BullMQ worker firing, the same function runs, inside `prisma.$transaction`:

1. `UPDATE content_versions SET status='PUBLISHED', publishedAt=now() WHERE id=$v AND status IN ('APPROVED','PENDING_REVIEW','SCHEDULED','UNPUBLISHED')` — **status-guarded**; `count === 0` ⇒ someone already published it ⇒ return `{ alreadyPublished: true }` and commit nothing else.
2. Supersede the outgoing version if the item had one (`PUBLISHED` → `SUPERSEDED`).
3. Move the pointer: `publishedVersionId`, `publishedTitle`, `publishedAt`, `status='PUBLISHED'`, `unpublishedAt=null`.
4. If `jobId` is present: `UPDATE scheduled_publications SET status='SUCCEEDED' WHERE id=$job AND status IN ('PENDING','CLAIMED')`.
5. Append the `AuditEvent` (`PUBLISHED` or `SCHEDULED_PUBLISH_EXECUTED`, `actorId` null for the worker).

Step 1 returning 0 rows is the idempotency hinge: a replay is a no-op, not a second
publish, and because 1–5 share a transaction there is no window where the item is live
but the job row still reads `PENDING`. This guard is what makes the system correct even
though BullMQ itself only gives *at-least-once* delivery (a stalled job can be re-picked
by another worker and re-run).

### Scheduling a job (`editorial.service.schedule`)

Redis and Postgres don't share a transaction, so the two writes are ordered deliberately:

1. `prisma.$transaction`: version → `SCHEDULED`, insert `scheduled_publications` row
   (`status='PENDING'`, `id` = the row's own uuid), audit event. Commit.
2. After commit, `scheduledPublicationQueue.add('publish', { versionId, jobRowId },
   { jobId: jobRowId, delay: scheduledFor - Date.now() })`. Passing the DB row's id as
   BullMQ's `jobId` makes the enqueue idempotent — adding the same id twice is a no-op —
   and gives the reconciler a stable key to check against.
3. If step 2 throws (Redis down), swallow it: the row is already `PENDING` in Postgres and
   the reconciler (below) will enqueue it on its next sweep. The DB, not the queue, is the
   source of truth for "this needs to publish."

Cancelling (`DELETE /editorial/versions/:versionId/schedule`) is the mirror: update the DB
row to `CANCELLED`/version back to `APPROVED` first, then best-effort
`(await queue.getJob(jobRowId))?.remove()`. If the remove fails or races with the worker
already having claimed the job, `publishVersion`'s step 1 status guard still prevents a
cancelled item from going live — same defence as the concurrent-publish case.

### The worker (`scheduled-publication.worker.ts`)

```
new Worker('scheduled-publications', async (job) => {
  await publishVersion(job.data.versionId, { actorId: null, jobId: job.data.jobRowId })
}, {
  connection: redis,
  concurrency: SCHEDULER_CONCURRENCY,
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
})
```

Retry/backoff is BullMQ's own: `attempts: SCHEDULER_MAX_ATTEMPTS`,
`backoff: { type: 'exponential', delay: SCHEDULER_BACKOFF_MS }` set on the job at
`queue.add()` time. A job that exhausts its attempts lands in BullMQ's `failed` set;
`publishing.service` also marks the `scheduled_publications` row `FAILED` with
`lastError` in its own catch, so failures are visible from Postgres without reading Redis.

Two independent defences against a double publish: BullMQ's own per-job lock (a stalled
worker's job is only re-claimed after `lockDuration` elapses, same shape as the old
lease), and the status-guarded `UPDATE` in `publishVersion` step 1, which makes a
double-claim a no-op regardless of what the queue does. The partial unique index on
`scheduled_publications` still prevents a version being scheduled twice concurrently.

### The reconciler (`scheduled-publication.reconciler.ts`)

Runs every `SCHEDULER_RECONCILE_INTERVAL_MS` and on process start:

```
SELECT id, versionId, scheduledFor FROM scheduled_publications
  WHERE status = 'PENDING'
for each row:
  if not (await queue.getJob(row.id)):
    queue.add('publish', { versionId: row.versionId, jobRowId: row.id },
      { jobId: row.id, delay: max(0, row.scheduledFor - now()) })
```

This is what replaces the old lease-reaper: instead of reaping a stuck `CLAIMED` lease, it
heals the gap between "Postgres says this must still publish" and "Redis has no memory of
it" — a queue flush, a Redis restart, or step 2 above swallowing an add failure all show
up the same way and get the same fix.

**Past-due schedules:** `scheduledFor` must be ≥ `now() + SCHEDULE_MIN_LEAD_MS` at the
request boundary (422 otherwise). An item whose scheduled time elapses *while it sits in
review* keeps its original `scheduledFor`, is created `PENDING`, and publishes on the next
tick — late, once, with the intended time preserved. Documented in `api.md`.

---

## 6. Input validation (§6 "bad input rejected before business logic")

In `validate()` at the edge, so the service never sees raw input:

- `title` 1–200 trimmed non-empty; `body` 1–100k; `excerpt` ≤ 500; `changeSummary` required on every version write.
- `scheduledFor` — `z.iso.datetime()` → `Date`, must carry a date *and* time, must be future by `SCHEDULE_MIN_LEAD_MS`.
- Reject body: `comment` trimmed, min 1 — mirrored by the `reviews_reject_requires_comment` CHECK constraint already in the migration.
- `page` ≥ 1 and `pageSize` 1–50, both `z.coerce.number().int()` with defaults; a non-numeric or out-of-range value is a 422, and a `page` past `totalPages` is a 422 rather than a silent empty array.
- Path ids: `z.uuid()`, so a garbage id is 422 before it reaches Postgres.
- `BODY_LIMIT` may need raising from `100kb` for long article bodies — set it to `1mb`.

---

## 7. Tests

Test runner is not yet installed — add `vitest` + `supertest` and a `test:` script,
pointing at `.env.test`, a throwaway Postgres schema, and a throwaway Redis DB index
(`REDIS_URL` with `/1` or similar) per run.

Required by §6, in priority order:

1. **Exactly-once, concurrent.** Seed one due `scheduled_publications` row and enqueue its
   BullMQ job. Call `publishVersion` twice concurrently with `Promise.all` for the same
   `versionId`/`jobId` — this exercises the step-1 status guard directly, independent of
   whether BullMQ itself ever double-delivers. Assert: one `content_versions` row flipped
   to `PUBLISHED`, the job row `SUCCEEDED` exactly once, exactly one
   `SCHEDULED_PUBLISH_EXECUTED` audit event, item pointer set once. Then run two real
   `Worker` instances against the same queue with a short `lockDuration` and force a
   stall (kill one worker mid-job) to prove the reclaim also converges to one publish.
2. **Ownership boundary.** Author B `PATCH`es author A's draft by id → 404, and the row is byte-identical afterwards. Same for submit, revise, delete.
3. **Visibility.** Draft / pending / unpublished ids and slugs → 404 on both public endpoints, unauthenticated.
4. **Illegal transitions.** Publish a `REJECTED` version → 409. Submit a `PUBLISHED` version → 409. Schedule twice → 409 from the partial unique index.
5. **Revision isolation.** Start a revision of a live item, edit it heavily, assert the public detail still returns the old body until the revision is approved *and* published.
6. **Past-due.** `scheduledFor` in the past → 422. A job whose `scheduledFor` elapsed during review publishes on the first tick.
7. **Pagination.** Seed > 2 pages of published items. Walk `page=1..n`, assert no duplicates or gaps across pages, that `meta.totalItems`/`totalPages` match the seed, that the last page is partial, and that `page=0`, `pageSize=500` and `page=totalPages+1` are each 422. `EXPLAIN` the listing query and assert an index scan on `(status, publishedAt DESC, id DESC)` — no sequential scan, no in-memory sort.

---

## 8. Build order

1. Pagination + slug utils, DTO interfaces, env additions.
2. Repositories (scope-aware queries) — no business logic in them.
3. `content-state.ts` transition table + unit tests. Cheap, and everything else leans on it.
4. `content.service` + controller + routes: create, edit, submit, history. Authoring works end to end.
5. Public read endpoints (paged listing, slug detail) — proves the visibility boundary early.
6. `publishing.service.publishVersion` — the transactional core, with its own tests before any caller exists.
7. `editorial.service` + routes on top of it: approve / reject / publish / schedule / cancel / unpublish.
8. Redis config + BullMQ queue/worker/reconciler, wired into `src/index.ts` behind `SCHEDULER_ENABLED`; `docker-compose.yml` gains the `redis` service.
9. Concurrency test (§7.1), then the rest of the suite.
10. Restore `api.md` with the content + editorial sections; confirm `docker compose up` brings the whole thing up with migrations applied and no manual steps (§6).

## 9. Open decisions to confirm before step 4

- **Slug source.** Derived from the title at item creation and then frozen (public URLs stay stable), with editors able to change it explicitly. Alternative — re-slug on every publish — breaks links; going with frozen unless you say otherwise.
- **Direct publish from `PENDING_REVIEW`.** §3.2 allows an editor to "publish outright", so the transition table permits it and records a `Review` with `decision = PUBLISH`. It skips the `APPROVED` stop.
- **Author self-service unpublish.** Restricted to editors, since unpublishing is a public-visibility change. Easy to relax.
