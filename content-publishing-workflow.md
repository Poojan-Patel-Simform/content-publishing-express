# POC: Content Publishing Workflow

**Track:** Content · **Status:** Required · **Path:** React to Full Stack — 101 (2-week solo POC)
**Stack:** Express or Next.js (engineer's choice) · PostgreSQL · Prisma

## 1. Background

Content goes live with typos and half-finished sentences because there's no review step between
"an author finished writing" and "the public can see it." Scheduled posts get published
manually by whoever happens to remember, which means some go out hours late and some don't go
out at all.

You're building the system that fixes this: authors write in draft, editors review and either
approve, reject with comments, or publish outright, and anything scheduled for a future time
publishes itself — reliably, and exactly once.

This POC's centre of gravity is **safe, idempotent scheduled publishing**. The editorial review
flow is straightforward to demo; it's the "publish this automatically at the right time, and
only once, even if the mechanism runs more than once or from more than one place" requirement
that separates a real solution from a happy-path one.

## 2. Actors

| Role | Can do |
|---|---|
| **Author** | Create and edit their own drafts, submit for review |
| **Editor** | Review submitted content, approve/reject with comments, publish, edit anything |
| **Public / Reader** *(unauthenticated)* | View only published content |

## 3. Functional requirements

### 3.1 Drafting
- Authors create content items in a `draft` state with a title, body, and any metadata you
  choose (tags, category).
- **Authors can edit only their own drafts.** Editors can edit anything, at any stage. Prove
  this boundary is enforced on the server, not just hidden in the UI.

### 3.2 Editorial review
- An author submits a draft for review, moving it to a `pending review` state.
- An editor reviews a pending item and either approves it, rejects it with a required comment
  (returning it to the author as a draft with the comment attached), or publishes it directly.

### 3.3 Scheduled publishing
- Content can be scheduled to publish at a future date/time instead of publishing immediately.
- **A scheduled item must publish at (or shortly after) its scheduled time, exactly once — even
  if your publishing mechanism is checked or triggered more than once, or if you're running more
  than one instance of the app.** This is the core hard case of this POC.
- Decide and document what happens to an item scheduled for a time that has already passed by
  the time it's approved.

### 3.4 Unpublishing and revision
- Published content can be unpublished (removed from public view without deleting it) or
  revised into a new draft version while the currently published version remains visible to the
  public until the revision itself is approved and published.
- Think through how "a new draft based on published content" doesn't simply overwrite the
  live version the moment someone starts editing.

### 3.5 Visibility boundaries
- The public listing and public detail view show only content currently in `published` state —
  never draft, pending, rejected, or unpublished content, including by guessing a direct URL/ID.

### 3.6 Revision history
- Every content item retains a full history of its versions — at minimum, what changed, who
  changed it, and when — not just its current body text.
- You should be able to show the history of a single item and identify what a public reader
  would have seen at any point in that history.

## 4. Data to think through

You choose the exact schema. At minimum, your model needs to represent: content items and their
current state (draft/pending/published/unpublished), scheduled publish times, editorial comments
tied to a review decision, and a version history distinct from "current state" so that a
revision-in-progress doesn't clobber what's live.

The question worth sitting with before you write any code: how does scheduled publishing
actually happen — a background job polling for due items, a queued delayed job, or something
else — and what, specifically, makes it safe to run twice, or to run from two application
instances at once, without double-publishing or corrupting state? Be ready to defend your
mechanism, not just describe it.

## 5. How it's exposed

Design the API surface — routes, methods, request/response shapes — however fits the workflow
above. There's no prescribed structure here; the requirements in §3 are the spec, not a
particular set of endpoints.

## 6. Things this POC will specifically be checked for

- Bad input — a schedule time with no date, a status transition that doesn't make sense (e.g.
  publishing a rejected item without review) — should be rejected before it reaches your
  business logic.
- There's no anonymous path for authoring or reviewing; every draft, submission and decision is
  tied to a real, authenticated user. Reading published content is the one deliberately
  anonymous path — everything else requires auth.
- An author attempting to edit another author's draft directly by its ID must be refused,
  proven by a test — not merely hidden by the UI.
- The scheduled-publish guarantee (§3.3) is the whole point of this POC. Have a test that
  simulates the publish mechanism running twice (or concurrently, as if from two instances) for
  the same due item and asserts it is published exactly once, without a duplicate or corrupted
  state.
- The public listing and any admin/editor content list need to stay usable as content
  accumulates — neither should mean loading everything into memory and filtering in code.
- Every submission, review decision, publish and unpublish action should leave a structured
  trace — who did it, when, and what changed.
- The whole thing should come up with `docker compose up` and no manual setup beyond a
  documented `.env`.

## 7. Walkthrough questions to expect

NOTE: These are indicative questions only. Expect to be asked further questions in a similar
spirit during the walkthrough.

1. Content scheduled for a past time — what happens?
2. An author edits someone else's draft through the API. What happens?
3. Scheduled publishing — how does it actually happen? Walk me through the mechanism.

## 8. If you finish early (optional)

Don't add new features — deepen what's here:
- Simulate two application instances both running your scheduled-publish mechanism at once
  against a shared database and demonstrate no item is ever published twice.
- Load-test the scheduled-publish check at a simulated 50,000 pending scheduled items and show
  it still finds and publishes only the due ones efficiently.
- Add the ability to restore a previous revision of a published item as the new published
  version, and show the revision history correctly reflects the restore as a new event rather
  than rewriting the past.
