-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('AUTHOR', 'EDITOR');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "VersionStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'SCHEDULED', 'REJECTED', 'PUBLISHED', 'SUPERSEDED', 'UNPUBLISHED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('APPROVE', 'REJECT', 'PUBLISH', 'SCHEDULE');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'CLAIMED', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('ITEM_CREATED', 'VERSION_CREATED', 'VERSION_UPDATED', 'SUBMITTED_FOR_REVIEW', 'REVIEW_APPROVED', 'REVIEW_REJECTED', 'PUBLISHED', 'PUBLISH_SCHEDULED', 'SCHEDULE_CANCELLED', 'SCHEDULED_PUBLISH_EXECUTED', 'UNPUBLISHED', 'REVISION_STARTED', 'REVISION_RESTORED', 'ITEM_ARCHIVED', 'USER_LOGGED_IN');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'AUTHOR',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_version_tags" (
    "versionId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "content_version_tags_pkey" PRIMARY KEY ("versionId","tagId")
);

-- CreateTable
CREATE TABLE "content_items" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "status" "ItemStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedVersionId" TEXT,
    "publishedTitle" TEXT,
    "publishedAt" TIMESTAMP(3),
    "unpublishedAt" TIMESTAMP(3),
    "versionCounter" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "content_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_versions" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "VersionStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "excerpt" TEXT,
    "categoryId" TEXT,
    "parentVersionId" TEXT,
    "changeSummary" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "unpublishedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "scheduledPublishAt" TIMESTAMP(3),

    CONSTRAINT "content_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "decision" "ReviewDecision" NOT NULL,
    "comment" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_publications" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "lockedBy" TEXT,
    "lockedAt" TIMESTAMP(3),
    "leaseExpiresAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "scheduled_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "actorId" TEXT,
    "contentItemId" TEXT,
    "versionId" TEXT,
    "requestId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);


-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refreshTokenHash_key" ON "sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_revokedAt_idx" ON "sessions"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tags_slug_key" ON "tags"("slug");

-- CreateIndex
CREATE INDEX "content_version_tags_tagId_idx" ON "content_version_tags"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "content_items_slug_key" ON "content_items"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "content_items_publishedVersionId_key" ON "content_items"("publishedVersionId");

-- CreateIndex
CREATE INDEX "content_items_status_publishedAt_id_idx" ON "content_items"("status", "publishedAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "content_items_authorId_status_updatedAt_idx" ON "content_items"("authorId", "status", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "content_items_updatedAt_id_idx" ON "content_items"("updatedAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "content_versions_contentItemId_versionNumber_idx" ON "content_versions"("contentItemId", "versionNumber" DESC);

-- CreateIndex
CREATE INDEX "content_versions_status_submittedAt_idx" ON "content_versions"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "content_versions_status_scheduledPublishAt_idx" ON "content_versions"("status", "scheduledPublishAt");

-- CreateIndex
CREATE UNIQUE INDEX "content_versions_contentItemId_versionNumber_key" ON "content_versions"("contentItemId", "versionNumber");

-- CreateIndex
CREATE INDEX "reviews_versionId_createdAt_idx" ON "reviews"("versionId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "reviews_contentItemId_createdAt_idx" ON "reviews"("contentItemId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "reviews_reviewerId_createdAt_idx" ON "reviews"("reviewerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "scheduled_publications_status_scheduledFor_idx" ON "scheduled_publications"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "scheduled_publications_status_leaseExpiresAt_idx" ON "scheduled_publications"("status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "scheduled_publications_versionId_status_idx" ON "scheduled_publications"("versionId", "status");

-- CreateIndex
CREATE INDEX "scheduled_publications_contentItemId_idx" ON "scheduled_publications"("contentItemId");

-- CreateIndex
CREATE INDEX "audit_events_contentItemId_createdAt_idx" ON "audit_events"("contentItemId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_events_actorId_createdAt_idx" ON "audit_events"("actorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_events_action_createdAt_idx" ON "audit_events"("action", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_version_tags" ADD CONSTRAINT "content_version_tags_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "content_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_version_tags" ADD CONSTRAINT "content_version_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_publishedVersionId_fkey" FOREIGN KEY ("publishedVersionId") REFERENCES "content_versions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_parentVersionId_fkey" FOREIGN KEY ("parentVersionId") REFERENCES "content_versions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "content_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_publications" ADD CONSTRAINT "scheduled_publications_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_publications" ADD CONSTRAINT "scheduled_publications_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "content_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Invariants Prisma's schema language cannot express.
-- These are the guardrails the walkthrough questions are about: they hold even
-- if a bug slips past the service layer or a second app instance races us.
-- ---------------------------------------------------------------------------

-- 1. EXACTLY-ONCE SCHEDULING.
--    At most one live (PENDING or CLAIMED) job per version. Scheduling the same
--    version twice is now a unique-violation, not a double publish. Completed,
--    failed and cancelled rows are excluded so history accumulates freely.
CREATE UNIQUE INDEX "scheduled_publications_one_live_job_per_version"
  ON "scheduled_publications" ("versionId")
  WHERE "status" IN ('PENDING', 'CLAIMED');

-- 2. The due-items scan, covering the 50k-pending case as an index-only range
--    scan over just the rows a worker can actually claim.
CREATE INDEX "scheduled_publications_due_scan"
  ON "scheduled_publications" ("scheduledFor", "id")
  WHERE "status" = 'PENDING';

-- 3. A schedule must have an actual instant. Belt-and-braces against the
--    "schedule time with no date" input case.
ALTER TABLE "scheduled_publications"
  ADD CONSTRAINT "scheduled_publications_pending_needs_time"
  CHECK ("status" <> 'PENDING' OR "scheduledFor" IS NOT NULL);

ALTER TABLE "scheduled_publications"
  ADD CONSTRAINT "scheduled_publications_attempts_nonneg"
  CHECK ("attempts" >= 0 AND "maxAttempts" > 0);

-- 4. A rejection without a reason is not a rejection.
ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_reject_requires_comment"
  CHECK ("decision" <> 'REJECT' OR ("comment" IS NOT NULL AND btrim("comment") <> ''));

-- 5. A SCHEDULE decision must carry the time it scheduled for.
ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_schedule_requires_time"
  CHECK ("decision" <> 'SCHEDULE' OR "scheduledFor" IS NOT NULL);

-- 6. PUBLISHED means something is actually live; nothing else may point at a
--    published version. This is what keeps the public read a single indexed
--    lookup with no defensive null handling.
ALTER TABLE "content_items"
  ADD CONSTRAINT "content_items_published_has_version"
  CHECK (
    ("status" = 'PUBLISHED' AND "publishedVersionId" IS NOT NULL)
    OR ("status" <> 'PUBLISHED')
  );

-- 7. Version numbers start at 1.
ALTER TABLE "content_versions"
  ADD CONSTRAINT "content_versions_version_number_positive"
  CHECK ("versionNumber" >= 1);

-- 8. A SCHEDULED version must know when it goes live.
ALTER TABLE "content_versions"
  ADD CONSTRAINT "content_versions_scheduled_needs_time"
  CHECK ("status" <> 'SCHEDULED' OR "scheduledPublishAt" IS NOT NULL);

-- 9. Non-empty content. Cheap, and stops "half-finished" from meaning "empty".
ALTER TABLE "content_versions"
  ADD CONSTRAINT "content_versions_title_not_blank"
  CHECK (btrim("title") <> '');

-- 10. Case-insensitive unique email.
CREATE UNIQUE INDEX "users_email_lower_key" ON "users" (lower("email"));
