# API Documentation — Auth

Base URL: `/api/v1`

## Conventions

### Response envelope

All JSON responses use a consistent envelope.

**Success**
```json
{
  "success": true,
  "data": { }
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

| Code | HTTP Status | Notes |
|---|---|---|
| `BAD_REQUEST` | 400 | Malformed / semantically invalid request (e.g. invalid or expired token) |
| `UNAUTHORIZED` | 401 | Missing/invalid credentials, missing/invalid session, invalid refresh token |
| `FORBIDDEN` | 403 | Account suspended, or general permission denial |
| `EMAIL_NOT_VERIFIED` | 403 | Login blocked until the account's email is verified |
| `NOT_FOUND` | 404 | Resource not found (also used when Google OAuth is not configured) |
| `CONFLICT` | 409 | Resource already exists |
| `PAYLOAD_TOO_LARGE` | 413 | Request body exceeds configured limit |
| `VALIDATION_ERROR` | 422 | Zod schema validation failed on body/query/params |
| `TOO_MANY_REQUESTS` | 429 | Rate limit exceeded |
| `REFRESH_IN_FLIGHT` | 401 | A racing tab already rotated the refresh token; retry with current cookies |
| `SERVICE_UNAVAILABLE` | 503 | Downstream dependency (e.g. database) unavailable |

### Authentication

Two mechanisms are accepted for protected endpoints (`requireAuth` middleware):
- **Cookie** — `cp_at` (access token), sent automatically by the browser.
- **Header** — `Authorization: Bearer <access token>`, used as a fallback if the cookie isn't present.

### Cookies

| Cookie | Purpose | Path | Lifetime | HttpOnly / Secure / SameSite |
|---|---|---|---|---|
| `cp_at` | Access token (JWT) | `/` | `ACCESS_TOKEN_TTL_S` (default 900s / 15 min) | Yes / per `COOKIE_SECURE` / per `COOKIE_SAMESITE` |
| `cp_rt` | Refresh token (opaque, hashed server-side) | `/api/v1/auth` | Until `REFRESH_TOKEN_TTL_DAYS` (default 30 days) | Yes / per `COOKIE_SECURE` / per `COOKIE_SAMESITE` |
| `cp_oauth` | Signed OAuth state + PKCE verifier + returnTo, used only during the Google OAuth handshake | `/api/v1/auth` | `OAUTH_STATE_TTL_MS` | Yes / per `COOKIE_SECURE` / forced `lax` if configured `strict` |

`cp_at` and `cp_rt` are set together on login, refresh, and OAuth callback success, and cleared together on logout, logout-all, and most refresh failures.

### Rate limiting

All endpoints below except `/logout`, `/logout-all`, `/me`, and the Google OAuth routes are behind a stricter auth rate limiter (`skipSuccessfulRequests: true`, limit = `AUTH_RATE_LIMIT_MAX` per window). Exceeding it returns `429 TOO_MANY_REQUESTS`.

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
| Field | Type | Constraints |
|---|---|---|
| `email` | string | trimmed, lowercased, valid email |
| `password` | string | min `PASSWORD_MIN_LENGTH` (default 12), max 128 |
| `displayName` | string | trimmed, 1–120 chars |

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
| Field | Type | Constraints |
|---|---|---|
| `token` | string | min 1 |

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
| Field | Type | Constraints |
|---|---|---|
| `email` | string | trimmed, lowercased, valid email |
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
| Field | Type | Constraints |
|---|---|---|
| `token` | string | min 1 |
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
| Field | Type | Constraints |
|---|---|---|
| `currentPassword` | string | min 1 |
| `newPassword` | string | min `PASSWORD_MIN_LENGTH` (default 12), max 128 |

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
| Field | Type | Required | Notes |
|---|---|---|---|
| `returnTo` | string | No | Relative path to redirect to after login; validated as "safe", falls back to `/` |

**Success response** — `302 Found` redirect to Google's OAuth consent URL. Sets `cp_oauth` cookie.

**Errors**
- `404 NOT_FOUND` — Google OAuth is not configured on the server

---

### `GET /api/v1/auth/google/callback`

Handles Google's OAuth redirect. Verifies CSRF state, exchanges the authorization code (with PKCE) for the user's identity, resolves/creates the local user, issues a session, and redirects back to the frontend. This endpoint communicates results via redirect, not JSON.

**Auth required:** No

**Query params**
| Field | Type | Required |
|---|---|---|
| `state` | string | Yes |
| `code` | string | Yes |

**Success response** — `302 Found` redirect to `${FRONTEND_URL}${returnTo}`. Sets `cp_at`/`cp_rt` cookies; clears `cp_oauth`.

**Error responses**
- `400 BAD_REQUEST` — "Missing or invalid OAuth callback parameters" (missing `state`/`code`)
- `400 BAD_REQUEST` — "Invalid or expired OAuth state"
- `400 BAD_REQUEST` — "OAuth state mismatch"
- `404 NOT_FOUND` — Google OAuth is not configured
- **Redirect** (not JSON) — `302` to `${FRONTEND_URL}/login?error=account_exists_unverified` if a local account with that email already exists but is unverified

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
