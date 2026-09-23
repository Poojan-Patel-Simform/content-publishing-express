-- ---------------------------------------------------------------------------
-- Invariant Prisma's schema language cannot express (see prisma/SCHEMA.md §7).
-- ---------------------------------------------------------------------------

-- At most one open (DRAFT or REJECTED -- content-state.ts's
-- EDITABLE_VERSION_STATUSES) ContentVersion per item. Without this, two
-- concurrent startRevision calls for the same item can both pass their
-- pre-checks and each INSERT a DRAFT, leaving one silently orphaned.
CREATE UNIQUE INDEX "content_versions_one_open_draft_per_item"
  ON "content_versions" ("contentItemId")
  WHERE "status" IN ('DRAFT', 'REJECTED');
