# Data model — design notes

Companion to `prisma/schema.prisma`. This is the "be ready to defend your mechanism"
document: what each decision buys, and what breaks without it.

## 1. Item vs. version

`ContentItem` is the stable, publicly addressable entity (it owns the slug and the
author). It holds **no body text**. Everything readable lives in `ContentVersion`,
a numbered snapshot.

`ContentItem.publishedVersionId` is the single pointer to what the public is served.
It is a unique FK, so an item can never have two live versions.

This is what makes §3.4 work. "Revise a published post" creates a *new* `ContentVersion`
row with `parentVersionId` pointing at the live one. The live version is a different
row that nothing in the draft path writes to, so a half-finished revision cannot leak
into public view no matter how long it sits in draft. Publishing the revision is a
single pointer move inside one transaction:

```
publishedVersionId: old -> new
old.status:  PUBLISHED -> SUPERSEDED
new.status:  APPROVED  -> PUBLISHED
```

An alternative model — one mutable row with a `status` column — cannot express
"live version and in-progress revision at the same time" without a shadow copy, which
is this table under a worse name.

### Version numbering

`ContentItem.versionCounter` is bumped in the same transaction that inserts the version,
and `@@unique([contentItemId, versionNumber])` backstops it. Two concurrent "start a
revision" requests therefore cannot mint the same number: one of them hits the unique
violation and retries. `max(versionNumber) + 1` computed in application code would not
survive that race.

## 2. Status: two levels, deliberately

- `ItemStatus` — what the public sees: `DRAFT` / `PUBLISHED` / `UNPUBLISHED` / `ARCHIVED`.
- `VersionStatus` — where a single version sits in review: `DRAFT` → `PENDING_REVIEW` →
  `APPROVED` | `REJECTED` | `SCHEDULED` → `PUBLISHED` → `SUPERSEDED` | `UNPUBLISHED`.

Review is a property of a version, not of the item — item 42 can be `PUBLISHED` while
version 7 of it is `PENDING_REVIEW`. Collapsing these into one column is exactly the
bug §3.4 warns about.

Rejection (§3.2) writes a `Review` row with `decision = REJECT` and a required comment,
and returns the version to the author. The comment stays attached to the version's
review history rather than overwriting a single `rejectionReason` field, so a version
rejected twice keeps both reasons.

## 3. Visibility (§3.5)

The public read path is one indexed condition:

```sql
WHERE status = 'PUBLISHED'        -- listing, plus slug/id for the detail view
```

served by `content_items (status, publishedAt DESC, id DESC)`. A direct-ID guess for a
draft, pending, rejected or unpublished item misses this index predicate and returns
404 — the same 404 a nonexistent ID returns, so the endpoint does not leak existence.

`publishedTitle` / `publishedAt` are denormalised onto the item so the listing needs no
join to `content_versions`, and pagination is keyset (`(publishedAt, id) < cursor`),
never `OFFSET`. Both requirements from §6 ("stay usable as content accumulates") come
from this pair.

## 4. Scheduled publishing — the exactly-once argument (§3.3)

`ScheduledPublication` is a claimable job row. Three independent mechanisms have to all
fail before an item publishes twice.

**(a) Partial unique index — you cannot queue the same work twice.**

```sql
CREATE UNIQUE INDEX ... ON scheduled_publications ("versionId")
  WHERE status IN ('PENDING', 'CLAIMED');
```

At most one live job per version. A duplicate schedule request is a unique violation the
API maps to 409, not a second publish. Terminal rows (`SUCCEEDED`/`FAILED`/`CANCELLED`)
are excluded so reschedule history accumulates freely.

**(b) BullMQ's job lock — two instances do not run the same job.**

The row's id is the BullMQ `jobId`, so enqueueing the same row twice is a no-op in Redis.
Only one worker holds a job's lock at a time; a stalled worker's job is re-claimed only
after `lockDuration` elapses. This is a defence, not the guarantee — (c) is what makes a
double execution harmless regardless of what the queue does.

**(c) Status-guarded conditional update — a replay is a no-op.**

```sql
UPDATE scheduled_publications SET status = 'SUCCEEDED', "completedAt" = now()
  WHERE id = $id AND status = 'PENDING';
```

If this affects 0 rows, someone else already did the work: abort the transaction and
publish nothing. The publish itself is guarded the same way
(`UPDATE content_versions SET status='PUBLISHED' WHERE id=$v AND status='SCHEDULED'`),
so the whole unit is idempotent under replay. The publish and the job completion are in
**one transaction** — there is no window where the item is live but the job still reads
`PENDING`.

That is the §6 test: run the worker twice, or two workers concurrently, against the same
due item and assert one `PUBLISHED` transition, one `SUCCEEDED` job, one `PUBLISHED`
audit event.

**Crash recovery.** The reconciler (`src/jobs/scheduled-publication.reconciler.ts`)
runs on start and every `SCHEDULER_RECONCILE_INTERVAL_MS`, re-enqueueing any `PENDING`
row BullMQ has no job for (Redis flush/restart, a swallowed `queue.add` failure). Since
(c) makes re-execution a no-op, re-enqueueing a job that actually succeeded is safe.
Retries and backoff are BullMQ job options (`SCHEDULER_MAX_ATTEMPTS`,
`SCHEDULER_BACKOFF_MS`); once they are exhausted the row is parked `FAILED` with
`lastError` for a human, so failures are visible from Postgres without reading Redis.

**Scale.** The due scan is a range scan over the partial index
`(scheduledFor, id) WHERE status = 'PENDING'`, so 50,000 pending future items cost
nothing — only the due prefix is read. The index shrinks as jobs complete, since
terminal rows drop out of the predicate.

### Past-due schedules (§3.3, walkthrough Q1)

A schedule time in the past is **rejected at the request boundary** (`scheduledFor` must
be in the future, with a small clock-skew allowance). If an item is approved *after* its
scheduled time has passed — the time elapsed while it sat in review — the job is created
`PENDING` with the past `scheduledFor`, so the very next worker tick finds it due and
publishes it immediately. It publishes late, once, with the real intended time preserved
on the row; it is never silently dropped and never publishes twice. Documented rather
than inferred, because "drop it" and "publish now" are both defensible and the difference
matters to an editor.

## 5. Authorization (§3.1, §6, walkthrough Q2)

`ContentItem.authorId` is the ownership fact the server checks. An author's write is
scoped by `WHERE id = $id AND authorId = $me`, so "edit another author's draft by ID"
matches zero rows and returns 404/403 — enforced by the query, not by the UI and not by
a check that a later code path can forget. Editors bypass the `authorId` predicate by
role. `authorId` uses `onDelete: Restrict`: a user with content cannot be hard-deleted
out from under the audit trail.

## 6. History (§3.6)

Two tables, different jobs:

- `ContentVersion` — *what* the content was. `parentVersionId` gives lineage, so the
  history reads as a chain and a restore is a new version branched from an old one
  (a new event, not a rewrite of the past — the §8 restore requirement).
- `AuditEvent` — *what happened*: actor, action, timestamp, before/after `metadata`,
  and `requestId` correlating back to the HTTP request in the logs. Append-only; nothing
  in the application updates or deletes it.

"What would a public reader have seen at time T" is answerable from the audit trail:
replay `PUBLISHED` / `UNPUBLISHED` events for the item up to T to get the version that
was live, then read that (immutable) version's body.

## 7. Constraints in the migration, not just in Zod

Validation lives in the request schemas *and* in the database, because a constraint the
service layer can forget is not a constraint. The initial migration adds:

| Constraint | Prevents |
|---|---|
| `scheduled_publications_one_live_job_per_version` | Double-queueing a version |
| `scheduled_publications_due_scan` | Full scans on the worker's hot path |
| `content_versions_one_open_draft_per_item` | Two concurrent `startRevision` calls creating duplicate open drafts for the same item |
| `reviews_reject_requires_comment` | A rejection with no reason (§3.2) |
| `reviews_schedule_requires_time` | A `SCHEDULE` decision with no instant |
| `scheduled_publications_pending_needs_time` | A pending job with no time (§6 bad input) |
| `content_items_published_has_version` | `PUBLISHED` with nothing actually live |
| `content_versions_scheduled_needs_time` | `SCHEDULED` with no publish time |
| `content_versions_version_number_positive` | Version 0 / negative numbering |
| `content_versions_title_not_blank` | Empty titles |
| `users_email_lower_key` | Case-variant duplicate accounts |
