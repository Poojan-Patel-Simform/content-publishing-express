# API Documentation

Base URL: `/api/v1`

## Conventions

### Response envelope

All JSON responses use a consistent envelope.

**Success**

```json
{
  "success": true,
  "data": {}
}
```

**Error**

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required",
    "requestId": "b1e2...-uuid",
    "details": []
  }
}
```

`details` is only present for errors that carry field-level info (e.g. validation errors). A `stack` field is also added in non-production environments for unexpected (non-operational) errors.

### Error codes

| Code                  | HTTP Status | Notes                                                                                                                           |
| --------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `BAD_REQUEST`         | 400         | Malformed / semantically invalid request (e.g. invalid or expired token)                                                        |
| `UNAUTHORIZED`        | 401         | Missing/invalid credentials, missing/invalid session, invalid refresh token                                                     |
| `FORBIDDEN`           | 403         | Account suspended, or general permission denial                                                                                 |
| `EMAIL_NOT_VERIFIED`  | 403         | Login blocked until the account's email is verified                                                                             |
| `NOT_FOUND`           | 404         | Resource not found (also used when Google OAuth is not configured, and whenever an ownership check fails — see Authoring below) |
| `CONFLICT`            | 409         | Resource already exists, or an illegal state transition was attempted                                                           |
| `PAYLOAD_TOO_LARGE`   | 413         | Request body exceeds configured limit                                                                                           |
| `VALIDATION_ERROR`    | 422         | Zod schema validation failed on body/query/params                                                                               |
| `TOO_MANY_REQUESTS`   | 429         | Rate limit exceeded                                                                                                             |
| `REFRESH_IN_FLIGHT`   | 401         | A racing tab already rotated the refresh token; retry with current cookies                                                      |
| `SERVICE_UNAVAILABLE` | 503         | Downstream dependency (e.g. database) unavailable                                                                               |

### Authentication

Two mechanisms are accepted for protected endpoints (`requireAuth` middleware):

- **Cookie** — `cp_at` (access token), sent automatically by the browser.
- **Header** — `Authorization: Bearer <access token>`, used as a fallback if the cookie isn't present.

Every route under `/items` and `/editorial` additionally requires `requireActiveAccount` (account `status = ACTIVE`) and `requireVerifiedEmail` (`emailVerifiedAt` set). `/editorial` further requires `requireEditor` (`role = EDITOR`).

### Cookies

| Cookie     | Purpose                                                                                    | Path           | Lifetime                                         | HttpOnly / Secure / SameSite                                    |
| ---------- | ------------------------------------------------------------------------------------------ | -------------- | ------------------------------------------------ | --------------------------------------------------------------- |
| `cp_at`    | Access token (JWT)                                                                         | `/`            | `ACCESS_TOKEN_TTL_S` (default 900s / 15 min)     | Yes / per `COOKIE_SECURE` / per `COOKIE_SAMESITE`               |
| `cp_rt`    | Refresh token (opaque, hashed server-side)                                                 | `/api/v1/auth` | Until `REFRESH_TOKEN_TTL_DAYS` (default 30 days) | Yes / per `COOKIE_SECURE` / per `COOKIE_SAMESITE`               |
| `cp_oauth` | Signed OAuth state + PKCE verifier + returnTo, used only during the Google OAuth handshake | `/api/v1/auth` | `OAUTH_STATE_TTL_MS`                             | Yes / per `COOKIE_SECURE` / forced `lax` if configured `strict` |

`cp_at` and `cp_rt` are set together on login, refresh, and OAuth callback success, and cleared together on logout, logout-all, and most refresh failures.

### Rate limiting

All endpoints below except `/logout`, `/logout-all`, `/me`, and the Google OAuth routes are behind a stricter auth rate limiter (`skipSuccessfulRequests: true`, limit = `AUTH_RATE_LIMIT_MAX` per window). Exceeding it returns `429 TOO_MANY_REQUESTS`. Every other endpoint is behind the global limiter (`RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW_MS`).

### `AuthUser` / `PublicUser` shape

Returned wherever a user object is included in a response. Never includes the password hash.

```json
{
  "id": "uuid",
  "email": "user@example.com",
  "displayName": "Jane Doe",
  "role": "AUTHOR",
  "status": "ACTIVE",
  "emailVerifiedAt": "2026-01-01T00:00:00.000Z",
  "avatarUrl": null
}
```

- `role`: `"AUTHOR" | "EDITOR"`
- `status`: `"ACTIVE" | "SUSPENDED"`
- `emailVerifiedAt`: ISO date string, or `null` if not verified

### `ContentVersion` state machine

`ContentVersion.status` governs what write actions are legal (`src/services/content-state.ts`), enforced server-side before any write — an illegal transition always returns `409 CONFLICT` rather than silently doing nothing or partially applying.

```
DRAFT          → PENDING_REVIEW (submit) | DISCARDED
PENDING_REVIEW → APPROVED | REJECTED | PUBLISHED (direct publish) | SCHEDULED
REJECTED       → PENDING_REVIEW (resubmit after edit)
APPROVED       → PUBLISHED | SCHEDULED
SCHEDULED      → PUBLISHED (worker) | APPROVED (schedule cancelled)
PUBLISHED      → SUPERSEDED (a newer version goes live) | UNPUBLISHED
UNPUBLISHED    → PUBLISHED (re-publish)
```

A version may only be edited (`PATCH .../versions/:versionId`) while its status is `DRAFT` or `REJECTED`; every other status is immutable and a `PATCH` on one returns `409 CONFLICT`.

`ContentItem.status` follows from the pointer move rather than being set independently: `publishedVersionId != null` ⇒ item `PUBLISHED`; unpublishing nulls the pointer and sets `UNPUBLISHED`; archiving sets `ARCHIVED`.

### Ownership & visibility

- **Authoring (`/items`)**: an author only ever sees/mutates their own items — the `authorId` predicate is folded directly into the repository query, never checked after the fact. An author operating on another author's item id gets `404 NOT_FOUND`, identical to a nonexistent id, so ids are not enumerable this way. Editors bypass the `authorId` predicate.
- **Public (`/content`)**: only items with `status = PUBLISHED` are visible. A draft/pending/unpublished item's id or slug returns the same `404 NOT_FOUND` as a nonexistent one.

### Pagination (page/offset)

Every paginated list (`GET /content`, `GET /items`, `GET /editorial/queue`) uses the same page/offset contract:

| Query param | Constraints               |
| ----------- | ------------------------- |
| `page`      | integer, ≥ 1, default 1   |
| `pageSize`  | integer, 1–50, default 20 |

Response shape:

```json
{
  "success": true,
  "data": {
    "items": [],
    "meta": {
      "page": 2,
      "pageSize": 20,
      "totalItems": 137,
      "totalPages": 7,
      "hasPrev": true,
      "hasNext": true
    }
  }
}
```

`totalItems` comes from a `COUNT(*)` issued in the same transaction as the page query, so it never drifts from the rows actually returned. A `page` beyond `totalPages` (or `page=0`, or a `pageSize` outside 1–50) is rejected — `422 VALIDATION_ERROR`, never a silent empty array.

Two tradeoffs of page/offset, stated for the record:

- **Deep pages get slower** — Postgres walks and discards the offset rows, so a very high page number costs more than page 1. Mitigated by the 50-row `pageSize` cap and by rejecting an out-of-range `page` outright.
- **Rows can shift between pages** — if something publishes while a reader is paging through, an item can repeat or be skipped at a page boundary. Acceptable for a public listing.

---

## Endpoints

### `POST /api/v1/auth/register`

Register a new account. Enumeration-safe: always returns the same generic message whether or not the email is already registered (a duplicate is a silent no-op). Sends a verification email on success.

**Auth required:** No

**Request body**

```json
{
  "email": "user@example.com",
  "password": "at-least-12-chars",
  "displayName": "Jane Doe"
}
```

| Field         | Type   | Constraints                                     |
| ------------- | ------ | ----------------------------------------------- |
| `email`       | string | trimmed, lowercased, valid email                |
| `password`    | string | min `PASSWORD_MIN_LENGTH` (default 12), max 128 |
| `displayName` | string | trimmed, 1–120 chars                            |

**Success response** — `202 Accepted`

```json
{
  "success": true,
  "data": {
    "message": "If that address is registered, check your inbox for further instructions."
  }
}
```

**Errors**

- `422 VALIDATION_ERROR` — invalid body fields
- `429 TOO_MANY_REQUESTS` — rate limited

---

### `POST /api/v1/auth/verify-email`

Consumes a single-use email verification token (sent via email).

**Auth required:** No

**Request body**

```json
{ "token": "raw-token-string" }
```

| Field   | Type   | Constraints |
| ------- | ------ | ----------- |
| `token` | string | min 1       |

**Success response** — `200 OK`

```json
{
  "success": true,
  "data": { "user": { "...": "AuthUser" } }
}
```

**Errors**

- `400 BAD_REQUEST` — "Invalid or expired token"
- `422 VALIDATION_ERROR` — missing/empty token
- `429 TOO_MANY_REQUESTS`

---

### `POST /api/v1/auth/resend-verification`

Re-issues a verification email if the account exists and isn't already verified. Enumeration-safe (always the same response).

**Auth required:** No

**Request body**

```json
{ "email": "user@example.com" }
```

**Success response** — `202 Accepted`

```json
{
  "success": true,
  "data": {
    "message": "If that address is registered, check your inbox for further instructions."
  }
}
```

**Errors**

- `422 VALIDATION_ERROR`
- `429 TOO_MANY_REQUESTS`

---

### `POST /api/v1/auth/login`

Authenticates with email/password and starts a session. Sets `cp_at` and `cp_rt` cookies.

**Auth required:** No

**Request body**

```json
{
  "email": "user@example.com",
  "password": "user-password"
}
```

| Field      | Type   | Constraints                                           |
| ---------- | ------ | ----------------------------------------------------- |
| `email`    | string | trimmed, lowercased, valid email                      |
| `password` | string | min 1 (no policy check here, to avoid leaking policy) |

**Success response** — `200 OK` (sets `cp_at`, `cp_rt` cookies)

```json
{
  "success": true,
  "data": { "user": { "...": "AuthUser" } }
}
```

**Errors**

- `401 UNAUTHORIZED` — "Invalid email or password"
- `403 FORBIDDEN` — "This account has been suspended"
- `403 EMAIL_NOT_VERIFIED` — "Email address is not verified"
- `422 VALIDATION_ERROR`
- `429 TOO_MANY_REQUESTS`

---

### `POST /api/v1/auth/refresh`

Rotates the refresh token and issues a new access token. Reads the raw refresh token from the `cp_rt` cookie (no request body). Implements reuse detection: replaying an already-rotated token outside the grace window revokes the entire session family.

**Auth required:** No (relies on `cp_rt` cookie)

**Request body:** none

**Success response** — `200 OK` (rotates `cp_at`, `cp_rt` cookies)

```json
{
  "success": true,
  "data": { "user": { "...": "AuthUser" } }
}
```

**Errors** (cookies are cleared on all of these except `REFRESH_IN_FLIGHT`)

- `401 UNAUTHORIZED` — "Missing refresh token" (cookie absent)
- `401 UNAUTHORIZED` — "Invalid refresh token"
- `401 UNAUTHORIZED` — "Refresh token expired"
- `401 UNAUTHORIZED` — "Refresh token reuse detected" (entire session family revoked)
- `401 REFRESH_IN_FLIGHT` — "Refresh already in progress, retry with the current cookies" (cookies preserved)
- `429 TOO_MANY_REQUESTS`

---

### `POST /api/v1/auth/logout`

Revokes the current session only. Clears auth cookies.

**Auth required:** Yes

**Request body:** none

**Success response** — `204 No Content`

**Errors**

- `401 UNAUTHORIZED` — not authenticated

---

### `POST /api/v1/auth/logout-all`

Revokes every session for the current user (all devices). Clears auth cookies.

**Auth required:** Yes

**Request body:** none

**Success response** — `204 No Content`

**Errors**

- `401 UNAUTHORIZED` — not authenticated

---

### `GET /api/v1/auth/me`

Returns the currently authenticated user.

**Auth required:** Yes

**Success response** — `200 OK`

```json
{
  "success": true,
  "data": { "user": { "...": "AuthUser" } }
}
```

**Errors**

- `401 UNAUTHORIZED` — not authenticated

---

### `POST /api/v1/auth/forgot-password`

Initiates a password reset by emailing a single-use token. Enumeration-safe.

**Auth required:** No

**Request body**

```json
{ "email": "user@example.com" }
```

**Success response** — `202 Accepted`

```json
{
  "success": true,
  "data": {
    "message": "If that address is registered, check your inbox for further instructions."
  }
}
```

**Errors**

- `422 VALIDATION_ERROR`
- `429 TOO_MANY_REQUESTS`

---

### `POST /api/v1/auth/reset-password`

Consumes a single-use password-reset token and sets a new password. Also marks the email as verified (reaching the mailbox proves ownership) and revokes all existing sessions for the account.

**Auth required:** No

**Request body**

```json
{
  "token": "raw-token-string",
  "password": "at-least-12-chars"
}
```

| Field      | Type   | Constraints                                     |
| ---------- | ------ | ----------------------------------------------- |
| `token`    | string | min 1                                           |
| `password` | string | min `PASSWORD_MIN_LENGTH` (default 12), max 128 |

**Success response** — `200 OK`

```json
{
  "success": true,
  "data": { "message": "Password has been reset." }
}
```

**Errors**

- `400 BAD_REQUEST` — "Invalid or expired token"
- `422 VALIDATION_ERROR`
- `429 TOO_MANY_REQUESTS`

---

### `POST /api/v1/auth/change-password`

Changes the password for the authenticated user. Revokes all other sessions except the current one.

**Auth required:** Yes

**Request body**

```json
{
  "currentPassword": "current-password",
  "newPassword": "at-least-12-chars"
}
```

| Field             | Type   | Constraints                                     |
| ----------------- | ------ | ----------------------------------------------- |
| `currentPassword` | string | min 1                                           |
| `newPassword`     | string | min `PASSWORD_MIN_LENGTH` (default 12), max 128 |

**Success response** — `204 No Content`

**Errors**

- `401 UNAUTHORIZED` — "Current password is incorrect"
- `401 UNAUTHORIZED` — not authenticated
- `422 VALIDATION_ERROR`

---

### `GET /api/v1/auth/google`

Starts the Google OAuth login flow. Generates CSRF `state` + PKCE challenge, stores them (plus `returnTo`) in the signed `cp_oauth` cookie, and redirects to Google's consent screen.

**Auth required:** No

**Query params**

| Field      | Type   | Required | Notes                                                                            |
| ---------- | ------ | -------- | -------------------------------------------------------------------------------- |
| `returnTo` | string | No       | Relative path to redirect to after login; validated as "safe", falls back to `/` |

**Success response** — `302 Found` redirect to Google's OAuth consent URL. Sets `cp_oauth` cookie.

**Errors**

- `404 NOT_FOUND` — Google OAuth is not configured on the server

---

### `GET /api/v1/auth/google/callback`

Handles Google's OAuth redirect. Verifies CSRF state, exchanges the authorization code (with PKCE) for the user's identity, resolves/creates the local user, issues a session, and redirects back to the frontend. This endpoint communicates results via redirect, not JSON.

**Auth required:** No

**Query params**

| Field   | Type   | Required |
| ------- | ------ | -------- |
| `state` | string | Yes      |
| `code`  | string | Yes      |

**Success response** — `302 Found` redirect to `${FRONTEND_URL}${returnTo}`. Sets `cp_at`/`cp_rt` cookies; clears `cp_oauth`.

**Error responses**

- `400 BAD_REQUEST` — "Missing or invalid OAuth callback parameters" (missing `state`/`code`)
- `400 BAD_REQUEST` — "Invalid or expired OAuth state"
- `400 BAD_REQUEST` — "OAuth state mismatch"
- `404 NOT_FOUND` — Google OAuth is not configured
- **Redirect** (not JSON) — `302` to `${FRONTEND_URL}/login?error=account_exists_unverified` if a local account with that email already exists but is unverified

---

## Public content (`/content`) — no auth

Serves only `ContentItem`s with `status = PUBLISHED`, from the denormalized `publishedTitle`/`publishedAt` and the joined `publishedVersion` body. See "Ownership & visibility" and "Pagination" above.

### `GET /api/v1/content`

Paginated list of published items.

**Auth required:** No

**Query params**

| Field          | Type                   | Constraints                               |
| -------------- | ---------------------- | ----------------------------------------- |
| `page`         | integer                | ≥ 1, default 1                            |
| `pageSize`     | integer                | 1–50, default 20                          |
| `categorySlug` | string                 | optional                                  |
| `tagSlug`      | string                 | optional                                  |
| `q`            | string                 | optional, 1–200 chars, title prefix match |
| `sort`         | `"newest" \| "oldest"` | default `"newest"`                        |

**Success response** — `200 OK`

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "slug": "how-to-ship-fast",
        "title": "How to ship fast",
        "excerpt": null,
        "publishedAt": "2026-02-01T10:00:00.000Z"
      }
    ],
    "meta": {
      "page": 1,
      "pageSize": 20,
      "totalItems": 1,
      "totalPages": 1,
      "hasPrev": false,
      "hasNext": false
    }
  }
}
```

**Errors**

- `422 VALIDATION_ERROR` — bad `page`/`pageSize`, or `page` beyond `totalPages`

---

### `GET /api/v1/content/:slug`

Published detail by slug.

**Auth required:** No

**Success response** — `200 OK`

```json
{
  "success": true,
  "data": {
    "item": {
      "id": "uuid",
      "slug": "how-to-ship-fast",
      "title": "How to ship fast",
      "body": "Full article body...",
      "excerpt": null,
      "publishedAt": "2026-02-01T10:00:00.000Z"
    }
  }
}
```

**Errors**

- `404 NOT_FOUND` — no such slug, or the item exists but isn't `PUBLISHED` (both look identical — see "Ownership & visibility")

---

## Authoring (`/items`) — author or editor

**Auth required for every route below:** Yes (`requireAuth` + `requireActiveAccount` + `requireVerifiedEmail`). An author only ever sees/mutates their own items; an editor sees/mutates all of them. Every id-scoped route below returns `404 NOT_FOUND` (not `403`) when the id doesn't resolve within the caller's scope.

### `POST /api/v1/items`

Creates a new `ContentItem` plus its version 1, both in `DRAFT`. The slug is derived from `title` at creation and then frozen (stable public URLs); a collision appends a numeric suffix.

**Request body**

```json
{
  "title": "How to ship fast",
  "body": "Full article body...",
  "excerpt": "A short teaser",
  "categorySlug": "engineering",
  "tagSlugs": ["velocity", "process"],
  "changeSummary": "Initial draft"
}
```

| Field           | Type           | Constraints                                                 |
| --------------- | -------------- | ----------------------------------------------------------- |
| `title`         | string         | trimmed, 1–200 chars                                        |
| `body`          | string         | 1–100,000 chars                                             |
| `excerpt`       | string \| null | optional, trimmed, max 500 chars                            |
| `categorySlug`  | string         | optional, 1–200 chars; upserted by slug if it doesn't exist |
| `tagSlugs`      | string[]       | optional, max 20 entries; each upserted by slug             |
| `changeSummary` | string         | required, trimmed, 1–500 chars                              |

**Success response** — `201 Created`

```json
{
  "success": true,
  "data": {
    "item": {
      "id": "uuid",
      "slug": "how-to-ship-fast",
      "authorId": "uuid",
      "status": "DRAFT",
      "publishedVersionId": null,
      "publishedTitle": null,
      "publishedAt": null,
      "unpublishedAt": null,
      "createdAt": "2026-02-01T10:00:00.000Z",
      "updatedAt": "2026-02-01T10:00:00.000Z",
      "archivedAt": null
    },
    "version": {
      "id": "uuid",
      "versionNumber": 1,
      "status": "DRAFT",
      "title": "How to ship fast",
      "changeSummary": "Initial draft",
      "createdById": "uuid",
      "createdAt": "2026-02-01T10:00:00.000Z",
      "submittedAt": null,
      "publishedAt": null
    }
  }
}
```

**Errors**

- `422 VALIDATION_ERROR`

---

### `GET /api/v1/items`

Lists items in the caller's scope, paginated.

**Query params**

| Field      | Type         | Constraints                                                                  |
| ---------- | ------------ | ---------------------------------------------------------------------------- |
| `page`     | integer      | ≥ 1, default 1                                                               |
| `pageSize` | integer      | 1–50, default 20                                                             |
| `authorId` | uuid         | editor-only filter; ignored/redundant for an author (already scoped to self) |
| `status`   | `ItemStatus` | optional filter — `"DRAFT" \| "PUBLISHED" \| "UNPUBLISHED" \| "ARCHIVED"`    |

**Success response** — `200 OK`

```json
{
  "success": true,
  "data": {
    "items": [{ "...": "ContentItemDto, same shape as POST /items above" }],
    "meta": {
      "page": 1,
      "pageSize": 20,
      "totalItems": 1,
      "totalPages": 1,
      "hasPrev": false,
      "hasNext": false
    }
  }
}
```

**Errors**

- `422 VALIDATION_ERROR` — bad query params, or `page` beyond `totalPages`

---

### `GET /api/v1/items/:id`

Item plus its current draft (if any) and published version summary (if any).

**Success response** — `200 OK`

```json
{
  "success": true,
  "data": {
    "item": {
      "...": "ContentItemDto fields",
      "currentDraft": { "...": "ContentVersionSummaryDto or null" },
      "publishedVersion": { "...": "ContentVersionSummaryDto or null" }
    }
  }
}
```

**Errors**

- `404 NOT_FOUND` — no such item in scope
- `422 VALIDATION_ERROR` — `id` isn't a valid UUID

---

### `PATCH /api/v1/items/:id/versions/:versionId`

Edits a version. Only legal while the version's `status` is `DRAFT` or `REJECTED` (see the state machine above) — every other status is immutable.

**Request body** (all content fields optional; at least `changeSummary` required)

```json
{
  "title": "Updated title",
  "body": "Updated body",
  "excerpt": "Updated excerpt",
  "categorySlug": "engineering",
  "tagSlugs": ["velocity"],
  "changeSummary": "Tightened the intro"
}
```

| Field           | Type           | Constraints                                              |
| --------------- | -------------- | -------------------------------------------------------- |
| `title`         | string         | optional, trimmed, 1–200 chars                           |
| `body`          | string         | optional, 1–100,000 chars                                |
| `excerpt`       | string \| null | optional, trimmed, max 500 chars                         |
| `categorySlug`  | string \| null | optional; `null` clears the category                     |
| `tagSlugs`      | string[]       | optional, max 20 entries; replaces the version's tag set |
| `changeSummary` | string         | required, trimmed, 1–500 chars                           |

**Success response** — `200 OK`

```json
{
  "success": true,
  "data": { "version": { "...": "full ContentVersionDto, including body/excerpt/tagIds" } }
}
```

**Errors**

- `404 NOT_FOUND` — no such item/version in scope
- `409 CONFLICT` — version is not `DRAFT`/`REJECTED` (no longer editable)
- `422 VALIDATION_ERROR`

---

### `POST /api/v1/items/:id/submit`

Submits the item's current (latest) version for review: `DRAFT`/`REJECTED → PENDING_REVIEW`.

**Request body:** none

**Success response** — `200 OK`

```json
{
  "success": true,
  "data": {
    "version": { "...": "full ContentVersionDto, status now PENDING_REVIEW, submittedAt set" }
  }
}
```

**Errors**

- `404 NOT_FOUND` — no such item in scope, or it has no version
- `409 CONFLICT` — current version isn't `DRAFT`/`REJECTED`
- `422 VALIDATION_ERROR`

---

### `POST /api/v1/items/:id/revisions`

Branches a new `DRAFT` version from the item's currently _live_ (published) version, so an in-progress edit can never affect what the public reads until it's published.

**Request body**

```json
{ "changeSummary": "Refreshing the numbers for Q2" }
```

| Field           | Type   | Constraints                    |
| --------------- | ------ | ------------------------------ |
| `changeSummary` | string | optional, trimmed, 1–500 chars |

**Success response** — `201 Created`

```json
{
  "success": true,
  "data": {
    "version": {
      "...": "new ContentVersionDto, status DRAFT, parentVersionId set to the live version's id"
    }
  }
}
```

**Errors**

- `404 NOT_FOUND` — no such item in scope
- `409 CONFLICT` — item has no published version to revise
- `422 VALIDATION_ERROR`

---

### `GET /api/v1/items/:id/versions`

Full version history for one item, newest first.

**Success response** — `200 OK`

```json
{
  "success": true,
  "data": {
    "versions": [{ "...": "ContentVersionSummaryDto" }]
  }
}
```

**Errors**

- `404 NOT_FOUND` — no such item in scope
- `422 VALIDATION_ERROR`

---

### `GET /api/v1/items/:id/versions/:versionId`

One historical version in full (immutable once past `DRAFT`/`REJECTED`).

**Success response** — `200 OK`

```json
{
  "success": true,
  "data": { "version": { "...": "full ContentVersionDto" } }
}
```

**Errors**

- `404 NOT_FOUND` — no such item/version in scope
- `422 VALIDATION_ERROR`

---

### `GET /api/v1/items/:id/audit`

The structured `AuditEvent` trail for the item, newest first.

**Success response** — `200 OK`

```json
{
  "success": true,
  "data": {
    "events": [
      {
        "id": "uuid",
        "action": "SUBMITTED_FOR_REVIEW",
        "actorId": "uuid",
        "contentItemId": "uuid",
        "versionId": "uuid",
        "requestId": "uuid",
        "metadata": null,
        "createdAt": "2026-02-01T10:00:00.000Z"
      }
    ]
  }
}
```

`action` is one of the `AuditAction` enum values (e.g. `ITEM_CREATED`, `VERSION_CREATED`, `VERSION_UPDATED`, `SUBMITTED_FOR_REVIEW`, `REVIEW_APPROVED`, `REVIEW_REJECTED`, `PUBLISHED`, `PUBLISH_SCHEDULED`, `SCHEDULE_CANCELLED`, `SCHEDULED_PUBLISH_EXECUTED`, `UNPUBLISHED`, `REVISION_STARTED`, `REVISION_RESTORED`, `ITEM_ARCHIVED`).

**Errors**

- `404 NOT_FOUND` — no such item in scope
- `422 VALIDATION_ERROR`

---

### `DELETE /api/v1/items/:id`

Soft-deletes the item: `status → ARCHIVED`, `archivedAt` set. An author may only archive their own item while it is unpublished; archiving a `PUBLISHED` item requires an editor.

**Request body:** none

**Success response** — `204 No Content`

**Errors**

- `404 NOT_FOUND` — no such item in scope
- `409 CONFLICT` — already archived, or (author, published item) "only an editor can archive a published item"
- `422 VALIDATION_ERROR`

---

## Editorial (`/editorial`) — editor only

**Auth required for every route below:** Yes, plus `requireEditor` (`role = EDITOR`). Every editorial action that changes state writes an append-only `Review` row and an `AuditEvent` in the same transaction as the state change (the one exception is `unpublish`, noted below — `ReviewDecision` has no matching value for it).

### `GET /api/v1/editorial/queue`

Versions awaiting review (`status = PENDING_REVIEW`), oldest `submittedAt` first, paginated.

**Query params**

| Field      | Type    | Constraints      |
| ---------- | ------- | ---------------- |
| `page`     | integer | ≥ 1, default 1   |
| `pageSize` | integer | 1–50, default 20 |

**Success response** — `200 OK`

```json
{
  "success": true,
  "data": {
    "items": [{ "...": "ContentVersionSummaryDto" }],
    "meta": {
      "page": 1,
      "pageSize": 20,
      "totalItems": 1,
      "totalPages": 1,
      "hasPrev": false,
      "hasNext": false
    }
  }
}
```

**Errors**

- `422 VALIDATION_ERROR`

---

### `POST /api/v1/editorial/versions/:versionId/approve`

`PENDING_REVIEW → APPROVED`. Writes a `Review` row (`decision = APPROVE`).

**Request body**

```json
{ "comment": "Looks good, ship it" }
```

| Field     | Type   | Constraints                     |
| --------- | ------ | ------------------------------- |
| `comment` | string | optional, trimmed, 1–2000 chars |

**Success response** — `200 OK`

```json
{
  "success": true,
  "data": { "version": { "...": "ContentVersionSummaryDto, status now APPROVED" } }
}
```

**Errors**

- `404 NOT_FOUND` — no such version
- `409 CONFLICT` — version isn't `PENDING_REVIEW`
- `422 VALIDATION_ERROR`

---

### `POST /api/v1/editorial/versions/:versionId/reject`

`PENDING_REVIEW → REJECTED`. Writes a `Review` row (`decision = REJECT`). Sends the version back to its author for edits and resubmission.

**Request body**k

```json
{ "comment": "Please add a source for the Q2 numbers" }
```

| Field     | Type   | Constraints                         |
| --------- | ------ | ----------------------------------- |
| `comment` | string | **required**, trimmed, 1–2000 chars |

**Success response** — `200 OK`

```json
{
  "success": true,
  "data": { "version": { "...": "ContentVersionSummaryDto, status now REJECTED" } }
}
```

**Errors**

- `404 NOT_FOUND` — no such version
- `409 CONFLICT` — version isn't `PENDING_REVIEW`
- `422 VALIDATION_ERROR` — missing/empty `comment`

---

### `POST /api/v1/editorial/versions/:versionId/publish`

Publishes immediately. Legal from either `PENDING_REVIEW` (direct publish, skipping the `APPROVED` stop) or `APPROVED`. Writes a `Review` row (`decision = PUBLISH`) and the state change in one transaction, then runs the same `publishVersion` core used by the scheduler worker: supersedes any previously-live version, moves the item's `publishedVersionId` pointer, and appends a `PUBLISHED` audit event.

**Request body**

```json
{ "comment": "Publishing ahead of the launch" }
```

| Field     | Type   | Constraints                     |
| --------- | ------ | ------------------------------- |
| `comment` | string | optional, trimmed, 1–2000 chars |

**Success response** — `200 OK`

```json
{
  "success": true,
  "data": { "version": { "...": "ContentVersionSummaryDto, status now PUBLISHED" } }
}
```

**Errors**

- `404 NOT_FOUND` — no such version
- `409 CONFLICT` — version isn't `PENDING_REVIEW`/`APPROVED`, or it was already published by a concurrent request (the exactly-once guard)
- `422 VALIDATION_ERROR`

---

### `POST /api/v1/editorial/versions/:versionId/schedule`

Queues the version to publish automatically at a future time: `PENDING_REVIEW`/`APPROVED → SCHEDULED`. Writes a `Review` row (`decision = SCHEDULE`), inserts a `ScheduledPublication` row (`status = PENDING`), and enqueues the BullMQ job (best-effort — if Redis is unreachable the row stays `PENDING` and the reconciler enqueues it on its next sweep, since Postgres, not the queue, is the source of truth for "this must still publish").

**Request body**

```json
{ "scheduledFor": "2026-03-01T09:00:00.000Z" }
```

| Field          | Type                            | Constraints                                                                 |
| -------------- | ------------------------------- | --------------------------------------------------------------------------- |
| `scheduledFor` | ISO 8601 datetime (with offset) | must be ≥ `now() + SCHEDULE_MIN_LEAD_MS` (default 30s clock-skew allowance) |

**Success response** — `200 OK`

```json
{
  "success": true,
  "data": { "version": { "...": "ContentVersionSummaryDto, status now SCHEDULED" } }
}
```

**Errors**

- `404 NOT_FOUND` — no such version
- `409 CONFLICT` — version isn't `PENDING_REVIEW`/`APPROVED`, or already has a live schedule (at most one `PENDING`/`CLAIMED` job per version)
- `422 VALIDATION_ERROR` — `scheduledFor` missing, malformed, or not far enough in the future

**Past-due note:** if a version's `scheduledFor` elapses while it still sits in review, the job is created `PENDING` anyway with the original (now-past) time, and publishes on the worker's very next tick — late, once, with the intended time preserved on the row.

---

### `DELETE /api/v1/editorial/versions/:versionId/schedule`

Cancels a pending schedule: `SCHEDULED → APPROVED`, the live `ScheduledPublication` row → `CANCELLED`. Best-effort removes the BullMQ job; if that races with the worker already having claimed it, `publishVersion`'s status guard still prevents the cancelled item from going live.

**Request body:** none

**Success response** — `204 No Content`

**Errors**

- `404 NOT_FOUND` — no such version, or no live (`PENDING`/`CLAIMED`) schedule exists for it
- `409 CONFLICT` — version isn't `SCHEDULED`, or the schedule row was already claimed/resolved by the time of the cancel

---

### `POST /api/v1/editorial/items/:id/unpublish`

Pulls a published item from public view without deleting its content: item `PUBLISHED → UNPUBLISHED` (pointer nulled), version `PUBLISHED → UNPUBLISHED`. Writes only an `AuditEvent` (`UNPUBLISHED`) — `ReviewDecision` has no matching value, so no `Review` row is written for this action.

**Request body:** none

**Success response** — `204 No Content`

**Errors**

- `404 NOT_FOUND` — no such item
- `409 CONFLICT` — item has no published version to unpublish

---

### `POST /api/v1/editorial/items/:id/restore/:versionId`

Republishes an old version by branching it into a brand-new `DRAFT` version (a new event in the history, never a rewrite of the past). Does not publish it automatically — the new draft still goes through submit/review/publish like any other.

**Request body**

```json
{ "changeSummary": "Restoring the pre-redesign copy" }
```

| Field           | Type   | Constraints                                                             |
| --------------- | ------ | ----------------------------------------------------------------------- |
| `changeSummary` | string | optional, trimmed, 1–500 chars; defaults to `"Restored from version N"` |

**Success response** — `200 OK`

```json
{
  "success": true,
  "data": {
    "version": {
      "...": "new ContentVersionSummaryDto, status DRAFT, parentVersionId set to the restored version's id"
    }
  }
}
```

**Errors**

- `404 NOT_FOUND` — no such item, or no such version on that item
- `422 VALIDATION_ERROR`

---

## Health (non-auth, included for reference)

### `GET /api/v1/health`

Liveness probe — no dependency checks.

**Success response** — `200 OK`

```json
{ "status": "ok", "uptime": 123.45 }
```

### `GET /api/v1/health/ready`

Readiness probe — runs `SELECT 1` against the database.

**Success response** — `200 OK`

```json
{ "status": "ready" }
```

**Errors**

- `503 SERVICE_UNAVAILABLE` — database not reachable
