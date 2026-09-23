-- ---------------------------------------------------------------------------
-- Drop the lease/retry columns from the original FOR UPDATE SKIP LOCKED
-- polling-worker design (docs/EDGE_CASES.md EC-18). Scheduling runs on BullMQ
-- plus the reconciler: BullMQ's job lock replaces the lease, its `attempts` /
-- `backoff` job options replace the retry columns. Nothing reads or writes
-- these. `lastError` stays -- markFailed still records it.
-- ---------------------------------------------------------------------------

-- Explicit, though Postgres would drop it along with its columns.
ALTER TABLE "scheduled_publications"
  DROP CONSTRAINT "scheduled_publications_attempts_nonneg";

DROP INDEX "scheduled_publications_status_leaseExpiresAt_idx";

ALTER TABLE "scheduled_publications"
  DROP COLUMN "lockedBy",
  DROP COLUMN "lockedAt",
  DROP COLUMN "leaseExpiresAt",
  DROP COLUMN "attempts",
  DROP COLUMN "maxAttempts",
  DROP COLUMN "nextAttemptAt";
