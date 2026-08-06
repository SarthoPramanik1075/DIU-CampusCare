# REST API Specification
## DIU CampusCare — Smart Medical & Counseling Management System

| | |
|---|---|
| **Document** | API Design Specification |
| **Version** | 1.0 |
| **Status** | For review |
| **Depends on** | [SRS.md](SRS.md) v1.0 · [ARCHITECTURE.md](ARCHITECTURE.md) v1.0 · [DATABASE.md](DATABASE.md) v1.0 *(approved)* |
| **Scope** | Phase 1. Two HTTP services. No backend implementation. |

This document specifies the complete HTTP contract for both deployable units defined in ARCHITECTURE §1.2. It is the authority on routes, payloads, status codes and per-endpoint authorization. Where it disagrees with an interface mock-up, this document wins; where it disagrees with the SRS, the SRS wins and this document is defective.

---

# Table of Contents

| Part | Contents |
|---|---|
| **0** | [Global Conventions](#part-0--global-conventions) |
| **1** | [Module AUTH — Authentication, Identity & Role Management](#part-1--module-auth) |
| **2** | [Module DASH — Dashboard & Public Views](#part-2--module-dash) |
| **3** | [Module SCH — Doctor & Schedule Management](#part-3--module-sch) |
| **4** | [Module APT — Appointment & Queue Management](#part-4--module-apt) |
| **5** | [Module PAY — Consultation Fee Management](#part-5--module-pay) |
| **6** | [Module MED — Medicine Inventory & Store](#part-6--module-med) |
| **7** | [Module NTF — Notifications](#part-7--module-ntf) |
| **8** | [Module ADM — Administration & Configuration](#part-8--module-adm) |
| **9** | [Module AUD — Audit, Access Logs & Break-Glass](#part-9--module-aud) |
| **10** | [Module CNS — Counseling Intake & Crisis Safety *(vault)*](#part-10--module-cns-vault) |
| **11** | [Module CSE — Counseling Triage & Case Management *(vault)*](#part-11--module-cse-vault) |
| **12** | [Internal Service-to-Service Endpoints](#part-12--internal-service-to-service-endpoints) |
| **13** | [Traceability & Coverage](#part-13--traceability--coverage) |

---

# Part 0 — Global Conventions

Everything in this part applies to every endpoint in the document. Endpoint entries state only what differs from it.

## 0.1 Two services, two base URLs

| Service | Base URL | Data store | Authorization authority |
|---|---|---|---|
| **Core API** | `/api/v1` | `campuscare_core` (credential set A) | Core PDP — permission matrix SRS §3.5.2 |
| **Counseling API** *(vault)* | `/counseling/api/v1` | `campuscare_counseling` (credential set B) | Clinical PEP — `counseling.clinical_roster`, **independently of Core** |

These are separate processes behind one reverse proxy (ADR-001). The Core process holds **no credential** to the counseling database. This is why FR-ADM-09 (exports contain no counseling data) is structural rather than a filter, and why no Core endpoint in Parts 1–9 returns a counseling field.

When `counseling.enabled` is off, every `/counseling/api/v1/*` route returns **404**, not 403 — the service is not running (ARCHITECTURE §3.4, BR-68). A 403 would confirm the routes exist.

## 0.2 Authentication model

Sessions are **server-side and revocable**, carried in a cookie. There are no bearer tokens and no JWTs in Phase 1.

| Property | Value | Requirement |
|---|---|---|
| Cookie name | `ccc_session` | — |
| Attributes | `HttpOnly; Secure; SameSite=Lax; Path=/` | NFR-SEC-01 |
| Value | Opaque 256-bit identifier → `identity.user_session.id` | — |
| Idle timeout | 30 min (STU, DOC, MCS, STO) · 15 min (CNP, ADM) | FR-AUTH-06 |
| Regeneration | On login and on any privilege change | NFR-SEC-08 |
| Invalidation | Immediate on logout; `revoked_at` set | FR-AUTH-07 |
| Permission reduction | Effective on the next request, no re-authentication | PRM-15 |

**Why not a self-contained token.** PRM-15 requires a permission *reduction* to take effect without the user re-authenticating. A signed token cannot be revoked mid-life without a server-side revocation list — at which point the server-side session it was meant to avoid has been reinvented, with worse ergonomics.

**CSRF.** `SameSite=Lax` covers top-level navigation. Every state-changing request (`POST`, `PATCH`, `PUT`, `DELETE`) additionally requires a `X-CSRF-Token` header matching the value issued by `GET /api/v1/auth/session`. Mismatch → `403 CSRF_TOKEN_INVALID`.

## 0.3 Authentication levels

Every endpoint's **Authentication** field uses exactly one of these values.

| Level | Meaning |
|---|---|
| `None` | Unauthenticated. Anonymous role `ANON`. No session cookie required or read |
| `Session` | Any live session on an `active` account, any role |
| `Session + Own` | Live session, and the PDP's ownership evaluator confirms the subject owns the target resource (PRM-03) |
| `Session + Role(X)` | Live session and role `X` held. Multiple roles listed means any one suffices (BR-03 union) |
| `Session + ClinicalRoster` | Live session **and** the subject appears active on `counseling.clinical_roster`. The `CNP` role claim from Core IAM is **not** sufficient (ADR-012, NFR-SEC-06) |
| `Session + ClinicalRoster \| BreakGlass` | As above, or an `ADM` subject holding an unexpired `audit.break_glass_grant` (FR-AUD-05…07, PRM-14) |
| `Service` | Internal service-to-service call. Not routable from the public internet. See Part 12 |

Role codes are SRS §3.5.1: `ANON`, `STU`, `DOC`, `MCS`, `STO`, `CNP`, `ADM`.

**Deny-by-default (PRM-02).** An endpoint with no entry in the permission matrix is unreachable. Adding a route without a matrix rule produces a 403, not an open door.

## 0.4 Uniform error envelope

Every non-2xx response carries this shape and nothing else (ARCHITECTURE §10.3).

```json
{
  "error": {
    "code": "BOOKING_LIMIT_REACHED",
    "message": "You already have 2 upcoming appointments. Cancel one before booking another.",
    "correlationId": "01J8ZQ7K4M9X2P",
    "fields": [
      { "field": "sessionSlotId", "rule": "VR-21", "message": "Maximum active bookings reached" }
    ],
    "details": {}
  }
}
```

| Field | Type | Always present | Notes |
|---|---|---|---|
| `error.code` | string, `SCREAMING_SNAKE` | yes | Stable. Clients branch on this, never on `message` |
| `error.message` | string | yes | Plain language, states what to do next (NFR-USE-06). Never a technical term, never a constraint name |
| `error.correlationId` | string | yes | Quotable by the user, traceable in logs (NFR-MNT-03) |
| `error.fields[]` | array | 422 only | Field-level detail with the violated `VR-*` identifier |
| `error.details` | object | conditional | Endpoint-specific context, e.g. refreshed slot list on `SLOT_TAKEN` |

**Three rules, absolute:**

1. **Never leak internals** — no stack trace, no SQL text, no constraint name, no framework detail, no internal identifier (NFR-SEC-07).
2. **Never confirm existence through an error** — a 403 for a resource the caller may not see is indistinguishable from a 403 for a resource that does not exist. This is what makes PRM-09 achievable: an administrator cannot probe for the existence of a counseling record.
3. **Counseling-context copy is reviewed** — every user-facing `message` on a `/counseling/api/v1` endpoint is reviewed by a counseling professional before release (CON-04, NFR-USE-07, EC-39). Wording is part of the requirement, not decoration.

## 0.5 Error taxonomy and universal error set

Five classes; every failure is exactly one (ARCHITECTURE §10.1).

| Class | HTTP | Retryable |
|---|---|---|
| ValidationError | 422 | No — fix input |
| AuthorizationError | 401 / 403 | No |
| DomainRuleViolation | 409 | No — state must change first |
| ConflictError | 409 | Yes, after refresh |
| InfrastructureError | 503 / 500 | Yes, with backoff |

**The universal error set.** These may be returned by any endpoint and are *not* repeated in individual endpoint entries. Endpoint entries list only their own domain-specific codes.

| Code | Status | Condition |
|---|---|---|
| `VALIDATION_FAILED` | 422 | One or more `VR-*` field rules violated; see `error.fields[]` |
| `UNAUTHENTICATED` | 401 | No session cookie, or the session is unknown |
| `SESSION_EXPIRED` | 401 | Session past its idle timeout or revoked |
| `CSRF_TOKEN_INVALID` | 403 | Missing or mismatched `X-CSRF-Token` on a state-changing request |
| `FORBIDDEN` | 403 | PDP denied. Logged to `audit.authz_denial` (PRM-12) |
| `ACCOUNT_NOT_ACTIVE` | 403 | Account status is not `active` (FR-AUTH-09, BR-01) |
| `NOT_FOUND` | 404 | Resource does not exist, or exists and the caller may not know that |
| `CONFLICT_STALE_VERSION` | 409 | `version` mismatch (VR-92, EC-19) |
| `SERVICE_UNAVAILABLE` | 503 | Dependency failure; safe to retry with backoff |
| `INTERNAL_ERROR` | 500 | Unhandled. Correlation ID only |

Because 401, 403, 404, 422 (malformed body), 500 and 503 apply everywhere, each endpoint's **Status Codes** field lists its success codes plus its distinctive failure codes; the universal set is implied.

## 0.6 Optimistic concurrency — VR-92

VR-92 requires a write against a stale record to be **rejected, not merged**. EC-19 requires the current state to be re-presented.

- Every mutable resource returns a `version` integer, mapped to the `version` column on its table.
- Every `PATCH`, `PUT` and state-changing `POST` against an existing resource **must** include `version` in the request body.
- On mismatch the server returns:

```json
{
  "error": {
    "code": "CONFLICT_STALE_VERSION",
    "message": "Someone else updated this a moment ago. Here is the current version — review it and try again.",
    "correlationId": "01J8ZQ7K4M9X2P",
    "details": { "current": { "…": "the full current representation" } }
  }
}
```

There is no merge, no last-write-wins, and no `force` parameter anywhere in this API.

## 0.7 Idempotency — the offline command buffer

ARCHITECTURE §5.6 buffers staff commands locally when the network drops and replays them on reconnection. Replay must not duplicate.

**Bufferable commands accept an `Idempotency-Key` header** (client-generated UUID, stored in `queueing.appointment.idempotency_key`):

| Endpoint | Command |
|---|---|
| `POST /appointments/{id}/check-in` | Check-in |
| `POST /appointments/{id}/advance` | Status advance |
| `POST /appointments/{id}/no-show` | No-show marking |
| `POST /walk-ins` | Walk-in registration |

Replay of a key already applied returns **`200`** with the original result and header `Idempotent-Replay: true`. It never creates a second row.

**Deliberately not idempotent — the header is rejected with `422 IDEMPOTENCY_NOT_SUPPORTED`:**

| Endpoint group | Why |
|---|---|
| `POST /appointments` (booking) | Slot contention (EC-01) cannot be resolved offline; two offline clients could both claim the last slot |
| `POST …/payments`, `…/waiver`, `…/adjustments` | Financial integrity; receipt uniqueness (VR-41) is a server-side check |
| Doctor leave / bulk cancel | Requires server-side impact analysis over all bookings (FR-SCH-07) |
| `PATCH /config/{key}` | Must be evaluated against current server state (EC-50) |

Anything not bufferable falls back to paper (BR-66) and is entered retrospectively the same day, flagged `enteredRetrospectively: true` (EC-18, NFR-REL-04).

## 0.8 Data conventions

| Concern | Convention |
|---|---|
| **Casing** | Request and response JSON is `camelCase`. It maps to the schema's `snake_case` columns at the interface layer |
| **Identifiers** | All `id` values are UUIDv7 strings, application-generated (DATABASE §3). Business references (`appointmentRef`, `receiptNumber`, `batchRef`) are separate human-readable strings |
| **Timestamps** | ISO-8601 with explicit offset, always `+06:00` — `"2026-08-03T14:30:00+06:00"`. All times are BST / `Asia/Dhaka` (VR-91) |
| **Dates** | `YYYY-MM-DD`. **Local times** (roster, store hours) are `HH:mm` with no offset — a roster is "every Sunday 09:00", a recurring intention, not an instant |
| **Server time is authoritative** | Every cutoff, grace period, expiry and SLA is evaluated against server time. A client-supplied timestamp is advisory metadata only, never a decision input (EC-54) |
| **Enums** | Wire values match the PostgreSQL enum literals **exactly**: `no_show`, not `noShow` or `NO_SHOW` |
| **Money** | JSON number with at most 2 decimal places, mapping to `numeric(10,2)`. Currency is BDT throughout Phase 1 and is not carried per-field |
| **Free text** | Stored verbatim, escaped on output, never interpreted as markup (VR-90). No endpoint accepts or returns HTML |
| **Null vs absent** | An absent field means "unchanged" on `PATCH`; an explicit `null` means "clear". On `POST` the two are equivalent |
| **Lists** | List endpoints accept `limit` (default 50, max 200) and `cursor`, and return `{ "items": [...], "nextCursor": string\|null }`. Filters and sorts are specified per endpoint |

## 0.9 Reason fields — VR-93

Twelve operations require a stated reason. Every one of them enforces the same rule, at the server:

- Minimum **10 characters** after trimming whitespace; whitespace-only is rejected.
- Break-glass justification is the exception: minimum **20 characters** (FR-AUD-05).
- Violation → `422 VALIDATION_FAILED` with `rule: "VR-93"`.

Operations carrying a mandatory reason: emergency designation (VR-30), status reversal (VR-32), schedule change within 24 h (VR-18), unavailability (VR-93), reconciliation discrepancy (VR-43), stock adjustment detail (VR-59), FEFO override (VR-57), dispensing-limit override (VR-58), store manual override (VR-62), counseling priority change (VR-76), out-of-window session scheduling (VR-77), break-glass (FR-AUD-05).

## 0.10 Auditing is not optional

DR-7 and FR-AUD-01 require *every* state-changing operation to write an audit record. In this document that is a property of the endpoint, not a feature request: **every `POST`, `PATCH`, `PUT` and `DELETE` in Parts 1–9 writes `audit.audit_log`** with actor, role, before-state, after-state and correlation ID. It is stated per-endpoint only where the entity type is non-obvious.

Reads that touch another user's personal data write `audit.data_access_log` (FR-AUD-03). This is noted per-endpoint.

**Every read in Parts 10–11 writes `clinical_audit.counseling_access_log`** — including list reads and reads that end in 404 (FR-CSE-15, BR-51). Also stated per-endpoint, because it is the requirement most easily lost during implementation.

## 0.11 Counseling containment — read this before writing any Core endpoint

BR-50, PRM-05, PRM-08 and PRM-09 together require that **no interface, list, count, export, notification or search result available to a non-Counseling-Professional reveals that a student has a counseling record.**

Consequences that show up in this document and would otherwise look like omissions:

1. **`GET /api/v1/me/dashboard` returns no counseling panel.** FR-DASH-03 requires the student's dashboard to show their counseling request status, and FR-DASH-05 requires it to be visible only to that student. The Core service cannot supply it — it has no credential path to the vault. The client composes the dashboard from two calls: `GET /api/v1/me/dashboard` and `GET /counseling/api/v1/me/requests`. If the vault is down, the medical and medicine panels render and the counseling panel shows a neutral unavailable state (ARCHITECTURE §10.4, F3).
2. **No Core endpoint accepts or returns a counseling case identifier.** The only counseling-adjacent Core route is the internal notification request of §12.2, which carries a recipient and a pre-approved discreet template key — never a category, urgency, counselor identity or free text.
3. **The audit viewer (`GET /api/v1/admin/audit-log`) shows counseling entries as non-identifying activity records only** — `"counseling case accessed"` with no case identifier, no student identifier, no actor beyond a role (FR-ADM-06).
4. **The export endpoint cannot include counseling data.** Not filtered — impossible (FR-ADM-09).
5. **Counseling notification content is discreet by construction.** Subject, preview and body omit the words identifying the service, any category, any urgency, any clinical term, any counselor specialisation (FR-NTF-05/06). The Content Policy Guard rejects a dispatch that would violate this and records a security event.

---
# Part 1 — Module AUTH
### Authentication, Identity & Role Management

Covers FR-AUTH-01…15, VR-01…VR-05, PRM-13, PRM-15. Base path `/api/v1`.

**Module-wide rules.** Login responses never distinguish "no such account" from "wrong password" (ARCHITECTURE §7.2 — a distinguishing response enumerates valid accounts). Self-registration exists for no role: student accounts are provisioned on first successful SSO, every other account is created by an Administrator (FR-AUTH-02, BR-05). No endpoint anywhere in this API allows a user to act on behalf of another (FR-AUTH-15, BR-02).

---

## 1.1 Authentication

### GET /api/v1/auth/sso/login

**Purpose** — Begin institutional SSO. Generates `state` and a PKCE challenge, stores them against a short-lived pre-session, and redirects to the DIU identity provider (FR-AUTH-01, FR-SI-01).

**Authentication** — `None`.

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `redirectTo` | string (relative path) | no | Must be a same-origin relative path. Absolute URLs and protocol-relative values are rejected — an open redirect here would hand an attacker a credible phishing surface |

**Response Body** — none. `302` with `Location` set to the identity provider's authorization endpoint, and a `Set-Cookie` carrying the pre-session that holds `state` + PKCE verifier.

**Validation** — `redirectTo` must be relative and must not begin `//`.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `INVALID_REDIRECT` | 422 | `redirectTo` is absolute or protocol-relative | "That link isn't valid. Return to the DIU CampusCare home page and try again." |
| `SSO_UNAVAILABLE` | 503 | Identity provider unreachable | "Sign-in with your DIU account isn't available right now. You can sign in with your email and password instead." |

**Status Codes** — `302`, `422`, `503`.

---

### GET /api/v1/auth/sso/callback

**Purpose** — Complete SSO. Verifies `state`, exchanges the code, resolves or provisions the local account, checks account status, loads roles, creates a session (FR-AUTH-01, FR-AUTH-09, FR-AUTH-13).

**Authentication** — `None` (the pre-session cookie from `/auth/sso/login` is required and consumed).

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `code` | string | yes | Authorization code from the IdP |
| `state` | string | yes | Must match the pre-session value exactly; mismatch is rejected outright |

**Response Body** — none on success. `302` to `redirectTo` or the role's default landing path, with `Set-Cookie: ccc_session=…; HttpOnly; Secure; SameSite=Lax`.

**Validation** — `state` matches the pre-session (CSRF on the authorization code flow); code exchange succeeds; the resolved account's `status` is `active` (FR-AUTH-09, BR-01).

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `SSO_STATE_MISMATCH` | 403 | `state` absent or does not match | "Your sign-in couldn't be completed. Start again from the sign-in page." |
| `ACCOUNT_NOT_ACTIVE` | 403 | Status is `pending`, `suspended` or `deactivated` (FR-AUTH-09, BR-06) | "This account isn't active. Contact the medical centre or DIU IT for help." |
| `SSO_EXCHANGE_FAILED` | 503 | Token exchange failed | "Sign-in couldn't be completed. Please try again." |

Every outcome, success or failure, writes `identity.login_attempt` (FR-AUTH-13).

**Status Codes** — `302`, `403`, `503`.

---

### POST /api/v1/auth/login

**Purpose** — Fallback authentication by university email and password, used where SSO is unavailable (FR-AUTH-01, OI-03).

**Authentication** — `None`.

**Request Body**

```json
{
  "email": "student@diu.edu.bd",
  "password": "correct horse battery staple"
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `email` | string, citext | yes | VR-01 — must match the DIU institutional domain format |
| `password` | string | yes | Verified against the Argon2id/bcrypt hash in `identity.local_credential` (NFR-SEC-02) |

**Response Body**

```json
{
  "userId": "0191f3c2-7a10-7b3e-9d21-4c5a6b7c8d90",
  "fullName": "Nusrat Jahan",
  "roles": ["STU"],
  "csrfToken": "3f9a…",
  "sessionExpiresAt": "2026-08-03T15:05:00+06:00",
  "idleTimeoutMinutes": 30
}
```

| Field | Type | Notes |
|---|---|---|
| `userId` | uuid | `identity.user_account.id` |
| `fullName` | string | — |
| `roles` | string[] | Role codes held. Note: a `CNP` code here does **not** by itself open the vault (§0.3, ADR-012) |
| `csrfToken` | string | Required in `X-CSRF-Token` on every subsequent state-changing request |
| `sessionExpiresAt` | timestamptz | `identity.user_session.expires_at` |
| `idleTimeoutMinutes` | integer | 30 for students, 15 for CNP/ADM (FR-AUTH-06) |

Sets `ccc_session`. Resets `failed_attempts` to 0.

**Validation** — VR-01 email format; account status `active` (FR-AUTH-09); account not locked (FR-AUTH-14); password verifies.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `INVALID_CREDENTIALS` | 401 | Unknown email **or** wrong password — deliberately one code for both | "That email address and password don't match. Check both and try again." |
| `ACCOUNT_LOCKED` | 423 | 5 consecutive failures (FR-AUTH-14). Response carries `details.unlockAt` | "Too many attempts. Your account is locked until 3:20 PM. We've emailed you about this." |
| `ACCOUNT_NOT_ACTIVE` | 403 | Status is not `active` | "This account isn't active. Contact DIU IT for help." |

On the 5th consecutive failure the account locks for 15 minutes and a lockout notification is enqueued (FR-AUTH-14). Every attempt writes `identity.login_attempt` with outcome, timestamp and source address (FR-AUTH-13).

**Status Codes** — `200`, `401`, `403`, `422`, `423`, `503`.

---

### POST /api/v1/auth/logout

**Purpose** — Terminate the current session immediately, on every role (FR-AUTH-07, NFR-SEC-08).

**Authentication** — `Session`.

**Request Body** — none.

**Response Body** — none. Sets `revoked_at` on `identity.user_session` and clears the cookie.

**Validation** — none beyond a live session. Logging out twice is not an error.

**Error Responses** — universal set only.

**Status Codes** — `204`, `401`.

---

### GET /api/v1/auth/session

**Purpose** — Return the current session, effective roles and a fresh CSRF token. The client calls this on load to decide what to render — noting that rendering decisions are cosmetic and enforce nothing (ARCHITECTURE §8.5).

**Authentication** — `Session`.

**Request Body** — none.

**Response Body**

```json
{
  "userId": "0191f3c2-7a10-7b3e-9d21-4c5a6b7c8d90",
  "fullName": "Nusrat Jahan",
  "email": "student@diu.edu.bd",
  "roles": ["STU"],
  "studentRef": "221-15-5678",
  "csrfToken": "3f9a…",
  "sessionExpiresAt": "2026-08-03T15:05:00+06:00",
  "counselingEnabled": true
}
```

| Field | Type | Notes |
|---|---|---|
| `studentRef` | string \| null | Present only when the account has a `student_profile` |
| `counselingEnabled` | boolean | Mirrors the `counseling.enabled` feature flag so the client can hide the entry point when the vault is not deployed (BR-68). It reveals nothing about any individual |

Reflects permission changes on the next request without re-authentication (PRM-15).

**Validation** — none.

**Error Responses** — universal set only.

**Status Codes** — `200`, `401`.

---

### POST /api/v1/auth/password-reset/request

**Purpose** — Send a single-use, time-limited reset link to the account's registered university email (FR-AUTH-08).

**Authentication** — `None`.

**Request Body**

```json
{ "email": "student@diu.edu.bd" }
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `email` | string | yes | VR-01 |

**Response Body**

```json
{ "message": "If that email address has a password account with us, we've sent a reset link. It expires in 30 minutes." }
```

**Always `202`, always this message**, whether or not the account exists and whether or not it uses password authentication. A response that varied would enumerate accounts — the same reasoning as the generic 401 above.

**Validation** — VR-01 format only. Existence is deliberately not validated in the response.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `VALIDATION_FAILED` | 422 | Not a DIU institutional address | "Use your DIU university email address." |

**Status Codes** — `202`, `422`, `503`.

---

### POST /api/v1/auth/password-reset/confirm

**Purpose** — Consume a reset token and set a new password (FR-AUTH-08).

**Authentication** — `None` (the token is the credential).

**Request Body**

```json
{
  "token": "eyJ…",
  "newPassword": "a new sufficiently long secret"
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `token` | string | yes | Single-use, time-limited. Consumed on success |
| `newPassword` | string | yes | VR-02 — minimum 10 characters, at least three of: lowercase, uppercase, digit, symbol |

**Response Body**

```json
{ "message": "Your password has been changed. Sign in with your new password." }
```

All existing sessions for the account are revoked. The user is not signed in automatically.

**Validation** — token valid, unexpired, unconsumed; VR-02 complexity, with **the unmet criteria listed individually** in `error.fields[]`.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `RESET_TOKEN_INVALID` | 422 | Unknown, expired or already used | "That reset link has expired or has already been used. Request a new one." |
| `VALIDATION_FAILED` | 422 | VR-02 not met | "Your password needs at least 10 characters and three of: a lowercase letter, an uppercase letter, a digit, a symbol." |

**Status Codes** — `200`, `422`, `503`.

---

## 1.2 Own profile

### GET /api/v1/me

**Purpose** — Return the caller's own profile (permission matrix: *Own profile — R U* for every authenticated role).

**Authentication** — `Session`.

**Request Body** — none.

**Response Body**

```json
{
  "userId": "0191f3c2-7a10-7b3e-9d21-4c5a6b7c8d90",
  "email": "student@diu.edu.bd",
  "fullName": "Nusrat Jahan",
  "status": "active",
  "roles": ["STU"],
  "authMethod": "sso",
  "studentProfile": {
    "studentRef": "221-15-5678",
    "programme": "BSc in CSE",
    "isEnrolled": true
  },
  "version": 4
}
```

| Field | Type | Notes |
|---|---|---|
| `status` | enum | `pending` \| `active` \| `suspended` \| `deactivated` |
| `authMethod` | enum | `sso` \| `local` — derived from the presence of `local_credential` |
| `studentProfile` | object \| null | Null for non-student accounts |
| `version` | integer | Required on `PATCH` (VR-92) |

**Validation** — none.

**Error Responses** — universal set only.

**Status Codes** — `200`, `401`.

---

### PATCH /api/v1/me

**Purpose** — Update the caller's own editable profile fields.

**Authentication** — `Session + Own`.

**Request Body**

```json
{ "fullName": "Nusrat Jahan Mim", "version": 4 }
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `fullName` | string | no | Non-empty after trimming |
| `version` | integer | yes | VR-92 |

`email`, `status`, `roles` and `studentRef` are **not** editable here. Email is the institutional identifier; status and roles are Administrator-only (PRM-13); `studentRef` is VR-03 and set at provisioning.

**Response Body** — the full profile object of `GET /api/v1/me`, with `version` incremented.

**Validation** — VR-92 version match; `fullName` non-empty; any attempt to include a non-editable field → 422 naming it.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `FIELD_NOT_EDITABLE` | 422 | Body contains `email`, `status`, `roles` or `studentRef` | "That detail can't be changed here. Contact DIU IT if it's wrong." |
| `CONFLICT_STALE_VERSION` | 409 | VR-92 | See §0.6 |

**Status Codes** — `200`, `401`, `409`, `422`.

---

## 1.3 Account administration

All endpoints in §1.3 are `Session + Role(ADM)` — permission matrix row *User accounts & roles: ADM = C R U D*, every other role `—`. All write `audit.audit_log`.

### GET /api/v1/users

**Purpose** — Administrator account console listing (FR-AUTH-12).

**Authentication** — `Session + Role(ADM)`.

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `q` | string | no | Matches name, email or student reference. Minimum 2 characters |
| `status` | enum | no | `pending` \| `active` \| `suspended` \| `deactivated` |
| `role` | string | no | Role code filter |
| `limit` / `cursor` | — | no | §0.8 |

**Response Body**

```json
{
  "items": [
    {
      "userId": "0191f3c2-…",
      "email": "student@diu.edu.bd",
      "fullName": "Nusrat Jahan",
      "status": "active",
      "roles": ["STU"],
      "studentRef": "221-15-5678",
      "createdAt": "2026-01-14T09:12:00+06:00",
      "version": 4
    }
  ],
  "nextCursor": null
}
```

Returns account metadata only. It carries no appointment, payment, medicine or counseling information — an administrator listing accounts learns nothing about any student's use of any service (PRM-09).

**Validation** — `q` minimum 2 characters when present.

**Error Responses** — universal set only.

**Status Codes** — `200`, `401`, `403`, `422`.

---

### POST /api/v1/users

**Purpose** — Create a provider or administrator account. Credentials are issued by an Administrator; there is no self-registration path for any non-student role (FR-AUTH-02, BR-05).

**Authentication** — `Session + Role(ADM)`.

**Request Body**

```json
{
  "email": "dr.rahman@diu.edu.bd",
  "fullName": "Dr. Rahman",
  "authMethod": "local",
  "roles": ["MCS"],
  "isClinicalStaff": false,
  "locationId": "0191f3aa-…"
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `email` | string | yes | VR-01; unique across `identity.user_account` |
| `fullName` | string | yes | Non-empty |
| `authMethod` | enum | yes | `sso` \| `local`. `local` provisions a `local_credential` row and emails a first-use reset link |
| `roles` | string[] | yes | ≥1 valid role code. `STU` is rejected here — student accounts are provisioned by SSO |
| `isClinicalStaff` | boolean | no | VR-04 precondition for a later `CNP` grant |
| `locationId` | uuid | no | Defaults to the single Phase 1 location (ADR-013) |

**Response Body** — the created account object (as `GET /api/v1/users/{id}`), `status: "pending"` until first successful sign-in.

**Validation** — VR-01 email format and uniqueness; VR-04 (`CNP` may be granted only to an account flagged clinical staff, and only by an Administrator); `roles` non-empty and excludes `STU`.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `EMAIL_ALREADY_REGISTERED` | 409 | Email exists | "An account with that email already exists." |
| `ROLE_NOT_ASSIGNABLE` | 422 | `STU` requested, or `CNP` without `isClinicalStaff` (VR-04) | "The Counseling Professional role can only be given to an account marked as clinical staff." |

A rejected `CNP` grant is logged as a security event, not merely refused (VR-04).

**Status Codes** — `201`, `401`, `403`, `409`, `422`.

---

### GET /api/v1/users/{id}

**Purpose** — Administrator view of one account (FR-AUTH-12).

**Authentication** — `Session + Role(ADM)`.

**Request Body** — none.

**Response Body**

```json
{
  "userId": "0191f3c2-…",
  "email": "student@diu.edu.bd",
  "fullName": "Nusrat Jahan",
  "status": "active",
  "authMethod": "sso",
  "roles": [
    { "code": "STU", "grantedBy": "0191f000-…", "grantedAt": "2026-01-14T09:12:00+06:00" }
  ],
  "studentProfile": { "studentRef": "221-15-5678", "programme": "BSc in CSE", "isEnrolled": true },
  "lockedUntil": null,
  "lastLoginAt": "2026-08-03T08:41:00+06:00",
  "version": 4
}
```

Writes `audit.data_access_log` — an administrator reading another user's record is access to a student's personal data by a non-owning user (FR-AUTH-03 read path, FR-AUD-03).

**Validation** — none.

**Error Responses** — universal set only. A non-existent id returns `404`.

**Status Codes** — `200`, `401`, `403`, `404`.

---

### PATCH /api/v1/users/{id}

**Purpose** — Edit an account's administrative attributes (FR-AUTH-12).

**Authentication** — `Session + Role(ADM)`.

**Request Body**

```json
{ "fullName": "Dr. M. Rahman", "isClinicalStaff": true, "version": 2 }
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `fullName` | string | no | Non-empty |
| `isClinicalStaff` | boolean | no | VR-04 gate for `CNP` |
| `locationId` | uuid | no | — |
| `version` | integer | yes | VR-92 |

`status` is not editable here — the lifecycle actions below exist so that each transition carries its own rule, audit entry and side effects (FR-AUTH-10). `roles` is not editable here for the same reason.

**Response Body** — the updated account object.

**Validation** — VR-92; `fullName` non-empty; `status` or `roles` present → 422.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `FIELD_NOT_EDITABLE` | 422 | `status` or `roles` in body | "Use the account status or role actions to change that." |
| `CONFLICT_STALE_VERSION` | 409 | VR-92 | See §0.6 |

**Status Codes** — `200`, `401`, `403`, `404`, `409`, `422`.

---

### POST /api/v1/users/{id}/suspend

**Purpose** — Transition an account to `suspended` (FR-AUTH-10, BR-06). A suspended account cannot sign in; its records are retained.

**Authentication** — `Session + Role(ADM)`.

**Request Body**

```json
{ "reason": "Enrolment under review by the registrar", "version": 4 }
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `reason` | string | yes | VR-93 — ≥10 characters after trimming |
| `version` | integer | yes | VR-92 |

**Response Body** — the updated account object with `status: "suspended"`.

All live sessions for the account are revoked immediately.

**Validation** — VR-93 reason; VR-92 version; current status must be `active` or `pending`.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `INVALID_STATUS_TRANSITION` | 409 | Account already `deactivated` | "This account is already deactivated." |

**Status Codes** — `200`, `401`, `403`, `404`, `409`, `422`.

---

### POST /api/v1/users/{id}/activate

**Purpose** — Transition an account to `active` from `pending` or `suspended` (FR-AUTH-10).

**Authentication** — `Session + Role(ADM)`.

**Request Body**

```json
{ "reason": "Enrolment confirmed by the registrar", "version": 5 }
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `reason` | string | yes | VR-93 |
| `version` | integer | yes | VR-92 |

**Response Body** — the updated account object with `status: "active"`.

**Validation** — VR-93; VR-92; current status is `pending` or `suspended`. Reactivating a `deactivated` account is permitted and is audited as such; it does not restore cancelled bookings.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `INVALID_STATUS_TRANSITION` | 409 | Already `active` | "This account is already active." |

**Status Codes** — `200`, `401`, `403`, `404`, `409`, `422`.

---

### POST /api/v1/users/{id}/deactivate

**Purpose** — Transition an account to `deactivated`, retaining all historical records and rendering them inaccessible to that account (FR-AUTH-10, FR-AUTH-11, BR-06).

**Authentication** — `Session + Role(ADM)`.

**Request Body**

```json
{
  "reason": "Student graduated at the end of Spring 2026",
  "confirmedImpact": true,
  "version": 5
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `reason` | string | yes | VR-93 |
| `confirmedImpact` | boolean | yes | VR-05 — must be `true` after the caller has been shown the impact |
| `version` | integer | yes | VR-92 |

**Response Body**

```json
{
  "userId": "0191f3c2-…",
  "status": "deactivated",
  "cancelledAppointments": [
    { "appointmentRef": "MED-2026-0081", "sessionDate": "2026-08-05", "doctorName": "Dr. Rahman" }
  ],
  "version": 6
}
```

Emits `AccountDeactivated`. Bookings are cancelled with reason `Account Inactive` and the student is notified at their last known address (EC-06). The event is also delivered to the vault (§12.3) so that an open counseling case remains accessible to Counseling Professionals until closed (EC-55) — **Core is told nothing back about whether such a case exists.**

**Validation** — VR-93; VR-92; VR-05 — when the account holds active bookings, `confirmedImpact` must be `true`; a request without it is rejected with the impact listed so the Administrator can confirm knowingly.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `CONFIRMATION_REQUIRED` | 409 | VR-05 — active bookings exist and `confirmedImpact` is not `true`. `error.details.activeAppointments[]` lists them | "This account has 2 upcoming appointments. They'll be cancelled and the student notified. Confirm to continue." |
| `INVALID_STATUS_TRANSITION` | 409 | Already `deactivated` | "This account is already deactivated." |

**Status Codes** — `200`, `401`, `403`, `404`, `409`, `422`.

---

## 1.4 Roles

### GET /api/v1/roles

**Purpose** — Return the role catalogue for the account console (SRS §3.5.1).

**Authentication** — `Session + Role(ADM)`.

**Request Body** — none.

**Response Body**

```json
{
  "items": [
    { "code": "STU", "name": "Student", "assignableByAdmin": false, "requiresClinicalStaff": false },
    { "code": "CNP", "name": "Counseling Professional", "assignableByAdmin": true, "requiresClinicalStaff": true }
  ]
}
```

| Field | Type | Notes |
|---|---|---|
| `assignableByAdmin` | boolean | `false` for `STU` — student accounts are provisioned by SSO |
| `requiresClinicalStaff` | boolean | `true` for `CNP` only (VR-04) |

**Validation** — none.

**Error Responses** — universal set only.

**Status Codes** — `200`, `401`, `403`.

---

### POST /api/v1/users/{id}/roles

**Purpose** — Grant a role. Only an Administrator may assign roles, and every assignment is audited (FR-AUTH-03, PRM-13, BR-03).

**Authentication** — `Session + Role(ADM)`.

**Request Body**

```json
{ "roleCode": "MCS", "reason": "Joined medical centre reception on 1 August" }
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `roleCode` | string | yes | One of `DOC`, `MCS`, `STO`, `CNP`, `ADM`. `STU` is not grantable |
| `reason` | string | yes | VR-93 |

**Response Body** — the updated account object with the new role in `roles[]`.

**Granting `CNP` does not by itself grant counseling access.** The vault keeps its own roster (ADR-012); a separate entry on `counseling.clinical_roster` is required, made inside the vault by a Counseling Professional. This endpoint cannot create that entry, and the response says so — the two-authority split is the whole point of NFR-SEC-06.

**Validation** — VR-04 (`CNP` requires `isClinicalStaff`); role not already held; `roleCode` is not `STU`; VR-93 reason.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `ROLE_NOT_ASSIGNABLE` | 422 | `STU` requested, or `CNP` without `isClinicalStaff` (VR-04) | "The Counseling Professional role can only be given to an account marked as clinical staff." |
| `ROLE_ALREADY_HELD` | 409 | Active grant exists | "This account already has that role." |

A refused `CNP` grant is logged as a security event (VR-04).

**Status Codes** — `200`, `401`, `403`, `404`, `409`, `422`.

---

### DELETE /api/v1/users/{id}/roles/{roleCode}

**Purpose** — Revoke a role. Sets `revoked_at`; the grant row is never deleted (DATABASE P4, PRM-13).

**Authentication** — `Session + Role(ADM)`.

**Request Body**

```json
{ "reason": "Transferred out of the medical centre" }
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `reason` | string | yes | VR-93 |

**Response Body** — the updated account object.

The reduction takes effect on the affected user's **next request**, with no re-authentication required and no forced sign-out (PRM-15).

**Validation** — VR-93; the role is currently held; the caller may not revoke their own last `ADM` role — a system with no administrator cannot be repaired through this API.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `ROLE_NOT_HELD` | 404 | No active grant | "This account doesn't have that role." |
| `LAST_ADMIN_ROLE` | 409 | Would leave the system with no active Administrator | "You can't remove the last administrator. Give another account the Administrator role first." |

**Status Codes** — `200`, `401`, `403`, `404`, `409`, `422`.

---
# Part 2 — Module DASH
### Student Health Dashboard & Public Views

Covers FR-DASH-01…08, FR-UI-04/05, PRM-04, PRM-11, BR-04. Base path `/api/v1`.

**Module-wide rules.** The `/public/*` routes are the anonymous read path of ARCHITECTURE §5.4 — served from the availability projection, cacheable at the edge, eventually consistent within 60 seconds. They expose **no patient identity, no appointment detail, no counseling information and no exact medicine quantity** (FR-DASH-07, BR-04, BR-35, PRM-04, PRM-11). Every field below has been checked against that constraint; nothing here can be joined back to a person.

---

### GET /api/v1/me/dashboard

**Purpose** — The authenticated student's dashboard in one call: upcoming appointments with live status and estimate, today's doctors on duty, medicine store state, unread notification count, and any active announcement (FR-DASH-01…04, FR-DASH-08).

**Authentication** — `Session + Own`. The response is always the caller's own data; there is no `userId` parameter, by design (FR-AUTH-15, BR-02, PRM-03).

**Request Body** — none.

**Response Body**

```json
{
  "student": { "fullName": "Nusrat Jahan", "studentRef": "221-15-5678" },
  "upcomingAppointments": [
    {
      "appointmentId": "0191f4a1-…",
      "appointmentRef": "MED-2026-0081",
      "doctorName": "Dr. Rahman",
      "sessionDate": "2026-08-03",
      "serialNumber": 7,
      "status": "booked",
      "patientsAhead": 3,
      "currentEstimate": "2026-08-03T10:40:00+06:00",
      "estimateDisclaimer": "This is an estimate, not a guaranteed appointment time.",
      "paymentStatus": "unpaid",
      "version": 2
    }
  ],
  "todaysDoctors": [
    {
      "doctorId": "0191f200-…",
      "fullName": "Dr. Rahman",
      "specialisation": "General Medicine",
      "dutyStartsAt": "2026-08-03T09:00:00+06:00",
      "dutyEndsAt": "2026-08-03T13:00:00+06:00",
      "sessionStatus": "started"
    }
  ],
  "medicineStore": {
    "isOpen": true,
    "opensAt": "09:00",
    "closesAt": "17:00",
    "stateSource": "scheduled_hours"
  },
  "notifications": { "unreadCount": 2 },
  "announcements": [
    { "id": "0191f5aa-…", "body": "The medical centre will close at 1 PM on 12 August.", "endsAt": "2026-08-12T23:59:00+06:00" }
  ],
  "bookingSuspension": null
}
```

| Field | Type | Notes |
|---|---|---|
| `upcomingAppointments[].patientsAhead` | integer | Computed at read time by queue ordering — never stored (DATABASE §4.3, rejected denormalisations) |
| `upcomingAppointments[].currentEstimate` | timestamptz | `appointment.current_estimate`, refreshed on the five events of FR-APT-21 |
| `estimateDisclaimer` | string | **Always present on every appointment object.** FR-APT-08 and BR-19 forbid presenting a booked time as guaranteed anywhere in any interface. Making the disclaimer a field rather than client-side copy means the rule cannot be dropped by a template edit |
| `medicineStore.stateSource` | enum | `scheduled_hours` \| `manual_override` (BR-42) |
| `bookingSuspension` | object \| null | When active: `{ suspendedUntil, reason, walkInRemainsAvailable: true }` (FR-APT-14, BR-15) |

**No counseling panel.** FR-DASH-03 lists the student's counseling request status as dashboard content, and FR-DASH-05 restricts it to that student. Core cannot supply it: it holds no credential to the counseling database (ADR-001). The client composes the dashboard from this call plus `GET /counseling/api/v1/me/requests` (§10.7). If the vault is unavailable, the medical and medicine panels render normally and the counseling panel shows a neutral unavailable state (ARCHITECTURE §10.4, failure mode F3). See §0.11.

**Validation** — none.

**Error Responses** — universal set only.

**Status Codes** — `200`, `401`, `403`.

---

### GET /api/v1/public/availability

**Purpose** — The login-free availability view: doctors on duty, their duty times and current availability state, for the current and next 7 days (FR-DASH-06, FR-UI-05).

**Authentication** — `None`.

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `from` | date | no | Defaults to today. May not be earlier than today |
| `to` | date | no | Defaults to `from` + 6 days. Capped at the configured publication window (FR-SCH-12, default 7 days); a longer range is silently clamped, not rejected |
| `doctorId` | uuid | no | Filter to one doctor |

**Response Body**

```json
{
  "days": [
    {
      "date": "2026-08-03",
      "isServiceDay": true,
      "closureReason": null,
      "sessions": [
        {
          "sessionId": "0191f300-…",
          "doctorId": "0191f200-…",
          "doctorName": "Dr. Rahman",
          "designation": "Consultant",
          "specialisation": "General Medicine",
          "photoUrl": "/media/doctors/0191f200.jpg",
          "startsAt": "2026-08-03T09:00:00+06:00",
          "endsAt": "2026-08-03T13:00:00+06:00",
          "status": "started",
          "bookableSlotCount": 21,
          "bookedSlotCount": 14,
          "remainingSlotCount": 7
        }
      ]
    }
  ],
  "asOf": "2026-08-03T10:32:00+06:00",
  "publicationWindowDays": 7
}
```

| Field | Type | Notes |
|---|---|---|
| `isServiceDay` / `closureReason` | boolean / string \| null | Non-service days are shown **with their reason** rather than omitted (FR-SCH-11, BR-28) |
| `bookedSlotCount` / `remainingSlotCount` | integer | Counts only. **No patient identity of any kind** (FR-APT-02, BR-04) |
| `asOf` | timestamptz | Projection freshness. May trail live state by up to 60 s (ARCHITECTURE §5.4) |

Served from `pharmacy`/`scheduling` projections behind a 60-second edge cache. `Cache-Control: public, max-age=60` and an `ETag` are returned; the response is identical for every viewer, which is what makes it cacheable and what makes it safe.

**Validation** — `from` not in the past; `to` ≥ `from`; range clamped to the publication window.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `INVALID_DATE_RANGE` | 422 | `to` earlier than `from`, or `from` in the past | "Choose a date from today onwards." |

**Status Codes** — `200`, `422`, `503`.

---

### GET /api/v1/public/queue-display

**Purpose** — The wall-mounted display feed: the serial currently in consultation per doctor, and nothing else (FR-UI-04, FR-APT-30).

**Authentication** — `None`.

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `locationId` | uuid | no | Defaults to the single Phase 1 location |

**Response Body**

```json
{
  "date": "2026-08-03",
  "doctors": [
    {
      "doctorName": "Dr. Rahman",
      "roomLabel": "Room 2",
      "nowServingSerial": 5,
      "sessionStatus": "started",
      "waitingCount": 9
    },
    {
      "doctorName": "Dr. Chowdhury",
      "roomLabel": "Room 3",
      "nowServingSerial": null,
      "sessionStatus": "interrupted",
      "waitingCount": 4
    }
  ],
  "asOf": "2026-08-03T10:32:10+06:00"
}
```

| Field | Type | Notes |
|---|---|---|
| `nowServingSerial` | integer \| null | The serial of the `in_consultation` entry. Null when none |
| `waitingCount` | integer | Aggregate only |
| `sessionStatus` | enum | Includes `interrupted` so a display can show that a doctor has been called away (EC-04) rather than appearing frozen |

**There is no name, no student reference, no appointment reference and no reason-for-visit in this response** — the display hangs in a public corridor. A serial number is not identifying on its own, which is precisely why the queue is serial-ordered (BR-04, PRM-04, PRM-11).

Clients refresh by polling; the response carries `Cache-Control: public, max-age=15`.

**Validation** — none.

**Error Responses** — universal set only.

**Status Codes** — `200`, `503`.

---

### GET /api/v1/public/store-status

**Purpose** — The medicine store's current open/closed state, today's hours and closing time, without authentication (FR-MED-08, FR-DASH-06).

**Authentication** — `None`.

**Request Body** — none.

**Response Body**

```json
{
  "isOpen": true,
  "today": { "weekday": 1, "opensAt": "09:00", "closesAt": "17:00" },
  "stateSource": "scheduled_hours",
  "overrideReason": null,
  "weeklyHours": [
    { "weekday": 0, "opensAt": null, "closesAt": null },
    { "weekday": 1, "opensAt": "09:00", "closesAt": "17:00" }
  ],
  "asOf": "2026-08-03T10:32:00+06:00"
}
```

| Field | Type | Notes |
|---|---|---|
| `stateSource` | enum | `scheduled_hours` \| `manual_override` (BR-42, FR-MED-26) |
| `overrideReason` | string \| null | Present only under a manual override (FR-MED-27). A student who walks to a closed store deserves to know why |
| `weeklyHours[]` | array | `opensAt`/`closesAt` null means closed that weekday |

**Validation** — none.

**Error Responses** — universal set only.

**Status Codes** — `200`, `503`.

---

### GET /api/v1/public/announcements

**Purpose** — Active announcement banners for the public view and the student dashboard (FR-ADM-04, FR-DASH-08).

**Authentication** — `None`.

**Request Body** — none.

**Response Body**

```json
{
  "items": [
    {
      "id": "0191f5aa-…",
      "body": "The medical centre will close at 1 PM on 12 August for a staff training day.",
      "startsAt": "2026-08-01T00:00:00+06:00",
      "endsAt": "2026-08-12T23:59:00+06:00"
    }
  ]
}
```

Returns only announcements where server time falls between `startsAt` and `endsAt`. `body` is plain text, escaped on output, never interpreted as markup (VR-90).

**Validation** — none.

**Error Responses** — universal set only.

**Status Codes** — `200`, `503`.

---

### GET /api/v1/public/service-calendar

**Purpose** — Non-service days with their reasons, so a student can see closures before attempting to book (FR-SCH-10, FR-SCH-11, BR-28).

**Authentication** — `None`.

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `from` | date | no | Defaults to today |
| `to` | date | no | Defaults to `from` + 30 days. Range capped at 90 days |

**Response Body**

```json
{
  "items": [
    { "date": "2026-08-15", "isServiceDay": false, "reason": "National Mourning Day" },
    { "date": "2026-08-16", "isServiceDay": false, "reason": "Weekly holiday" }
  ]
}
```

**Validation** — `to` ≥ `from`; range ≤ 90 days.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `INVALID_DATE_RANGE` | 422 | `to` earlier than `from`, or range over 90 days | "Choose a date range of up to 90 days." |

**Status Codes** — `200`, `422`, `503`.

---
# Part 3 — Module SCH
### Doctor & Schedule Management

Covers FR-SCH-01…16, VR-10…VR-19, BR-25…BR-29, EC-04, EC-20. Base path `/api/v1`.

**Module-wide rules.** The published schedule is the sole source of truth; no appointment is creatable outside a published session (FR-SCH-13, BR-25). Every creation, modification and deletion writes an append-only audit entry with actor, timestamp, previous value and new value (FR-SCH-15). Any change taking effect within 24 hours requires a stated reason (FR-SCH-14, VR-18). Doctor profiles and catalogue rows with history are deactivated, never deleted (EC-20).

---

## 3.1 Doctors

### GET /api/v1/doctors

**Purpose** — List doctor profiles (FR-SCH-01). Read access is broad — the permission matrix gives every role including `ANON` read on doctor profiles.

**Authentication** — `None` for the public projection; `Session` returns the same shape. Write operations below require `Session + Role(MCS)`.

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `isActive` | boolean | no | Defaults to `true` |
| `q` | string | no | Name or specialisation match, minimum 2 characters |
| `limit` / `cursor` | — | no | §0.8 |

**Response Body**

```json
{
  "items": [
    {
      "doctorId": "0191f200-…",
      "fullName": "Dr. Rahman",
      "designation": "Consultant",
      "specialisation": "General Medicine",
      "photoUrl": "/media/doctors/0191f200.jpg",
      "isActive": true,
      "version": 3
    }
  ],
  "nextCursor": null
}
```

**Validation** — `q` minimum 2 characters when present.

**Error Responses** — universal set only.

**Status Codes** — `200`, `422`.

---

### POST /api/v1/doctors

**Purpose** — Create a doctor profile: name, designation, specialisation, optional photograph (FR-SCH-01).

**Authentication** — `Session + Role(MCS)`.

**Request Body**

```json
{
  "fullName": "Dr. Rahman",
  "designation": "Consultant",
  "specialisation": "General Medicine",
  "photoUrl": "/media/doctors/0191f200.jpg",
  "userAccountId": null,
  "locationId": "0191f000-…"
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `fullName` | string | yes | Non-empty after trimming |
| `designation` | string | no | — |
| `specialisation` | string | no | — |
| `photoUrl` | string | no | Same-origin media path |
| `userAccountId` | uuid \| null | no | Optional link to a login account. **Nullable by design** — no Phase 1 function depends on a doctor logging in (CON-02) |
| `locationId` | uuid | no | Defaults to the single Phase 1 location |

**Response Body** — the created doctor object with `version: 1`.

**Validation** — `fullName` non-empty; `userAccountId`, when given, must exist and not already be linked to another doctor.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `ACCOUNT_ALREADY_LINKED` | 409 | `userAccountId` already belongs to another doctor profile | "That account is already linked to a different doctor profile." |

**Status Codes** — `201`, `401`, `403`, `409`, `422`.

---

### GET /api/v1/doctors/{id}

**Purpose** — Retrieve one doctor profile.

**Authentication** — `None`.

**Request Body** — none.

**Response Body** — a single doctor object as in `GET /api/v1/doctors`, plus:

```json
{
  "activeRosterCount": 3,
  "upcomingSessionCount": 12
}
```

Counts only; no appointment or patient data (BR-04).

**Validation** — none.

**Error Responses** — universal set only.

**Status Codes** — `200`, `404`.

---

### PATCH /api/v1/doctors/{id}

**Purpose** — Edit a doctor profile (FR-SCH-01).

**Authentication** — `Session + Role(MCS)`.

**Request Body**

```json
{ "designation": "Senior Consultant", "specialisation": "Internal Medicine", "version": 3 }
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `fullName` | string | no | Non-empty |
| `designation` | string \| null | no | — |
| `specialisation` | string \| null | no | — |
| `photoUrl` | string \| null | no | — |
| `version` | integer | yes | VR-92 |

**Response Body** — the updated doctor object.

**Validation** — VR-92; `fullName` non-empty when present.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `CONFLICT_STALE_VERSION` | 409 | VR-92 | See §0.6 |

**Status Codes** — `200`, `401`, `403`, `404`, `409`, `422`.

---

### POST /api/v1/doctors/{id}/deactivate

**Purpose** — Deactivate a doctor profile, retaining all history (EC-20). This is the supported alternative to deletion.

**Authentication** — `Session + Role(MCS)`.

**Request Body**

```json
{ "reason": "Left the medical centre at the end of July", "version": 3 }
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `reason` | string | yes | VR-93 |
| `version` | integer | yes | VR-92 |

**Response Body**

```json
{
  "doctorId": "0191f200-…",
  "isActive": false,
  "affectedUpcomingSessions": 4,
  "message": "Upcoming sessions remain scheduled. Cancel them or record unavailability to release the bookings.",
  "version": 4
}
```

Deactivation **does not** cancel upcoming sessions or bookings. Bulk cancellation goes through the unavailability flow of §3.4, which carries the mandatory impact preview (FR-SCH-07). Making deactivation quietly cancel bookings would bypass that confirmation.

**Validation** — VR-93; VR-92; doctor currently active.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `ALREADY_INACTIVE` | 409 | Already deactivated | "This doctor profile is already inactive." |

**Status Codes** — `200`, `401`, `403`, `404`, `409`, `422`.

---

### DELETE /api/v1/doctors/{id}

**Purpose** — Delete a doctor profile. Permitted **only** when no appointment has ever referenced it (EC-20).

**Authentication** — `Session + Role(MCS)`.

**Request Body** — none.

**Response Body** — none on success.

**Validation** — no `clinic_session` with any `appointment` references this doctor. The check is on historical appointments, not on active ones: a deleted doctor would orphan a completed consultation record.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `DOCTOR_HAS_HISTORY` | 409 | Any appointment references this doctor's sessions. `error.details.affectedRecords` carries the count | "This doctor has 214 appointment records and can't be deleted. Deactivate the profile instead — the records stay intact." |

**Status Codes** — `204`, `401`, `403`, `404`, `409`.

---

## 3.2 Duty rosters

### GET /api/v1/doctors/{id}/duty-rosters

**Purpose** — List a doctor's recurring weekly duty pattern (FR-SCH-02).

**Authentication** — `Session`.

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `isActive` | boolean | no | Defaults to `true` |

**Response Body**

```json
{
  "items": [
    {
      "rosterId": "0191f280-…",
      "weekday": 1,
      "startsAtLocal": "09:00",
      "endsAtLocal": "13:00",
      "effectiveFrom": "2026-01-01",
      "effectiveTo": null,
      "isActive": true,
      "version": 1
    }
  ]
}
```

| Field | Type | Notes |
|---|---|---|
| `weekday` | integer 0–6 | 0 = Sunday, matching `scheduling.duty_roster.weekday` |
| `startsAtLocal` / `endsAtLocal` | `HH:mm` | **Local wall-clock, no offset.** A roster is "every Sunday 09:00" — a recurring intention, not an instant (DATABASE §9) |

**Validation** — none.

**Error Responses** — universal set only.

**Status Codes** — `200`, `401`, `404`.

---

### POST /api/v1/doctors/{id}/duty-rosters

**Purpose** — Define a recurring weekly duty roster entry (FR-SCH-02).

**Authentication** — `Session + Role(MCS)`.

**Request Body**

```json
{
  "weekday": 1,
  "startsAtLocal": "09:00",
  "endsAtLocal": "13:00",
  "effectiveFrom": "2026-08-01",
  "effectiveTo": null
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `weekday` | integer | yes | 0–6 |
| `startsAtLocal` | `HH:mm` | yes | VR-10 — within 00:00–23:59 |
| `endsAtLocal` | `HH:mm` | yes | VR-10 — strictly after `startsAtLocal` |
| `effectiveFrom` | date | yes | — |
| `effectiveTo` | date \| null | no | On or after `effectiveFrom` |

**Response Body** — the created roster object.

**Validation** — VR-10 end strictly after start, both within the day; `effectiveTo` on or after `effectiveFrom`; no overlapping active roster entry for the same doctor and weekday in an overlapping effective period.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `ROSTER_OVERLAP` | 409 | An active entry already covers part of this weekday and period. `error.details.conflictingRoster` names it | "This doctor already has duty on Monday from 9:00 AM to 1:00 PM. Change that entry instead." |

**Status Codes** — `201`, `401`, `403`, `404`, `409`, `422`.

---

### PATCH /api/v1/duty-rosters/{id}

**Purpose** — Modify a roster entry (FR-SCH-02, FR-SCH-15).

**Authentication** — `Session + Role(MCS)`.

**Request Body**

```json
{ "endsAtLocal": "14:00", "version": 1 }
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `weekday` | integer | no | 0–6 |
| `startsAtLocal` / `endsAtLocal` | `HH:mm` | no | VR-10 |
| `effectiveFrom` / `effectiveTo` | date | no | — |
| `version` | integer | yes | VR-92 |

Editing a roster **does not** retroactively alter sessions already materialised from it. Materialised sessions are edited through §3.3 — a roster is a template, and rewriting history from a template edit would silently move appointments.

**Response Body** — the updated roster object.

**Validation** — VR-10; VR-92; no resulting overlap.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `ROSTER_OVERLAP` | 409 | Result would overlap another entry | "That change overlaps this doctor's Monday 9:00 AM duty." |
| `CONFLICT_STALE_VERSION` | 409 | VR-92 | See §0.6 |

**Status Codes** — `200`, `401`, `403`, `404`, `409`, `422`.

---

### DELETE /api/v1/duty-rosters/{id}

**Purpose** — Retire a roster entry. Sets `is_active` false; the row is retained for audit (DATABASE P4, FR-SCH-15).

**Authentication** — `Session + Role(MCS)`.

**Request Body**

```json
{ "reason": "Doctor moved to the afternoon clinic from September" }
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `reason` | string | yes | VR-93 |

**Response Body** — none.

Already-materialised sessions are unaffected. Future sessions are simply not generated from this entry.

**Validation** — VR-93; entry currently active.

**Error Responses** — universal set only.

**Status Codes** — `204`, `401`, `403`, `404`, `422`.

---

## 3.3 Clinic sessions

### GET /api/v1/sessions

**Purpose** — List materialised sessions for a date range (FR-SCH-03, FR-SCH-05).

**Authentication** — `Session`.

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `from` | date | no | Defaults to today |
| `to` | date | no | Defaults to `from` + 6 days; range ≤ 60 days |
| `doctorId` | uuid | no | — |
| `status` | enum | no | `scheduled` \| `started` \| `interrupted` \| `completed` \| `cancelled` |

**Response Body**

```json
{
  "items": [
    {
      "sessionId": "0191f300-…",
      "doctorId": "0191f200-…",
      "doctorName": "Dr. Rahman",
      "sessionDate": "2026-08-03",
      "startsAt": "2026-08-03T09:00:00+06:00",
      "endsAt": "2026-08-03T13:00:00+06:00",
      "slotLengthMinutes": 10,
      "walkInAllocationPct": 30,
      "totalSlotCount": 24,
      "bookableSlotCount": 17,
      "bookedSlotCount": 14,
      "status": "started",
      "actuallyStartedAt": "2026-08-03T09:12:00+06:00",
      "actuallyEndedAt": null,
      "isOverride": false,
      "version": 2
    }
  ],
  "nextCursor": null
}
```

| Field | Type | Notes |
|---|---|---|
| `bookableSlotCount` | integer | Derived as (100% − `walkInAllocationPct`) of capacity (FR-SCH-05, BR-16) |
| `isOverride` | boolean | True when `duty_roster_id` is null — created as a date-specific override (FR-SCH-03) |

**Validation** — `to` ≥ `from`; range ≤ 60 days.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `INVALID_DATE_RANGE` | 422 | Range invalid or over 60 days | "Choose a date range of up to 60 days." |

**Status Codes** — `200`, `401`, `422`.

---

### POST /api/v1/sessions

**Purpose** — Create a date-specific session, either materialising a roster occurrence or adding an override that takes precedence over the recurring pattern (FR-SCH-03, FR-SCH-04).

**Authentication** — `Session + Role(MCS)`.

**Request Body**

```json
{
  "doctorId": "0191f200-…",
  "sessionDate": "2026-08-10",
  "startsAt": "2026-08-10T09:00:00+06:00",
  "endsAt": "2026-08-10T13:00:00+06:00",
  "slotLengthMinutes": 10,
  "walkInAllocationPct": 30,
  "dutyRosterId": null,
  "changeReason": null,
  "overrideNonServiceDay": false
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `doctorId` | uuid | yes | Must be an active doctor |
| `sessionDate` | date | yes | VR-15 — within the publication window or the future |
| `startsAt` / `endsAt` | timestamptz | yes | VR-10 — end strictly after start |
| `slotLengthMinutes` | integer | no | VR-12 — 5–60 inclusive. Defaults to the configured value (OI-05, default 10) |
| `walkInAllocationPct` | integer | no | VR-13 — 0–99. **100 is rejected**: no slot would be bookable. Defaults to the configured value (OI-06, default 30) |
| `dutyRosterId` | uuid \| null | no | Null marks this as an override (FR-SCH-03) |
| `changeReason` | string \| null | conditional | VR-18 — **mandatory, ≥10 characters, when the session starts within 24 hours** (FR-SCH-14, BR-29) |
| `overrideNonServiceDay` | boolean | no | VR-17 — must be `true` to create a session on a non-service day |

**Response Body** — the created session object, including derived `totalSlotCount` and `bookableSlotCount`, plus the generated `session_slot` rows count.

**Validation** — VR-10 time order; VR-11 duration at least one slot length; VR-12 slot length 5–60; VR-13 walk-in allocation 0–99; VR-15 date within window or future; VR-17 non-service day requires explicit override; VR-18 reason when within 24 hours; VR-19 no overlap with another session for the same doctor.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `SESSION_OVERLAP` | 409 | VR-19 — overlaps another session for this doctor. `error.details.conflictingSession` names it | "Dr. Rahman already has a session from 9:00 AM to 1:00 PM that day." |
| `NON_SERVICE_DAY` | 409 | VR-17 — the date is a non-service day and `overrideNonServiceDay` is not `true`. `error.details.calendarEntry` names the closure | "10 August is marked as a non-service day: National Mourning Day. Remove that entry or confirm the override." |
| `SESSION_TOO_SHORT` | 422 | VR-11 — shorter than one slot length | "A session needs to be at least as long as one slot (10 minutes)." |
| `WALK_IN_ALLOCATION_INVALID` | 422 | VR-13 — 100 requested | "A 100% walk-in allocation would leave no slots available to book online. Choose 0–99." |
| `VALIDATION_FAILED` | 422 | VR-18 reason missing within 24 h | "Sessions starting within 24 hours need a reason of at least 10 characters." |

VR-19 is enforced by the `ex_session_no_overlap` GiST exclusion constraint, which is race-free — a check-then-insert would not be.

**Status Codes** — `201`, `401`, `403`, `409`, `422`.

---

### GET /api/v1/sessions/{id}

**Purpose** — Retrieve one session with its derived slot summary.

**Authentication** — `Session`.

**Request Body** — none.

**Response Body** — a session object as in `GET /api/v1/sessions`, plus:

```json
{
  "nextSerial": 15,
  "queueSummary": { "waiting": 9, "completed": 5, "noShow": 1, "inConsultation": 1 },
  "changeReason": null
}
```

Aggregate counts only. The ordered queue with per-patient detail is `GET /api/v1/sessions/{id}/queue` (§4.8), which carries a stricter permission.

**Validation** — none.

**Error Responses** — universal set only.

**Status Codes** — `200`, `401`, `404`.

---

### PATCH /api/v1/sessions/{id}

**Purpose** — Modify a session's timing or capacity configuration (FR-SCH-03, FR-SCH-04).

**Authentication** — `Session + Role(MCS)`.

**Request Body**

```json
{
  "startsAt": "2026-08-10T09:30:00+06:00",
  "endsAt": "2026-08-10T13:30:00+06:00",
  "changeReason": "Doctor arriving late from an external commitment",
  "version": 2
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `startsAt` / `endsAt` | timestamptz | no | VR-10 |
| `slotLengthMinutes` | integer | no | VR-12 |
| `walkInAllocationPct` | integer | no | VR-13 |
| `changeReason` | string | conditional | VR-18 — mandatory when the session starts within 24 hours |
| `version` | integer | yes | VR-92 |

**Reducing `bookableSlotCount` below the number of existing bookings is rejected.** Releasing already-booked patients is a cancellation, and cancellation goes through the unavailability flow with its impact preview (FR-SCH-07).

**Response Body** — the updated session object.

**Validation** — VR-10, VR-11, VR-12, VR-13, VR-18, VR-19, VR-92; capacity not reduced below existing bookings.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `SESSION_OVERLAP` | 409 | VR-19 | "That change overlaps Dr. Rahman's 2:00 PM session." |
| `CAPACITY_BELOW_BOOKINGS` | 409 | Would strand existing bookings. `error.details.bookedCount` given | "14 patients have already booked this session. Record doctor unavailability instead so they're notified properly." |
| `SESSION_ALREADY_STARTED` | 409 | Status is `started`, `completed` or `cancelled` | "This session has already started and its times can't be changed." |
| `CONFLICT_STALE_VERSION` | 409 | VR-92 | See §0.6 |

**Status Codes** — `200`, `401`, `403`, `404`, `409`, `422`.

---

### POST /api/v1/sessions/{id}/cancel

**Purpose** — Cancel a scheduled session and every booking in it, notifying affected students (FR-SCH-08, BR-26, BR-27).

**Authentication** — `Session + Role(MCS)`.

**Request Body**

```json
{
  "reason": "Doctor called to an emergency at the main campus",
  "confirmedImpact": true,
  "version": 2
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `reason` | string | yes | VR-93 |
| `confirmedImpact` | boolean | yes | Must be `true`; the caller must first have seen the affected bookings |
| `version` | integer | yes | VR-92 |

**Response Body**

```json
{
  "sessionId": "0191f300-…",
  "status": "cancelled",
  "cancelledAppointments": 14,
  "notificationsQueued": 14,
  "version": 3
}
```

Bookings transition to `cancelled` with reason `Doctor Unavailable`. Notifications dispatch within 5 minutes through every channel the student has enabled, and each carries remaining alternative availability (FR-SCH-08, FR-SCH-09, BR-27). Payments on cancelled appointments are flagged for manual refund on the collection summary — Phase 1 has no automated refund (EC-24).

**Validation** — VR-93; VR-92; `confirmedImpact` true; session not already `cancelled` or `completed`.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `CONFIRMATION_REQUIRED` | 409 | `confirmedImpact` not `true`. `error.details.affectedAppointments[]` lists them | "14 patients have booked this session. They'll be cancelled and notified. Confirm to continue." |
| `INVALID_STATUS_TRANSITION` | 409 | Already `cancelled` or `completed` | "This session has already ended." |

**Status Codes** — `200`, `401`, `403`, `404`, `409`, `422`.

---

### POST /api/v1/sessions/{id}/start

**Purpose** — Mark a session as started, recording the actual start time (EC-02, FR-APT-25).

**Authentication** — `Session + Role(MCS)`.

**Request Body**

```json
{ "version": 2 }
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `version` | integer | yes | VR-92 |

**Response Body** — the session object with `status: "started"` and `actuallyStartedAt` set to server time.

A late start shifts estimates for every waiting patient by the elapsed delay; patients whose estimate slips past the 30-minute threshold are notified (EC-02, FR-APT-24).

**Validation** — VR-92; current status is `scheduled`.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `INVALID_STATUS_TRANSITION` | 409 | Not `scheduled` | "This session has already been started." |

**Status Codes** — `200`, `401`, `403`, `404`, `409`, `422`.

---

### POST /api/v1/sessions/{id}/interrupt

**Purpose** — Mark a session `interrupted` when the doctor is called away mid-session, notifying all remaining patients (EC-04).

**Authentication** — `Session + Role(MCS)`.

**Request Body**

```json
{ "reason": "Doctor called to an emergency in the hostel block", "version": 3 }
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `reason` | string | yes | VR-93 |
| `version` | integer | yes | VR-92 |

**Response Body**

```json
{
  "sessionId": "0191f300-…",
  "status": "interrupted",
  "remainingPatients": 9,
  "notificationsQueued": 9,
  "version": 4
}
```

**Bookings are not auto-cancelled.** EC-04 requires staff to decide whether to resume, reassign or cancel. Resuming is `POST /sessions/{id}/start`; cancelling is `POST /sessions/{id}/cancel`. An automatic cancellation here would take that decision away from the people holding the room.

**Validation** — VR-93; VR-92; current status is `started`.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `INVALID_STATUS_TRANSITION` | 409 | Not `started` | "Only a session that's running can be marked interrupted." |

**Status Codes** — `200`, `401`, `403`, `404`, `409`, `422`.

---

### POST /api/v1/sessions/{id}/complete

**Purpose** — Close a session, recording the actual end time (FR-APT-25).

**Authentication** — `Session + Role(MCS)`.

**Request Body**

```json
{ "version": 4 }
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `version` | integer | yes | VR-92 |

**Response Body**

```json
{
  "sessionId": "0191f300-…",
  "status": "completed",
  "actuallyEndedAt": "2026-08-03T13:24:00+06:00",
  "expiredAppointments": 0,
  "version": 5
}
```

Any booking still `booked` at completion transitions to **`expired`, not `no_show`** — the patient was never called (BR-22, EC-13). Those students are notified with an apology and offered rebooking, and **no penalty is applied**. `no_show` remains a staff decision and is never automatic (FR-APT-32).

**Validation** — VR-92; current status is `started` or `interrupted`.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `INVALID_STATUS_TRANSITION` | 409 | Not `started` or `interrupted` | "This session hasn't been started." |
| `CONSULTATION_IN_PROGRESS` | 409 | An appointment is still `in_consultation` | "One patient is still in consultation. Complete that first." |

**Status Codes** — `200`, `401`, `403`, `404`, `409`, `422`.

---

### GET /api/v1/sessions/{id}/slots

**Purpose** — List a session's derived bookable slots with their claimed state, for the booking interface (FR-SCH-05, FR-APT-01).

**Authentication** — `Session`.

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `availableOnly` | boolean | no | Defaults to `false` |

**Response Body**

```json
{
  "sessionId": "0191f300-…",
  "slotLengthMinutes": 10,
  "bookingClosesAt": "2026-08-10T09:00:00+06:00",
  "items": [
    { "slotId": "0191f310-…", "slotIndex": 0, "slotStartsAt": "2026-08-10T09:00:00+06:00", "isAvailable": false },
    { "slotId": "0191f311-…", "slotIndex": 1, "slotStartsAt": "2026-08-10T09:10:00+06:00", "isAvailable": true }
  ],
  "summary": { "bookable": 17, "booked": 14, "remaining": 3 }
}
```

Only slots with `is_online_bookable = true` appear — the walk-in allocation is not offered online (BR-16, FR-SCH-05). `isAvailable` reflects the moment of the read; the authoritative check is at commit (VR-20, EC-01). **No slot carries any patient identity** (BR-04).

`bookingClosesAt` is the configured cutoff (FR-APT-11, default: session start).

**Validation** — none.

**Error Responses** — universal set only.

**Status Codes** — `200`, `401`, `404`.

---

## 3.4 Doctor unavailability — the two-step flow

FR-SCH-07 requires that, on submission of an unavailability affecting existing bookings, the system **present a list of every affected booking before committing** and require explicit confirmation. That is two HTTP calls, not one with a flag. A single-call design with `confirm: true` would let a client skip the presentation step entirely, which is the exact failure the requirement exists to prevent.

### GET /api/v1/doctors/{id}/unavailability

**Purpose** — List recorded unavailability periods for a doctor (FR-SCH-06).

**Authentication** — `Session + Role(MCS)`.

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `from` / `to` | date | no | Defaults to today through +90 days |

**Response Body**

```json
{
  "items": [
    {
      "unavailabilityId": "0191f3f0-…",
      "startDate": "2026-08-20",
      "endDate": "2026-08-24",
      "reason": "Annual leave approved by the medical director",
      "createdBy": "0191f0aa-…",
      "createdAt": "2026-08-01T11:02:00+06:00"
    }
  ]
}
```

**Validation** — `to` ≥ `from`.

**Error Responses** — universal set only.

**Status Codes** — `200`, `401`, `403`, `404`, `422`.

---

### POST /api/v1/doctors/{id}/unavailability/impact-preview

**Purpose** — **Step 1 of 2.** Return every booking that would be cancelled by a proposed unavailability period, without changing anything (FR-SCH-07, BR-26).

**Authentication** — `Session + Role(MCS)`.

**Request Body**

```json
{
  "startDate": "2026-08-20",
  "endDate": "2026-08-24",
  "reason": "Annual leave approved by the medical director"
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `startDate` | date | yes | VR-16 — the period may not be entirely in the past |
| `endDate` | date | yes | VR-16 — on or after `startDate` |
| `reason` | string | yes | VR-93 |

**Response Body**

```json
{
  "previewToken": "0191f3fa-7c00-7aaa-8000-1122334455aa",
  "expiresAt": "2026-08-01T11:17:00+06:00",
  "affectedSessions": 3,
  "affectedAppointments": [
    {
      "appointmentRef": "MED-2026-0081",
      "studentRef": "221-15-5678",
      "studentName": "Nusrat Jahan",
      "sessionDate": "2026-08-20",
      "serialNumber": 7,
      "paymentStatus": "paid",
      "requiresRefundFlag": true
    }
  ],
  "alternativeAvailability": [
    { "doctorName": "Dr. Chowdhury", "sessionDate": "2026-08-20", "remainingSlots": 6 }
  ]
}
```

| Field | Type | Notes |
|---|---|---|
| `previewToken` | uuid | Short-lived (15 minutes). Must be presented to the confirm endpoint below |
| `requiresRefundFlag` | boolean | True where a payment exists — flagged for manual refund; Phase 1 has no automated refund (EC-24) |
| `alternativeAvailability[]` | array | BR-27 requires each affected student to be offered remaining alternatives; they are computed here so the notification can carry them |

This endpoint writes **no** state change and no unavailability row. It does write `audit.data_access_log`, because it returns other students' identities to staff.

**Validation** — VR-16 date order and not entirely in the past; VR-93 reason.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `INVALID_DATE_RANGE` | 422 | VR-16 — `endDate` before `startDate`, or the whole period is in the past | "Choose a date range that ends on or after it starts, and isn't entirely in the past." |
| `UNAVAILABILITY_OVERLAP` | 409 | An existing period for this doctor overlaps | "This doctor already has leave recorded from 20 to 24 August." |

**Status Codes** — `200`, `401`, `403`, `404`, `409`, `422`.

---

### POST /api/v1/doctors/{id}/unavailability

**Purpose** — **Step 2 of 2.** Commit the unavailability, cancel every affected booking with reason `Doctor Unavailable`, and queue notifications for dispatch within 5 minutes (FR-SCH-06, FR-SCH-08, FR-SCH-09, BR-26, BR-27).

**Authentication** — `Session + Role(MCS)`. `Idempotency-Key` is **not** accepted — this is not a bufferable command, because it requires server-side impact analysis over all bookings (ARCHITECTURE §5.6).

**Request Body**

```json
{
  "previewToken": "0191f3fa-7c00-7aaa-8000-1122334455aa",
  "startDate": "2026-08-20",
  "endDate": "2026-08-24",
  "reason": "Annual leave approved by the medical director"
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `previewToken` | uuid | yes | Must be unexpired and match a preview whose dates equal those submitted here |
| `startDate` / `endDate` | date | yes | VR-16; must match the preview exactly |
| `reason` | string | yes | VR-93; must match the preview |

**Response Body**

```json
{
  "unavailabilityId": "0191f3f0-…",
  "startDate": "2026-08-20",
  "endDate": "2026-08-24",
  "cancelledAppointments": 27,
  "notificationsQueued": 27,
  "notificationDeadline": "2026-08-01T11:07:00+06:00",
  "paymentsFlaggedForRefund": 4
}
```

Emits `DoctorUnavailabilityConfirmed`, consumed by Queue (bulk cancel) and Notification (dispatch within 5 minutes).

**Validation** — VR-16; VR-93; `previewToken` valid, unexpired and matching the submitted dates and reason. **If the set of affected bookings has changed since the preview** — someone booked in the intervening minutes — the request is rejected and a fresh preview is required. Cancelling a booking the Administrator was never shown would defeat FR-SCH-07.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `PREVIEW_REQUIRED` | 409 | `previewToken` missing, expired, or its dates/reason don't match | "Review the affected bookings again before confirming — the details have changed." |
| `IMPACT_CHANGED` | 409 | Bookings were added or removed since the preview. `error.details.newAffectedCount` given | "Someone booked this session while you were reviewing. Check the updated list of 28 affected bookings and confirm again." |
| `UNAVAILABILITY_OVERLAP` | 409 | Overlapping period exists | "This doctor already has leave recorded for those dates." |
| `IDEMPOTENCY_NOT_SUPPORTED` | 422 | `Idempotency-Key` header present | "This action can't be retried automatically. Submit it again from the console." |

**Status Codes** — `201`, `401`, `403`, `404`, `409`, `422`.

---

### DELETE /api/v1/unavailability/{id}

**Purpose** — Remove a future unavailability period, e.g. leave cancelled (FR-SCH-06).

**Authentication** — `Session + Role(MCS)`.

**Request Body**

```json
{ "reason": "Leave withdrawn at the doctor's request" }
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `reason` | string | yes | VR-93 |

**Response Body** — none.

**Bookings cancelled under this unavailability are not restored.** They were cancelled, the students were notified, and some will have made other arrangements. Restoring them silently would be worse than leaving them cancelled; staff rebook manually or the students rebook themselves.

**Validation** — VR-93; the period has not started (`startDate` is in the future).

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `UNAVAILABILITY_ALREADY_STARTED` | 409 | The period has begun or passed | "This leave period has already started and can't be removed." |

**Status Codes** — `204`, `401`, `403`, `404`, `409`, `422`.

---
# Part 4 — Module APT
### Appointment & Queue Management

Covers FR-APT-01…42, VR-20…VR-32, BR-10…BR-22, EC-01…EC-20. Base path `/api/v1`.

This is the core domain. Four rules govern every endpoint in it:

1. **One queue per session.** Booked patients and walk-ins share a single ordered queue and a single gap-free serial sequence (FR-APT-19, BR-18, EC-09). There is no separate walk-in list and no second numbering.
2. **A time is an estimate, never a guarantee.** No response field, no notification and no message may present a booked time as confirmed. The wording conveys estimation (FR-APT-08, BR-19).
3. **No student ever sees another student.** Queue responses available to a Student or Anonymous caller carry positions and counts, never identities (BR-04, PRM-04).
4. **A booking suspension never blocks care.** It suspends *online booking* only. Walk-in registration succeeds regardless (FR-APT-13, FR-APT-38, BR-15).

Queue ordering is computed at read time as `ORDER BY is_emergency DESC, serial_number ASC`. Position is never stored — it changes on every event for every waiting row (DATABASE §4.3).

---

## 4.1 Browsing and booking

### GET /api/v1/availability

**Purpose** — The authenticated booking view: doctors, dates and available slots within the publication window, with booked and remaining counts per session (FR-APT-01, FR-APT-02, FR-SCH-12).

**Authentication** — `Session`.

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `from` | date | no | Defaults to today; not earlier than today |
| `to` | date | no | Defaults to the end of the publication window; clamped to it (VR-14, default 7 days) |
| `doctorId` | uuid | no | — |

**Response Body**

```json
{
  "publicationWindowDays": 7,
  "bookingBlocked": null,
  "days": [
    {
      "date": "2026-08-04",
      "isServiceDay": true,
      "closureReason": null,
      "sessions": [
        {
          "sessionId": "0191f300-…",
          "doctorId": "0191f200-…",
          "doctorName": "Dr. Rahman",
          "specialisation": "General Medicine",
          "startsAt": "2026-08-04T09:00:00+06:00",
          "endsAt": "2026-08-04T13:00:00+06:00",
          "bookableSlotCount": 17,
          "bookedSlotCount": 14,
          "remainingSlotCount": 3,
          "bookingClosesAt": "2026-08-04T09:00:00+06:00",
          "studentAlreadyBooked": false
        }
      ]
    }
  ]
}
```

| Field | Type | Notes |
|---|---|---|
| `bookingBlocked` | object \| null | Present when the caller is under an active suspension: `{ reason, suspendedUntil, walkInRemainsAvailable: true }`. Surfaced here so the interface can explain *before* the student picks a slot rather than after (FR-APT-14, BR-15) |
| `studentAlreadyBooked` | boolean | True where the caller already holds an active booking with that doctor on that date (BR-11, VR-22). Lets the interface disable the session rather than let the student hit a 409 |
| `remainingSlotCount` | integer | Count only. **No patient identity** (FR-APT-02, BR-04) |
| `closureReason` | string \| null | Non-service days are listed with their reason, not hidden (FR-SCH-11, BR-28) |

**Validation** — `from` not in the past; `to` ≥ `from`; range clamped to the publication window (VR-14).

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `INVALID_DATE_RANGE` | 422 | `from` in the past or `to` before `from` | "Choose a date from today onwards." |

**Status Codes** — `200`, `401`, `422`.

---

### POST /api/v1/appointments

**Purpose** — Book one available slot, allocating a human-readable Appointment ID and a serial number from the session's single sequence (FR-APT-03, FR-APT-04, FR-APT-05).

**Authentication** — `Session + Role(STU)`. Permission matrix: *Appointment (own) — STU: C R U(cancel) own*. A student books only for themselves; there is no proxy or delegated booking in Phase 1 (FR-AUTH-15, BR-02).

`Idempotency-Key` is **rejected**. Slot contention (EC-01) cannot be resolved offline — two offline clients could both claim the last slot (ARCHITECTURE §5.6).

**Request Body**

```json
{
  "sessionSlotId": "0191f311-…",
  "visitReasonCategoryId": "0191f0c1-…",
  "visitReasonNote": "Fever and sore throat since Monday"
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `sessionSlotId` | uuid | yes | VR-20 — must exist, be in the future, be within the publication window, and be unbooked **at the moment of commit** |
| `visitReasonCategoryId` | uuid \| null | no | VR-25 — must be an active category from `queueing.visit_reason_category` (FR-APT-06) |
| `visitReasonNote` | string ≤200 | no | VR-25 — maximum 200 characters |

**Response Body**

```json
{
  "appointmentId": "0191f4a1-…",
  "appointmentRef": "MED-2026-0081",
  "serialNumber": 15,
  "doctorName": "Dr. Rahman",
  "sessionDate": "2026-08-04",
  "slotStartsAt": "2026-08-04T09:10:00+06:00",
  "estimateAtBooking": "2026-08-04T09:10:00+06:00",
  "currentEstimate": "2026-08-04T09:10:00+06:00",
  "estimateDisclaimer": "This is an estimate of when you'll be seen, not a guaranteed appointment time. Your position may change if emergencies arrive.",
  "status": "booked",
  "paymentStatus": "unpaid",
  "consultationFee": 50.00,
  "paymentNote": "You can pay at the counter. Payment isn't needed to confirm this booking.",
  "version": 1
}
```

| Field | Type | Notes |
|---|---|---|
| `appointmentRef` | string | `MED-<YYYY>-<sequence>`, unique across the system (FR-APT-04) |
| `serialNumber` | integer | Allocated from `clinic_session.next_serial` under row lock — the single per-session sequence shared with walk-ins (FR-APT-05, EC-09, DATABASE D4) |
| `estimateAtBooking` | timestamptz | Frozen baseline for slip detection (BR-20, FR-APT-24) |
| `estimateDisclaimer` | string | **Mandatory in the response and in the confirmation notification.** FR-APT-07 requires an explicit statement that the time is an estimate; FR-APT-08 and BR-19 forbid any wording implying a guarantee anywhere |
| `paymentNote` | string | FR-PAY-04, BR-31 — booking is confirmed irrespective of payment status |

Emits `AppointmentBooked`, consumed by Notification (confirmation) and Availability (slot count refresh).

**Validation**

| Rule | Check |
|---|---|
| VR-20 | Slot exists, is in the future, is within the publication window, is `is_online_bookable`, and is unclaimed at commit |
| VR-21 | Caller's active bookings are below the configured maximum (BR-11, default 2 — OI-08) |
| VR-22 | Caller holds no other active booking with that doctor on that date (BR-11) |
| VR-23 | Caller is not under an active booking suspension (BR-15) |
| VR-24 | Server time is before the session's booking cutoff (BR-10, FR-APT-11) |
| VR-25 | Reason category is from the configured list; note ≤200 characters |
| BR-25 | The session is published; no appointment is creatable outside one (FR-SCH-13) |
| BR-28 | The date is a service day (FR-SCH-11) |

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `SLOT_TAKEN` | 409 | VR-20 / EC-01 — another student committed to this slot first. `error.details.availableSlots[]` carries a refreshed list | "That slot was just taken. Here are the times still available." |
| `BOOKING_LIMIT_REACHED` | 409 | VR-21 — at the maximum. `error.details.activeAppointments[]` lists them | "You already have 2 upcoming appointments. Cancel one before booking another." |
| `DUPLICATE_DOCTOR_DAY` | 409 | VR-22 | "You already have an appointment with Dr. Rahman on 4 August." |
| `BOOKING_SUSPENDED` | 409 | VR-23. `error.details` carries `suspendedUntil` | "Online booking is paused on your account until 18 August. You can still visit the medical centre as a walk-in and you'll be seen." |
| `BOOKING_CLOSED` | 409 | VR-24 — past the cutoff | "Booking for this session has closed. You can still come as a walk-in." |
| `NON_SERVICE_DAY` | 409 | BR-28 | "The medical centre is closed on 15 August: National Mourning Day." |
| `IDEMPOTENCY_NOT_SUPPORTED` | 422 | `Idempotency-Key` present | "This action can't be retried automatically. Choose a slot and book again." |

EC-01 is enforced by the partial unique index `uq_appointment_slot_active`: exactly one booking wins, the other receives `SLOT_TAKEN`, and **no partial booking is created**.

**Status Codes** — `201`, `401`, `403`, `409`, `422`, `503`.

---

### GET /api/v1/me/appointments

**Purpose** — The caller's own appointments, current and historical (FR-DASH-02, PRM-03).

**Authentication** — `Session + Own`. No `studentId` parameter exists.

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `scope` | enum | no | `upcoming` (default) \| `past` \| `all` |
| `limit` / `cursor` | — | no | §0.8 |

**Response Body**

```json
{
  "items": [
    {
      "appointmentId": "0191f4a1-…",
      "appointmentRef": "MED-2026-0081",
      "doctorName": "Dr. Rahman",
      "sessionDate": "2026-08-04",
      "serialNumber": 15,
      "status": "booked",
      "origin": "booked",
      "patientsAhead": 3,
      "currentEstimate": "2026-08-04T10:40:00+06:00",
      "estimateDisclaimer": "This is an estimate, not a guaranteed appointment time.",
      "paymentStatus": "unpaid",
      "visitReasonCategory": "Fever / Infection",
      "canCancel": true,
      "version": 2
    }
  ],
  "nextCursor": null
}
```

| Field | Type | Notes |
|---|---|---|
| `status` | enum | `booked` \| `checked_in` \| `waiting` \| `in_consultation` \| `completed` \| `cancelled` \| `late_cancellation` \| `no_show` \| `expired` (FR-APT-28) |
| `origin` | enum | `booked` \| `walk_in` |
| `canCancel` | boolean | False once `checked_in` — cancellation is then a staff conversation (EC-17, VR-26) |

Records belonging to a deactivated account are retained but inaccessible to that account (FR-AUTH-11, BR-06).

**Validation** — none.

**Error Responses** — universal set only.

**Status Codes** — `200`, `401`, `403`.

---

### GET /api/v1/appointments/{id}

**Purpose** — Retrieve one appointment in full.

**Authentication** — `Session + Own` for a student; `Session + Role(MCS)` for staff; `Session + Role(ADM)` returns **metadata only** (permission matrix: *Appointment (any) — ADM: R (metadata only)*); `Session + Role(DOC)` only for a session assigned to that doctor (PRM-07).

**Request Body** — none.

**Response Body**

```json
{
  "appointmentId": "0191f4a1-…",
  "appointmentRef": "MED-2026-0081",
  "sessionId": "0191f300-…",
  "doctorName": "Dr. Rahman",
  "sessionDate": "2026-08-04",
  "serialNumber": 15,
  "origin": "booked",
  "status": "booked",
  "isEmergency": false,
  "student": { "studentRef": "221-15-5678", "fullName": "Nusrat Jahan" },
  "visitReasonCategory": "Fever / Infection",
  "visitReasonNote": "Fever and sore throat since Monday",
  "patientsAhead": 3,
  "estimateAtBooking": "2026-08-04T09:10:00+06:00",
  "currentEstimate": "2026-08-04T10:40:00+06:00",
  "estimateDisclaimer": "This is an estimate, not a guaranteed appointment time.",
  "paymentStatus": "unpaid",
  "checkedInAt": null,
  "consultationStartedAt": null,
  "consultationCompletedAt": null,
  "enteredRetrospectively": false,
  "version": 2
}
```

**Shape varies by role:**

| Caller | `student` block | `visitReasonNote` | Timestamps |
|---|---|---|---|
| Owning student | own details | yes | yes |
| `MCS` | full | yes (matrix: *Reason-for-visit — MCS: R*) | yes |
| `DOC` (own session) | full | yes (matrix: *R own-session*) | yes |
| `ADM` | **omitted** | **omitted** | yes |

The `ADM` restriction is not decorative: PRM-09 requires that an administrator cannot build a picture of a student's service use. Metadata means reference, status, timing and session — not who or why.

Staff and doctor reads write `audit.data_access_log` (FR-AUD-03).

**Validation** — none.

**Error Responses** — universal set only. A student requesting another student's appointment receives `404`, not `403` — a 403 would confirm the appointment exists (§0.4, rule 2).

**Status Codes** — `200`, `401`, `403`, `404`.

---

### POST /api/v1/appointments/{id}/cancel

**Purpose** — Cancel an active booking and release its slot immediately for rebooking (FR-APT-15, FR-APT-16, FR-APT-17, BR-21).

**Authentication** — `Session + Own` (student, matrix *U(cancel) own*) or `Session + Role(MCS)`.

**Request Body**

```json
{ "reason": "Feeling better, no longer need the appointment", "version": 2 }
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `reason` | string | no | Optional for a student; **required (VR-93) when staff cancel on a student's behalf**, so the record shows who decided and why |
| `version` | integer | yes | VR-92 |

**Response Body**

```json
{
  "appointmentId": "0191f4a1-…",
  "status": "late_cancellation",
  "cancelledAt": "2026-08-04T09:35:00+06:00",
  "slotReleased": true,
  "penaltyApplied": false,
  "message": "Your appointment is cancelled. Cancelling never counts against you.",
  "version": 3
}
```

| Field | Type | Notes |
|---|---|---|
| `status` | enum | `cancelled` when 2 or more hours before the estimated time; `late_cancellation` when later (FR-APT-16, BR-12) |
| `slotReleased` | boolean | Always `true`. The slot becomes claimable immediately — the partial unique index drops the row from the active set with no cleanup step (BR-21) |
| `penaltyApplied` | boolean | **Always `false`.** The no-show penalty of FR-APT-12 is never applied to a cancellation of any kind (FR-APT-18, BR-12, BR-15) |

Emits `AppointmentCancelled`, consumed by Estimation (recalculate), Notification and Availability.

**Validation** — VR-26 — the appointment must be in `booked` or `checked_in` state; VR-92 version match. A student may cancel only before the estimated time (FR-APT-15).

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `CANNOT_CANCEL_CHECKED_IN` | 409 | EC-17 — the student is already checked in and calls this themselves | "You're already checked in. Please speak to the front desk — they'll sort it out for you." |
| `INVALID_STATUS_TRANSITION` | 409 | VR-26 — status is terminal | "This appointment has already been completed or cancelled." |
| `CONFLICT_STALE_VERSION` | 409 | VR-92 | See §0.6 |

**Status Codes** — `200`, `401`, `403`, `404`, `409`, `422`.

---

### GET /api/v1/appointments/{id}/queue-position

**Purpose** — The live position view for a student with an active booking or check-in: serial number, patients ahead, current estimate (FR-APT-20).

**Authentication** — `Session + Own`.

**Request Body** — none.

**Response Body**

```json
{
  "appointmentRef": "MED-2026-0081",
  "serialNumber": 15,
  "patientsAhead": 3,
  "nowServingSerial": 11,
  "currentEstimate": "2026-08-04T10:40:00+06:00",
  "estimateDisclaimer": "This is an estimate, not a guaranteed appointment time.",
  "sessionStatus": "started",
  "asOf": "2026-08-04T10:22:14+06:00",
  "pollAfterSeconds": 20
}
```

| Field | Type | Notes |
|---|---|---|
| `patientsAhead` | integer | The count ahead in the ordered queue, including any emergency inserted at the head (FR-APT-20, BR-17) |
| `nowServingSerial` | integer \| null | Aggregate; identifies nobody |
| `asOf` | timestamptz | Staleness bound is 30 seconds (NFR-PERF-05, FR-CI-02) |
| `pollAfterSeconds` | integer | Server-advised polling interval |

**No other patient's identity appears anywhere in this response** (BR-04, PRM-04).

**Validation** — none.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `NOT_IN_QUEUE` | 409 | The appointment is in a terminal state | "This appointment isn't in the queue any more." |

**Status Codes** — `200`, `401`, `403`, `404`, `409`.

---

### GET /api/v1/me/booking-suspension

**Purpose** — Let a student see their own suspension status, its end date, and the explicit statement that walk-in access remains (FR-APT-12, FR-APT-14, BR-15).

**Authentication** — `Session + Own`.

**Request Body** — none.

**Response Body**

```json
{
  "isSuspended": true,
  "suspendedFrom": "2026-08-04T11:00:00+06:00",
  "suspendedUntil": "2026-08-18T11:00:00+06:00",
  "noShowCount": 3,
  "reason": "3 missed appointments in the last 30 days",
  "walkInRemainsAvailable": true,
  "message": "Online booking is paused until 18 August. You can still come to the medical centre as a walk-in and you will be seen."
}
```

`walkInRemainsAvailable` is a constant `true` and `message` always states it. FR-APT-13 makes this absolute: a suspension must never prevent a student from being registered as a walk-in or receiving care.

**Validation** — none.

**Error Responses** — universal set only.

**Status Codes** — `200`, `401`, `403`.

---

### GET /api/v1/visit-reason-categories

**Purpose** — The configurable reason-for-visit list offered at booking (FR-APT-06, SI-15).

**Authentication** — `Session`.

**Request Body** — none.

**Response Body**

```json
{
  "items": [
    { "id": "0191f0c1-…", "code": "FEVER_INFECTION", "label": "Fever / Infection", "sortOrder": 10 }
  ]
}
```

Active categories only, in `sortOrder`.

**Validation** — none.

**Error Responses** — universal set only.

**Status Codes** — `200`, `401`.

---

## 4.2 Staff queue console

### GET /api/v1/queue/console

**Purpose** — The single-screen console: every session for a date across all doctors, each with its ordered live queue (FR-APT-26).

**Authentication** — `Session + Role(MCS)`.

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `date` | date | no | Defaults to today |
| `doctorId` | uuid | no | — |

**Response Body**

```json
{
  "date": "2026-08-04",
  "sessions": [
    {
      "sessionId": "0191f300-…",
      "doctorName": "Dr. Rahman",
      "status": "started",
      "startsAt": "2026-08-04T09:00:00+06:00",
      "endsAt": "2026-08-04T13:00:00+06:00",
      "nowServingSerial": 11,
      "walkInAllocationExceeded": true,
      "counts": { "waiting": 9, "completed": 5, "noShow": 1, "cancelled": 2, "expired": 0 },
      "queue": [
        {
          "appointmentId": "0191f4b0-…",
          "appointmentRef": "MED-2026-0090",
          "serialNumber": 22,
          "position": 1,
          "isEmergency": true,
          "emergencyReason": "Severe chest pain on arrival",
          "origin": "walk_in",
          "status": "waiting",
          "studentRef": "221-15-1122",
          "studentName": "Rakib Hasan",
          "unregisteredName": null,
          "visitReasonCategory": "Chest pain",
          "paymentStatus": "unpaid",
          "currentEstimate": "2026-08-04T10:25:00+06:00",
          "exceededWalkinAllocation": true,
          "enteredRetrospectively": false,
          "permittedTransitions": ["in_consultation", "no_show"],
          "version": 1
        }
      ]
    }
  ],
  "asOf": "2026-08-04T10:22:14+06:00"
}
```

| Field | Type | Notes |
|---|---|---|
| `queue[]` | array | Ordered `is_emergency DESC, serial_number ASC`. Booked and walk-in entries are interleaved in one list — there is no second list (FR-APT-19, BR-18) |
| `position` | integer | Computed at read time, 1-based |
| `permittedTransitions` | string[] | The states this entry may legally move to (VR-28). Supplied so the console can render one control per transition and so an invalid transition is not offered (FR-APT-29) |
| `walkInAllocationExceeded` | boolean | Surfaced per FR-APT-42 / EC-10 — care is never refused, but the console shows the allocation was exceeded |
| `exceededWalkinAllocation` | boolean | Per-entry marker for the walk-in that crossed the line |

Writes `audit.data_access_log` — this returns many students' identities to a staff member (FR-AUD-03).

**Validation** — none.

**Error Responses** — universal set only.

**Status Codes** — `200`, `401`, `403`.

---

### GET /api/v1/sessions/{id}/queue

**Purpose** — The ordered live queue for one session (FR-APT-19, FR-APT-26).

**Authentication** — `Session + Role(MCS)` for the full shape; `Session + Role(DOC)` for that doctor's own session only (PRM-07); `Session + Role(ADM)` for counts only.

**Request Body** — none.

**Response Body** — the `sessions[0]` object of `GET /api/v1/queue/console`.

For `ADM` the `queue[]` array is omitted entirely and only `counts` and `nowServingSerial` are returned (matrix: *Live queue — ADM: R*, combined with PRM-09).

**Validation** — none.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `NOT_FOUND` | 404 | A `DOC` caller requesting a session that is not theirs. **404, not 403** — the doctor should not learn which other sessions exist (PRM-07, §0.4 rule 2) | "That session couldn't be found." |

**Status Codes** — `200`, `401`, `403`, `404`.

---

### GET /api/v1/doctors/me/sessions

**Purpose** — A doctor's own sessions and their queues (PRM-07, matrix *Appointment (any) — DOC: R own-session*).

**Authentication** — `Session + Role(DOC)`.

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `date` | date | no | Defaults to today |

**Response Body** — as `GET /api/v1/queue/console`, scoped to sessions where the caller's linked `doctor.user_account_id` matches.

Scoping is server-side and unconditional. There is no parameter that widens it — PRM-07 grants read access **only** to the queue of sessions assigned to that doctor, and to no counseling data of any kind.

No Phase 1 function depends on a doctor logging in (CON-02); this endpoint exists so that one who does sees their own list and nothing more.

**Validation** — none.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `NO_DOCTOR_PROFILE` | 403 | The `DOC` account is not linked to a `scheduling.doctor` row | "This account isn't linked to a doctor profile. Contact the medical centre." |

**Status Codes** — `200`, `401`, `403`.

---

## 4.3 Queue transitions

Each transition is its own endpoint. One endpoint per command handler (ARCHITECTURE §5.3) means each carries its own permission entry, its own validation set and its own error list — and the console renders one control per transition, satisfying FR-APT-29's single-interaction requirement.

The lifecycle is `booked` → `checked_in` → `waiting` → `in_consultation` → `completed`, with terminal exception states `cancelled`, `late_cancellation`, `no_show`, `expired` (FR-APT-28). Transitions to non-adjacent states are rejected, except staff reversal (VR-28, FR-APT-34).

### POST /api/v1/appointments/{id}/check-in

**Purpose** — Check in an arriving booked student, `booked` → `checked_in` (FR-APT-27).

**Authentication** — `Session + Role(MCS)`. `Idempotency-Key` accepted (bufferable, ARCHITECTURE §5.6).

**Request Body**

```json
{ "version": 2 }
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `version` | integer | yes | VR-92 |
| `clientTimestamp` | timestamptz | no | Advisory only, for retrospective entry after an offline period. Never used for a time-sensitive decision (EC-54) |

**Response Body**

```json
{
  "appointmentId": "0191f4a1-…",
  "status": "checked_in",
  "checkedInAt": "2026-08-04T09:52:00+06:00",
  "serialNumber": 15,
  "position": 4,
  "permittedTransitions": ["waiting"],
  "enteredRetrospectively": false,
  "version": 3
}
```

**Validation** — VR-27 — the appointment must be `booked`, on the current date, and its session must not have ended; VR-92 version match.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `INVALID_STATUS_TRANSITION` | 409 | VR-27 / VR-28 — not in `booked`. `error.details.permittedTransitions` given | "This patient is already checked in." |
| `SESSION_ENDED` | 409 | VR-27 — the session has ended | "That session has ended. Register this patient as a walk-in instead." |
| `WRONG_DATE` | 409 | VR-27 — the appointment is not for today | "This appointment is for 6 August, not today." |
| `CONFLICT_STALE_VERSION` | 409 | VR-92 / EC-19 — another staff member acted first | "Someone else just updated this patient. Here's the current state." |

**Status Codes** — `200`, `401`, `403`, `404`, `409`, `422`.

---

### POST /api/v1/appointments/{id}/advance

**Purpose** — Advance a queue entry one step along the lifecycle (FR-APT-28, FR-APT-29). One interaction per transition.

**Authentication** — `Session + Role(MCS)`. `Idempotency-Key` accepted.

**Request Body**

```json
{
  "toStatus": "in_consultation",
  "paymentOverrideReason": null,
  "version": 3
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `toStatus` | enum | yes | VR-28 — must be the adjacent permitted state: `waiting`, `in_consultation` or `completed` |
| `paymentOverrideReason` | string \| null | conditional | **Required when `toStatus` is `in_consultation` and `paymentStatus` is `unpaid`** (FR-PAY-05, EC-21). VR-93 applies — ≥10 characters |
| `version` | integer | yes | VR-92 |

**Response Body**

```json
{
  "appointmentId": "0191f4a1-…",
  "status": "in_consultation",
  "consultationStartedAt": "2026-08-04T10:31:00+06:00",
  "paymentOverrideRecorded": false,
  "permittedTransitions": ["completed"],
  "estimatesRecalculated": true,
  "version": 4
}
```

Transitioning to `in_consultation` emits `ConsultationStarted` and begins actual-duration measurement. Transitioning to `completed` sets `consultation_completed_at`, emits `ConsultationCompleted`, feeds the rolling mean and advances the queue — recalculating the estimate for every waiting patient in the session (FR-APT-21, FR-APT-25).

A recorded payment override appears on the daily collection summary as an outstanding item (EC-21).

**Validation** — VR-28 lifecycle adjacency; VR-92; FR-PAY-05 payment gate with VR-93 override reason; the session must be `started` or `interrupted`.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `INVALID_STATUS_TRANSITION` | 409 | VR-28 — `toStatus` is not adjacent. `error.details.permittedTransitions` names what is allowed | "This patient is waiting. The next step is to start the consultation." |
| `PAYMENT_REQUIRED` | 409 | FR-PAY-05 — `unpaid` and no override reason given | "This patient hasn't paid the consultation fee. Record the payment, or give a reason to continue anyway." |
| `SESSION_NOT_STARTED` | 409 | The session is still `scheduled` | "Start the session before moving patients through the queue." |
| `CONFLICT_STALE_VERSION` | 409 | VR-92 / EC-19 | "Someone else just updated this patient. Here's the current state." |

**Status Codes** — `200`, `401`, `403`, `404`, `409`, `422`.

---

### POST /api/v1/appointments/{id}/no-show

**Purpose** — Mark a called patient No-show, after the configured grace period (FR-APT-31).

**Authentication** — `Session + Role(MCS)`. `Idempotency-Key` accepted.

**Purpose note.** The system **never** marks a patient No-show automatically. It is a staff decision, always (FR-APT-32, BR-14).

**Request Body**

```json
{ "reason": "Called three times over 20 minutes, no response", "version": 3 }
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `reason` | string | no | Recommended; VR-93 applies when given |
| `version` | integer | yes | VR-92 |

**Response Body**

```json
{
  "appointmentId": "0191f4a1-…",
  "status": "no_show",
  "noShowMarkedAt": "2026-08-04T10:31:00+06:00",
  "noShowMarkedBy": "0191f0aa-…",
  "rollingNoShowCount": 3,
  "suspensionApplied": {
    "suspendedUntil": "2026-08-18T10:31:00+06:00",
    "walkInRemainsAvailable": true
  },
  "estimatesRecalculated": true,
  "version": 4
}
```

Emits `PatientMarkedNoShow`, consumed by Estimation (recalculate) and Suspension (evaluate BR-15). On the 3rd no-show within a rolling 30-day window a 14-day online-booking suspension is applied and the student is notified, stating the reason, the duration, and that walk-in access remains (FR-APT-12, FR-APT-14, BR-15).

`suspensionApplied` is `null` when the threshold was not reached.

**Validation** — VR-31 — permitted only after the configured grace period (default 20 minutes, OI-10) has elapsed since the patient was called; VR-28 the entry must be `waiting` or `checked_in`; VR-92.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `GRACE_PERIOD_NOT_ELAPSED` | 409 | VR-31. `error.details.remainingSeconds` given | "This patient was called 6 minutes ago. You can mark them as a no-show in 14 minutes." |
| `INVALID_STATUS_TRANSITION` | 409 | VR-28 — not `waiting` or `checked_in` | "Only a waiting patient can be marked as a no-show." |
| `CONFLICT_STALE_VERSION` | 409 | VR-92 | See §0.6 |

A skipped patient retains their serial and is re-called once; No-show may be marked only after the grace period (EC-07). A student who arrives after being marked No-show is registered as a walk-in — the No-show record stands, but staff may record a reversal reason (EC-08, and `POST …/reverse` below).

**Status Codes** — `200`, `401`, `403`, `404`, `409`, `422`.

---

### POST /api/v1/appointments/{id}/reverse

**Purpose** — Reverse an incorrect status transition within the same session, recording the reversal and its reason in the audit trail (FR-APT-34, EC-16, VR-32).

**Authentication** — `Session + Role(MCS)`. `Idempotency-Key` **not** accepted — a reversal is a deliberate corrective act and must not replay.

**Request Body**

```json
{
  "toStatus": "waiting",
  "reason": "Marked no-show by mistake; the patient was in the corridor",
  "version": 4
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `toStatus` | enum | yes | The state being reverted to. Must be a state this entry previously held in this session |
| `reason` | string | yes | VR-32, VR-93 — mandatory, ≥10 characters |
| `version` | integer | yes | VR-92 |

**Response Body**

```json
{
  "appointmentId": "0191f4a1-…",
  "status": "waiting",
  "reversedFrom": "no_show",
  "reversalReason": "Marked no-show by mistake; the patient was in the corridor",
  "suspensionRecalculated": true,
  "version": 5
}
```

Reversing a No-show re-evaluates the rolling 30-day count; a suspension applied solely because of the reversed record is lifted, and `identity.booking_suspension.lifted_at` / `lift_reason` are set.

**Validation** — VR-32 — permitted only within the same session and only by the staff role, reason mandatory; VR-92; the session must not be `completed`; `toStatus` must be a state this entry actually held.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `SESSION_ALREADY_ENDED` | 409 | VR-32 — the session is `completed` | "That session has ended. A correction now needs an administrator." |
| `INVALID_REVERSAL_TARGET` | 409 | `toStatus` is a state this entry never held | "This patient was never in that state." |
| `VALIDATION_FAILED` | 422 | VR-93 — reason missing or under 10 characters | "Give a reason of at least 10 characters for the correction." |

**Status Codes** — `200`, `401`, `403`, `404`, `409`, `422`.

---

### POST /api/v1/appointments/{id}/emergency

**Purpose** — Mark a queue entry as an Emergency, placing it at the head of the queue ahead of all waiting patients (FR-APT-39, BR-17).

**Authentication** — `Session + Role(MCS)`. Matrix: *Emergency designation — MCS: C*, every other role `—`.

**Request Body**

```json
{ "reason": "Severe chest pain and shortness of breath on arrival", "version": 1 }
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `reason` | string | yes | VR-30, VR-93 — mandatory, ≥10 characters. Recorded in the audit trail (FR-APT-41) |
| `version` | integer | yes | VR-92 |

**Response Body**

```json
{
  "appointmentId": "0191f4b0-…",
  "isEmergency": true,
  "position": 1,
  "serialNumber": 22,
  "patientsNotified": 9,
  "notificationSuppressed": false,
  "estimatesRecalculated": true,
  "version": 2
}
```

Emits `EmergencyInserted`. Every waiting patient in that session is notified that an emergency case has been prioritised and their estimate has changed, stating the revised estimate (FR-APT-40, BR-17).

| Field | Type | Notes |
|---|---|---|
| `patientsNotified` | integer | 0 when the queue was empty — no delay notifications are sent because nobody is affected (EC-11) |
| `notificationSuppressed` | boolean | True when flood control applied: waiting students receive at most one delay notification per 15-minute window when emergencies arrive consecutively (EC-12). The estimate still updates; only the message is suppressed |

The serial number is **not** changed. The entry keeps its place in the sequence and moves only in ordering — `is_emergency DESC` sorts it to the head. Renumbering would break the gap-free per-session sequence (EC-09).

**Validation** — VR-30 reason ≥10 characters; VR-92; the entry must be in a non-terminal state.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `ALREADY_EMERGENCY` | 409 | Already flagged | "This patient is already marked as an emergency." |
| `INVALID_STATUS_TRANSITION` | 409 | Entry is in a terminal state | "This patient has already been seen or has left the queue." |
| `VALIDATION_FAILED` | 422 | VR-30 | "Give a reason of at least 10 characters for the emergency." |

**Status Codes** — `200`, `401`, `403`, `404`, `409`, `422`.

---

## 4.4 Walk-in registration

### POST /api/v1/walk-ins

**Purpose** — Register a walk-in patient into a session's live queue, by student identifier and optional reason (FR-APT-35).

**Authentication** — `Session + Role(MCS)`. Matrix: *Walk-in registration — MCS: C*, every other role `—`. `Idempotency-Key` accepted (bufferable).

**Request Body**

```json
{
  "clinicSessionId": "0191f300-…",
  "studentRef": "221-15-1122",
  "unregisteredName": null,
  "visitReasonCategoryId": "0191f0c5-…",
  "isEmergency": false,
  "emergencyReason": null
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `clinicSessionId` | uuid | yes | Must be a session on the current date that has not ended |
| `studentRef` | string | conditional | VR-29 — must resolve to an existing student account |
| `unregisteredName` | string | conditional | VR-29 — mandatory alternative when `studentRef` does not resolve |
| `visitReasonCategoryId` | uuid \| null | no | VR-25 |
| `isEmergency` | boolean | no | Defaults `false` |
| `emergencyReason` | string | conditional | VR-30 — required when `isEmergency` is `true` |

**Three mandatory fields at most.** FR-APT-36 and CON-01 cap walk-in registration at three mandatory fields in a single form: session, patient identity (`studentRef` *or* `unregisteredName`), and — only when applicable — the emergency reason. Everything else is optional.

**Response Body**

```json
{
  "appointmentId": "0191f4b0-…",
  "appointmentRef": "MED-2026-0090",
  "serialNumber": 22,
  "origin": "walk_in",
  "status": "waiting",
  "position": 6,
  "currentEstimate": "2026-08-04T11:15:00+06:00",
  "estimateDisclaimer": "This is an estimate, not a guaranteed time.",
  "exceededWalkinAllocation": true,
  "allocationNote": "The walk-in allocation for this session is full. This patient has been added anyway and the console shows the allocation was exceeded.",
  "suspensionIgnored": true,
  "enteredRetrospectively": false,
  "version": 1
}
```

| Field | Type | Notes |
|---|---|---|
| `serialNumber` | integer | Continues the session's single sequence (FR-APT-37, EC-09). Walk-ins and booked patients draw from the same counter |
| `position` | integer | End of the current queue, unless `isEmergency` (FR-APT-37) |
| `exceededWalkinAllocation` | boolean | FR-APT-42 / EC-10 — registration **succeeds** when the allocation is exhausted; the system records that it was exceeded and surfaces it on the console. **Care is never refused** |
| `suspensionIgnored` | boolean | `true` when the student is under an active booking suspension. Registration proceeds regardless (FR-APT-38, FR-APT-13, BR-15). This field exists to make the guarantee visible and testable |

Emits `WalkInInserted`, consumed by Estimation and Availability.

**Validation** — VR-29 — `studentRef` resolves, or `unregisteredName` is supplied; VR-25 category; VR-30 emergency reason when flagged; the session exists, is on the current date and has not ended.

Note what is **not** validated here: booking suspension, booking limits, same-doctor-same-day, and the booking cutoff. None of them apply to a walk-in. A student at the counter is a patient, not a booking request.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `STUDENT_NOT_FOUND` | 422 | VR-29 — `studentRef` does not resolve and no `unregisteredName` given. `error.details.suggestion: "record_as_unregistered"` | "That student ID isn't recognised. Check it, or record the patient by name as an unregistered walk-in." |
| `SESSION_ENDED` | 409 | The session has ended or is `cancelled` | "That session has ended. Choose a session that's still running." |
| `SESSION_NOT_TODAY` | 409 | The session is not on the current date | "You can only add a walk-in to today's sessions." |
| `VALIDATION_FAILED` | 422 | VR-30 — `isEmergency` without a reason | "Give a reason of at least 10 characters for the emergency." |

**Status Codes** — `201`, `401`, `403`, `404`, `409`, `422`.

---
# Part 5 — Module PAY
### Consultation Fee Management

Covers FR-PAY-01…11, VR-40…VR-44, BR-30…BR-34, EC-21…EC-25. Base path `/api/v1`.

**Module-wide rules.**

1. **The ledger is immutable.** There is no `PUT`, `PATCH` or `DELETE` on any payment resource anywhere in this API. A recorded payment is never overwritten or deleted; corrections are new adjusting entries referencing the original (FR-PAY-10, BR-34, BR-61, EC-23).
2. **Payment is never a precondition of booking.** A booking is confirmed irrespective of payment status (FR-PAY-04, BR-31).
3. **No online payment instrument is accepted, processed or stored in Phase 1** (FR-PAY-11). Every endpoint here records a counter transaction that happened in cash, in person.
4. `appointment.payment_status` is a cached projection of this ledger, maintained by trigger. **The ledger is authoritative** (DATABASE D3).

---

### GET /api/v1/fee-waiver-reasons

**Purpose** — The configurable waiver reason list required at the point of waiving a fee (VR-42, FR-PAY-06).

**Authentication** — `Session + Role(MCS)`.

**Request Body** — none.

**Response Body**

```json
{
  "items": [
    { "id": "0191f0d1-…", "code": "FOLLOW_UP_7D", "label": "Follow-up within 7 days", "isActive": true },
    { "id": "0191f0d2-…", "code": "FINANCIAL_HARDSHIP", "label": "Financial hardship", "isActive": true }
  ]
}
```

Active reasons only. `FOLLOW_UP_7D` is the code applied automatically by FR-PAY-07.

**Validation** — none.

**Error Responses** — universal set only.

**Status Codes** — `200`, `401`, `403`.

---

### GET /api/v1/appointments/{id}/payments

**Purpose** — The full payment history for one appointment: counter payments, waivers and adjusting entries, in order (FR-PAY-02, FR-PAY-10).

**Authentication** — `Session + Role(MCS)`, `Session + Role(ADM)` (matrix: *Payment record — ADM: R*), or `Session + Own` for the student whose appointment it is (matrix: *STU: R own*).

**Request Body** — none.

**Response Body**

```json
{
  "appointmentId": "0191f4a1-…",
  "appointmentRef": "MED-2026-0081",
  "paymentStatus": "paid",
  "configuredFee": 50.00,
  "netAmount": 50.00,
  "entries": [
    {
      "paymentId": "0191f600-…",
      "kind": "counter_payment",
      "amount": 50.00,
      "receiptNumber": "R-2026-0455",
      "waiverReason": null,
      "adjustsPaymentId": null,
      "adjustmentReason": null,
      "recordedOn": "2026-08-04",
      "recordedBy": { "userId": "0191f0aa-…", "fullName": "Farhana Akter" },
      "recordedAt": "2026-08-04T09:55:00+06:00"
    }
  ],
  "requiresRefundFlag": false
}
```

| Field | Type | Notes |
|---|---|---|
| `paymentStatus` | enum | `unpaid` \| `paid` \| `waived` — the cached projection on the appointment (D3) |
| `netAmount` | number | Sum of the ledger entries, including adjustments. Where this disagrees with `paymentStatus`, the ledger is right |
| `kind` | enum | `counter_payment` \| `waiver` \| `adjustment` |
| `requiresRefundFlag` | boolean | True where the appointment was cancelled after payment. Phase 1 has **no automated refund**; the item appears on the collection summary for manual handling (EC-24) |

A student sees their own entries. `recordedBy` is reduced to a role label for a student caller — who took the cash is an internal accountability record, not the student's business.

**Validation** — none.

**Error Responses** — universal set only.

**Status Codes** — `200`, `401`, `403`, `404`.

---

### POST /api/v1/appointments/{id}/payments

**Purpose** — Record a counter payment against an appointment, capturing amount and receipt number, and setting payment status to `paid` (FR-PAY-03).

**Authentication** — `Session + Role(MCS)`. Matrix: *Payment record — MCS: C R U*.

`Idempotency-Key` is **rejected**. Financial integrity and receipt uniqueness (VR-41) must be checked server-side against live state; an offline replay could double-record a cash transaction (ARCHITECTURE §5.6).

**Request Body**

```json
{
  "amount": 50.00,
  "receiptNumber": "R-2026-0455",
  "overrideReason": null
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `amount` | number | yes | VR-40 — non-negative, at most 2 decimal places, and **must equal the configured fee** unless `overrideReason` is given |
| `receiptNumber` | string | yes | VR-41 — mandatory for a counter payment; unique within the location and the date |
| `overrideReason` | string \| null | conditional | VR-40, VR-93 — required when `amount` differs from the configured fee |

**Response Body**

```json
{
  "paymentId": "0191f600-…",
  "appointmentId": "0191f4a1-…",
  "kind": "counter_payment",
  "amount": 50.00,
  "receiptNumber": "R-2026-0455",
  "paymentStatus": "paid",
  "recordedOn": "2026-08-04",
  "recordedAt": "2026-08-04T09:55:00+06:00",
  "immutable": true
}
```

`immutable: true` is a literal statement of contract: this row will never be updated or deleted by any endpoint in this API (FR-PAY-10).

**Validation** — VR-40 amount non-negative, ≤2 decimals, equals the configured fee or carries an override reason; VR-41 receipt number present and unique per location per day; VR-44 the appointment must not be cancelled.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `RECEIPT_ALREADY_USED` | 409 | VR-41 — duplicate for this location and date | "Receipt number R-2026-0455 has already been used today. Check the receipt book." |
| `PAYMENT_ON_CANCELLED_APPOINTMENT` | 409 | VR-44 | "This appointment was cancelled, so a payment can't be recorded against it." |
| `ALREADY_SETTLED` | 409 | Status is already `paid` or `waived`. `error.details.existingEntries[]` given | "This appointment is already marked as paid. To correct it, record an adjustment against the original payment." |
| `VALIDATION_FAILED` | 422 | VR-40 — amount differs from the fee with no reason | "The consultation fee is 50.00 BDT. Give a reason if you're recording a different amount." |
| `IDEMPOTENCY_NOT_SUPPORTED` | 422 | `Idempotency-Key` present | "Payments can't be retried automatically. Record it again from the counter." |

**Status Codes** — `201`, `401`, `403`, `404`, `409`, `422`.

---

### POST /api/v1/appointments/{id}/payments/waiver

**Purpose** — Set payment status to `waived`, requiring a waiver reason from the configured list and recording the authorising user (FR-PAY-06, BR-33).

**Authentication** — `Session + Role(MCS)`.

**Request Body**

```json
{
  "waiverReasonId": "0191f0d2-…",
  "note": "Student presented a hardship letter from the registrar"
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `waiverReasonId` | uuid | yes | VR-42 — must be an active reason from `billing.fee_waiver_reason` |
| `note` | string ≤500 | no | Free text detail |

**Response Body**

```json
{
  "paymentId": "0191f601-…",
  "kind": "waiver",
  "amount": 0.00,
  "waiverReason": { "code": "FINANCIAL_HARDSHIP", "label": "Financial hardship" },
  "authorisedBy": { "userId": "0191f0aa-…", "fullName": "Farhana Akter" },
  "paymentStatus": "waived",
  "wasAutomatic": false,
  "recordedAt": "2026-08-04T09:56:00+06:00",
  "immutable": true
}
```

| Field | Type | Notes |
|---|---|---|
| `authorisedBy` | object | BR-33 requires the authorising user to be recorded, not merely the acting one |
| `wasAutomatic` | boolean | `true` for the FR-PAY-07 follow-up exemption, applied by the system when the student has a `completed` appointment with the same reason-for-visit category within the preceding 7 days (OI-16). Staff may override an automatic waiver and record a payment with a reason (EC-25) |

**Validation** — VR-42 reason from the configured list; VR-44 appointment not cancelled; status not already `paid` (use an adjustment instead).

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `WAIVER_REASON_INVALID` | 422 | VR-42 — unknown or inactive reason | "Choose a waiver reason from the list." |
| `PAYMENT_ON_CANCELLED_APPOINTMENT` | 409 | VR-44 | "This appointment was cancelled, so a waiver can't be recorded against it." |
| `ALREADY_PAID` | 409 | Already `paid` | "This appointment is already paid. Record an adjustment against the payment instead." |

**Status Codes** — `201`, `401`, `403`, `404`, `409`, `422`.

---

### POST /api/v1/payments/{id}/adjustments

**Purpose** — Record an adjusting entry against an existing payment. **This is the only correction mechanism in the module** (FR-PAY-10, BR-34, BR-61, EC-23).

**Authentication** — `Session + Role(MCS)`.

**Request Body**

```json
{
  "amount": -50.00,
  "reason": "Recorded against the wrong appointment; corrected to MED-2026-0084"
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `amount` | number | yes | VR-40 — at most 2 decimal places. Signed: negative reverses, positive tops up. Non-zero |
| `reason` | string | yes | VR-93 — mandatory, ≥10 characters (`ck_payment_adjustment`) |

**Response Body**

```json
{
  "paymentId": "0191f602-…",
  "kind": "adjustment",
  "adjustsPaymentId": "0191f600-…",
  "amount": -50.00,
  "adjustmentReason": "Recorded against the wrong appointment; corrected to MED-2026-0084",
  "resultingPaymentStatus": "unpaid",
  "resultingNetAmount": 0.00,
  "originalPaymentUnchanged": true,
  "recordedAt": "2026-08-04T14:12:00+06:00"
}
```

`originalPaymentUnchanged: true` is the contract of FR-PAY-10 stated in the response: the original row is untouched, and the correction exists alongside it. Both appear on the daily collection summary.

**Validation** — VR-40 amount non-zero, ≤2 decimals; VR-93 reason ≥10 characters; the target payment exists and is of kind `counter_payment` or `waiver` — an adjustment cannot adjust an adjustment, because a chain of corrections referencing corrections is unreadable at reconciliation time. Correct the original.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `CANNOT_ADJUST_ADJUSTMENT` | 409 | Target is itself an adjustment | "Record the correction against the original payment, not against another correction." |
| `VALIDATION_FAILED` | 422 | VR-93 reason, or zero amount | "Give a reason of at least 10 characters for the correction." |

**Status Codes** — `201`, `401`, `403`, `404`, `409`, `422`.

---

### GET /api/v1/me/payments

**Purpose** — A student's own payment history across appointments (matrix: *Payment record — STU: R own*).

**Authentication** — `Session + Own`.

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `from` / `to` | date | no | Defaults to the last 12 months |
| `limit` / `cursor` | — | no | §0.8 |

**Response Body**

```json
{
  "items": [
    {
      "appointmentRef": "MED-2026-0081",
      "sessionDate": "2026-08-04",
      "doctorName": "Dr. Rahman",
      "paymentStatus": "paid",
      "netAmount": 50.00,
      "receiptNumber": "R-2026-0455",
      "recordedAt": "2026-08-04T09:55:00+06:00"
    }
  ],
  "nextCursor": null
}
```

Own records only, scoped server-side. There is no parameter that widens the scope (PRM-03).

**Validation** — `to` ≥ `from`.

**Error Responses** — universal set only.

**Status Codes** — `200`, `401`, `403`, `422`.

---

### GET /api/v1/reports/daily-collection

**Purpose** — The daily collection summary: every payment recorded on a date, with total, count and breakdown by staff member (FR-PAY-08, BR-34).

**Authentication** — `Session + Role(MCS)` or `Session + Role(ADM)`. Matrix: *Daily collection summary — MCS: R, ADM: R*.

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `date` | date | no | Defaults to today |
| `locationId` | uuid | no | Defaults to the single Phase 1 location |

**Response Body**

```json
{
  "businessDate": "2026-08-04",
  "systemTotal": 1850.00,
  "paymentCount": 37,
  "byStaff": [
    { "userId": "0191f0aa-…", "fullName": "Farhana Akter", "count": 21, "total": 1050.00 }
  ],
  "byKind": {
    "counterPayment": { "count": 37, "total": 1900.00 },
    "waiver": { "count": 4, "total": 0.00 },
    "adjustment": { "count": 1, "total": -50.00 }
  },
  "outstandingItems": [
    {
      "type": "unpaid_consultation_override",
      "appointmentRef": "MED-2026-0079",
      "reason": "Student had no cash; asked to pay after the consultation",
      "recordedBy": "Farhana Akter"
    },
    {
      "type": "refund_required",
      "appointmentRef": "MED-2026-0066",
      "amount": 50.00,
      "note": "Appointment cancelled after payment — manual refund required"
    }
  ],
  "reconciliation": null
}
```

| Field | Type | Notes |
|---|---|---|
| `systemTotal` | number | Net of adjustments. This is the figure reconciliation compares against |
| `outstandingItems[]` | array | Two kinds, both required to surface here: `unpaid_consultation_override` from FR-PAY-05 / EC-21, and `refund_required` from EC-24. Phase 1 has no automated refund; the summary is where a human picks it up |
| `reconciliation` | object \| null | The recorded reconciliation entry for the date, when one exists |

**Validation** — `date` not in the future.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `FUTURE_DATE` | 422 | `date` is after today | "Choose today's date or earlier." |

**Status Codes** — `200`, `401`, `403`, `422`.

---

### POST /api/v1/reports/daily-collection/{date}/reconciliation

**Purpose** — Record a cash count against the day's system total, capturing any discrepancy with a reason (FR-PAY-09, BR-34).

**Authentication** — `Session + Role(MCS)`.

**Request Body**

```json
{
  "countedCash": 1830.00,
  "discrepancyReason": "Two 10-taka notes missing from the drawer at close; recount gave the same figure"
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `countedCash` | number | yes | VR-43 — mandatory, non-negative, at most 2 decimal places |
| `discrepancyReason` | string | conditional | VR-43, VR-93 — **mandatory when `countedCash` differs from the system total**, minimum 10 characters |

**Response Body**

```json
{
  "reconciliationId": "0191f700-…",
  "businessDate": "2026-08-04",
  "systemTotal": 1850.00,
  "countedCash": 1830.00,
  "discrepancy": -20.00,
  "discrepancyReason": "Two 10-taka notes missing from the drawer at close; recount gave the same figure",
  "reconciledBy": { "userId": "0191f0aa-…", "fullName": "Farhana Akter" },
  "reconciledAt": "2026-08-04T17:20:00+06:00",
  "systemTotalAdjusted": false
}
```

`systemTotalAdjusted` is a constant `false`. **The system total is never adjusted to match the count** (EC-22). The discrepancy is recorded as a fact and investigated by people; silently reconciling the ledger to the cash drawer would destroy the only independent record of what was collected.

`discrepancy` is a generated column, `countedCash − systemTotal`.

**Validation** — VR-43 counted cash mandatory and a ≥10-character reason when it differs from the system total; one reconciliation per location per business date (`uq_reconciliation_day`); the date is not in the future.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `ALREADY_RECONCILED` | 409 | A reconciliation exists for this date | "This day has already been reconciled. Contact an administrator if the figure is wrong." |
| `VALIDATION_FAILED` | 422 | VR-43 — the count differs and no reason of 10+ characters was given | "The count is 20.00 BDT below the system total. Give a reason of at least 10 characters." |
| `FUTURE_DATE` | 422 | Date is after today | "Choose today's date or earlier." |

**Status Codes** — `201`, `401`, `403`, `409`, `422`.

---
# Part 6 — Module MED
### Medicine Inventory & Store

Covers FR-MED-01…28, VR-50…VR-63, BR-35…BR-42, EC-26…EC-35. Base path `/api/v1`.

**Module-wide rules.**

1. **The movement log is append-only.** No `PUT`, `PATCH` or `DELETE` exists on any stock movement. Corrections are new adjusting movements (FR-MED-21, BR-41, BR-61, EC-30).
2. **Exact quantities are Store Operator and Administrator only.** Every other caller — including anonymous, students, staff and counselors — receives a Status Band and a freshness stamp, never a number (FR-MED-05, BR-35). The response *shape* changes with the caller; this is enforced by column-level grants in the database as well as by the interface (DATABASE §11).
3. **Expired stock is not dispensable.** Any batch expiring on or before the current date is excluded from dispensable quantity, and dispensing from one is rejected unconditionally with no override (FR-MED-16, FR-MED-18, VR-56, BR-40).
4. **Nothing is reserved.** Phase 1 has no reservation, hold or request. Every availability response says so (FR-MED-09, BR-37, EC-26).
5. **No student identity is recorded against a dispensing event** in Phase 1 (FR-MED-28, OI-18). This is a deliberate, recorded privacy/accountability trade-off awaiting a DIU decision — not an oversight, and not something to add without that decision.

---

## 6.1 Catalogue — public read path

### GET /api/v1/medicines

**Purpose** — Search the medicine catalogue by brand or generic name, returning availability as a Status Band with a freshness stamp (FR-MED-01, FR-MED-02, FR-MED-03).

**Authentication** — `None`. Matrix: *Medicine catalogue — ANON: R (band only)*. The same route serves every role; the response shape widens only for `STO` and `ADM`.

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `q` | string | yes | VR-63 — minimum 2 characters. Matches brand name to generic name and vice versa, with partial and approximate matching (FR-MED-02) |
| `dispensingClass` | enum | no | `otc` \| `prescription_only` |
| `limit` / `cursor` | — | no | §0.8 |

**Response Body** — anonymous, student, staff and counselor callers:

```json
{
  "items": [
    {
      "medicineId": "0191f800-…",
      "genericName": "Paracetamol",
      "brandName": "Napa",
      "strength": "500 mg",
      "dosageForm": "Tablet",
      "dispensingClass": "otc",
      "statusBand": "available",
      "asOf": "2026-08-04T09:12:00+06:00",
      "asOfLabel": "as of 09:12",
      "notReservedNotice": "Stock is not reserved. Availability can change before you arrive.",
      "prescriptionNotice": null
    },
    {
      "medicineId": "0191f801-…",
      "genericName": "Amoxicillin",
      "brandName": "Amoxil",
      "strength": "250 mg",
      "dosageForm": "Capsule",
      "dispensingClass": "prescription_only",
      "statusBand": "low_stock",
      "asOf": "2026-08-04T08:40:00+06:00",
      "asOfLabel": "as of 08:40",
      "notReservedNotice": "Stock is not reserved. Availability can change before you arrive.",
      "prescriptionNotice": "Requires a doctor's prescription."
    }
  ],
  "nextCursor": null,
  "emptyResultMeaning": null
}
```

| Field | Type | Notes |
|---|---|---|
| `statusBand` | enum | `available` \| `low_stock` \| `out_of_stock`. Derived: 0 → `out_of_stock`; at or below the item's threshold → `low_stock`; otherwise `available` (FR-MED-06, BR-36) |
| `asOf` / `asOfLabel` | timestamptz / string | FR-MED-04 requires the text "as of HH:MM" adjacent to every band, reflecting the most recent stock movement or verification |
| `notReservedNotice` | string | **Always present on every item.** FR-MED-04 requires the "not reserved" statement to accompany the band. Making it a field means a template change cannot drop it (BR-37, EC-26) |
| `prescriptionNotice` | string \| null | `"Requires a doctor's prescription."` for `prescription_only`. **No wording implying direct collection is present anywhere in the response** (FR-MED-07, BR-38, EC-34) |
| `emptyResultMeaning` | string \| null | On a zero-result search: `"not_in_catalogue"` with the message *"This medicine isn't in the DIU catalogue. That's different from being out of stock."* — EC-33 requires the two to be distinguished |

**Response Body** — `STO` and `ADM` callers additionally receive:

```json
{
  "dispensableQuantity": 240,
  "lowStockThreshold": 50,
  "batchCount": 3,
  "earliestExpiry": "2026-11-30",
  "expiredBatchCount": 1
}
```

`dispensableQuantity` never appears for any other role. `expiredBatchCount` alerts the operator that expired stock requires removal (EC-28).

**Validation** — VR-63 — `q` minimum 2 characters. A shorter query performs no search and prompts.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `QUERY_TOO_SHORT` | 422 | VR-63 | "Type at least 2 characters to search." |

Served from `pharmacy.mv_medicine_availability` behind a 60-second edge cache (`Cache-Control: public, max-age=60`) for anonymous callers. Operator responses bypass the cache — an operator needs live numbers.

**Status Codes** — `200`, `422`, `503`.

---

### GET /api/v1/medicines/{id}

**Purpose** — Retrieve one catalogue item (FR-MED-03).

**Authentication** — `None`; shape widens for `STO` and `ADM` exactly as above.

**Request Body** — none.

**Response Body** — a single item object as in `GET /api/v1/medicines`.

**Validation** — none.

**Error Responses** — universal set only.

**Status Codes** — `200`, `404`.

---

## 6.2 Catalogue — operator management

### POST /api/v1/medicines

**Purpose** — Create a catalogue item (FR-MED-10, FR-MED-11).

**Authentication** — `Session + Role(STO)`. Matrix: *Medicine catalogue — STO: C R U D*.

**Request Body**

```json
{
  "genericName": "Paracetamol",
  "brandName": "Napa",
  "strength": "500 mg",
  "dosageForm": "Tablet",
  "dispensingClass": "otc",
  "lowStockThreshold": 50
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `genericName` | string | yes | VR-50 — mandatory |
| `brandName` | string \| null | no | — |
| `strength` | string | yes | VR-50 — mandatory |
| `dosageForm` | string | yes | VR-50 — mandatory |
| `dispensingClass` | enum | yes | VR-50, FR-MED-11 — `otc` \| `prescription_only`. **No item may exist unclassified**; there is no default and no null |
| `lowStockThreshold` | integer | no | VR-60 — non-negative. Defaults to 0 |

**Response Body** — the created item with `version: 1` and `statusBand: "out_of_stock"` (no batches yet).

**Validation** — VR-50 mandatory fields; VR-51 the combination of generic name, strength and dosage form must be unique; VR-60 threshold non-negative.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `CATALOGUE_DUPLICATE` | 409 | VR-51. `error.details.existingItem` carries the existing row | "Paracetamol 500 mg Tablet is already in the catalogue. Use the existing item." |
| `VALIDATION_FAILED` | 422 | VR-50 — a mandatory field missing, or no classification | "Every medicine needs a generic name, strength, dosage form, and an OTC or prescription-only classification." |

**Status Codes** — `201`, `401`, `403`, `409`, `422`.

---

### PATCH /api/v1/medicines/{id}

**Purpose** — Edit a catalogue item, including its Low Stock threshold (FR-MED-10, FR-MED-22).

**Authentication** — `Session + Role(STO)`.

**Request Body**

```json
{ "brandName": "Napa Extra", "lowStockThreshold": 80, "version": 2 }
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `genericName` / `strength` / `dosageForm` | string | no | VR-50 non-empty; VR-51 uniqueness re-checked |
| `brandName` | string \| null | no | — |
| `dispensingClass` | enum | no | VR-50 — may be changed but never cleared (FR-MED-11) |
| `lowStockThreshold` | integer | no | VR-60 — non-negative |
| `version` | integer | yes | VR-92 |

Changing `lowStockThreshold` recomputes the item's Status Band immediately and may emit `StockLevelChanged`.

**Response Body** — the updated item object.

**Validation** — VR-50, VR-51, VR-60, VR-92.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `CATALOGUE_DUPLICATE` | 409 | VR-51 — the change would collide with another item | "Another catalogue item already has that generic name, strength and dosage form." |
| `CLASSIFICATION_REQUIRED` | 422 | Attempt to null `dispensingClass` | "Every medicine must be classified as OTC or prescription-only." |
| `CONFLICT_STALE_VERSION` | 409 | VR-92 | See §0.6 |

**Status Codes** — `200`, `401`, `403`, `404`, `409`, `422`.

---

### POST /api/v1/medicines/{id}/deactivate

**Purpose** — Deactivate a catalogue item, retaining all movement history (EC-35).

**Authentication** — `Session + Role(STO)`.

**Request Body**

```json
{ "reason": "No longer stocked by the DIU medical centre", "version": 2 }
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `reason` | string | yes | VR-93 |
| `version` | integer | yes | VR-92 |

**Response Body**

```json
{
  "medicineId": "0191f800-…",
  "isActive": false,
  "remainingDispensableQuantity": 40,
  "message": "This item no longer appears in search. Record an adjustment to remove the remaining 40 units from stock.",
  "version": 3
}
```

Deactivation removes the item from search but does **not** zero its stock. Stock leaves through a recorded movement, never through a catalogue edit — otherwise 40 units would vanish from the ledger with no entry explaining where they went.

**Validation** — VR-93; VR-92; item currently active.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `ALREADY_INACTIVE` | 409 | Already deactivated | "This item is already inactive." |

**Status Codes** — `200`, `401`, `403`, `404`, `409`, `422`.

---

### DELETE /api/v1/medicines/{id}

**Purpose** — Delete a catalogue item. Permitted **only** when no stock movement has ever referenced it (EC-35).

**Authentication** — `Session + Role(STO)`.

**Request Body** — none.

**Response Body** — none on success.

**Validation** — no `stock_movement` references any batch of this item.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `MEDICINE_HAS_MOVEMENTS` | 409 | Movements exist. `error.details.movementCount` given | "This item has 312 stock movements and can't be deleted. Deactivate it instead — the records stay intact." |

**Status Codes** — `204`, `401`, `403`, `404`, `409`.

---

## 6.3 Batches and stock movements

### GET /api/v1/medicines/{id}/batches

**Purpose** — List an item's batches with quantities and expiry dates (FR-MED-13).

**Authentication** — `Session + Role(STO)` or `Session + Role(ADM)`. Matrix: *Medicine stock quantities — STO: R U, ADM: R*, every other role `—`.

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `includeExpired` | boolean | no | Defaults to `true` — an operator needs to see expired stock in order to remove it (EC-28) |
| `includeEmpty` | boolean | no | Defaults to `false` |

**Response Body**

```json
{
  "medicineId": "0191f800-…",
  "dispensableQuantity": 240,
  "items": [
    {
      "batchId": "0191f900-…",
      "batchRef": "B-2026-114",
      "expiryDate": "2026-11-30",
      "quantityReceived": 200,
      "quantityRemaining": 140,
      "isExpired": false,
      "isFefoCandidate": true,
      "receivedAt": "2026-06-02T10:15:00+06:00",
      "version": 6
    },
    {
      "batchId": "0191f901-…",
      "batchRef": "B-2025-088",
      "expiryDate": "2026-07-31",
      "quantityReceived": 100,
      "quantityRemaining": 30,
      "isExpired": true,
      "isFefoCandidate": false,
      "receivedAt": "2025-12-11T09:02:00+06:00",
      "version": 9
    }
  ],
  "expiredQuantityRequiringRemoval": 30
}
```

`dispensableQuantity` excludes every expired batch (FR-MED-16, BR-40). `expiredQuantityRequiringRemoval` implements the EC-28 alert: quantity is non-zero, the band is `out_of_stock`, and the operator is told the expired stock needs removing.

**Validation** — none.

**Error Responses** — universal set only.

**Status Codes** — `200`, `401`, `403`, `404`.

---

### POST /api/v1/medicines/{id}/batches

**Purpose** — Record a stock receipt, creating a batch with its own quantity and expiry date (FR-MED-12, FR-MED-13).

**Authentication** — `Session + Role(STO)`. Matrix: *Stock movements — STO: C R*.

**Request Body**

```json
{
  "batchRef": "B-2026-114",
  "expiryDate": "2026-11-30",
  "quantity": 200
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `batchRef` | string | yes | VR-54 — mandatory, unique per item |
| `expiryDate` | date | yes | VR-53 — mandatory, **strictly after the current date at the time of receipt** |
| `quantity` | integer | yes | VR-52 — greater than 0 |

**Response Body**

```json
{
  "batchId": "0191f900-…",
  "batchRef": "B-2026-114",
  "expiryDate": "2026-11-30",
  "quantityReceived": 200,
  "quantityRemaining": 200,
  "movementId": "0191fa00-…",
  "newStatusBand": "available",
  "dispensableQuantity": 440,
  "version": 1
}
```

Creates the batch **and** the `receipt` movement in one transaction. `quantity_remaining` is a maintained aggregate over the movement log; the log remains the source of truth (DATABASE D1). Emits `StockLevelChanged`.

**Validation** — VR-52 quantity > 0; VR-53 expiry strictly future at receipt (enforced by trigger — `current_date` is not immutable and cannot sit in a CHECK); VR-54 batch reference unique per item.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `BATCH_REF_DUPLICATE` | 409 | VR-54 | "Batch B-2026-114 already exists for this medicine." |
| `EXPIRY_IN_PAST` | 422 | VR-53 | "Cannot receive stock that is already expired." |
| `VALIDATION_FAILED` | 422 | VR-52 — quantity 0 or negative | "Enter a quantity greater than zero." |

**Status Codes** — `201`, `401`, `403`, `404`, `409`, `422`.

---

### GET /api/v1/medicines/{id}/fefo-batch

**Purpose** — Propose the earliest-expiring non-expired batch for a dispensing event (FR-MED-15, BR-39).

**Authentication** — `Session + Role(STO)`.

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `quantity` | integer | no | Intended dispensing quantity, used to flag whether one batch suffices |

**Response Body**

```json
{
  "proposedBatch": {
    "batchId": "0191f900-…",
    "batchRef": "B-2026-114",
    "expiryDate": "2026-11-30",
    "quantityRemaining": 140
  },
  "sufficientForQuantity": true,
  "alternativeBatches": [
    { "batchId": "0191f902-…", "batchRef": "B-2026-120", "expiryDate": "2027-02-28", "quantityRemaining": 100 }
  ],
  "overrideRequiresReason": true
}
```

`overrideRequiresReason` is a constant `true`: selecting any batch other than `proposedBatch` requires a reason of at least 10 characters (VR-57). Expired batches never appear in either list.

**Validation** — none.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `NO_DISPENSABLE_STOCK` | 409 | Every batch is expired or empty | "There's no non-expired stock of this item." |

**Status Codes** — `200`, `401`, `403`, `404`, `409`.

---

### POST /api/v1/medicines/{id}/dispensings

**Purpose** — Record a dispensing event, decrementing stock from the selected batch (FR-MED-14, FR-MED-20).

**Authentication** — `Session + Role(STO)`.

**Request Body**

```json
{
  "batchId": "0191f900-…",
  "quantity": 10,
  "fefoOverrideReason": null,
  "dispensingLimitOverrideReason": null
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `batchId` | uuid | yes | Must belong to this item and must not be expired |
| `quantity` | integer | yes | VR-55 — greater than 0, not exceeding the batch's remaining quantity |
| `fefoOverrideReason` | string \| null | conditional | VR-57, VR-93 — **required when `batchId` is not the FEFO candidate**, ≥10 characters |
| `dispensingLimitOverrideReason` | string \| null | conditional | VR-58, VR-93 — required when the quantity exceeds the configured 24-hour per-item maximum (default 10, OI-17) |

**No student identifier is accepted.** FR-MED-28 and OI-18 record that Phase 1 does not store the identity of the student receiving a dispensed medicine. This is a deliberate trade-off pending a DIU decision, not an omission — the field does not exist in the schema, and adding it here would pre-empt that decision.

**Response Body**

```json
{
  "movementId": "0191fa01-…",
  "batchId": "0191f900-…",
  "batchRef": "B-2026-114",
  "quantityDispensed": 10,
  "batchQuantityRemaining": 130,
  "dispensableQuantity": 430,
  "newStatusBand": "available",
  "fefoOverridden": false,
  "dispensingLimitOverridden": false,
  "lowStockAlertTriggered": false,
  "immutable": true,
  "recordedAt": "2026-08-04T11:20:00+06:00"
}
```

Emits `StockLevelChanged`. When the dispensable quantity falls to or below the item's threshold, the Store Operator is notified — at most once per item per day (FR-MED-23).

**Validation** — VR-55 quantity > 0 and ≤ the batch's remaining; VR-56 the batch must not be expired; VR-57 non-FEFO selection requires a ≥10-character reason; VR-58 exceeding the 24-hour limit requires an override reason.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `BATCH_EXPIRED` | 409 | VR-56, FR-MED-18, BR-40 — **rejected unconditionally, no override exists** | "Batch B-2025-088 expired on 31 July. It can't be dispensed. Record an expiry-removal adjustment instead." |
| `INSUFFICIENT_BATCH_QUANTITY` | 409 | VR-55. `error.details.available` given | "Only 8 units remain in that batch." |
| `FEFO_OVERRIDE_REASON_REQUIRED` | 422 | VR-57 — a later-expiring batch chosen without a reason | "Batch B-2026-114 expires sooner. Give a reason of at least 10 characters for choosing a different batch." |
| `DISPENSING_LIMIT_EXCEEDED` | 422 | VR-58 — over the 24-hour maximum with no reason (EC-29) | "The 24-hour limit for this item is 10 units. Give a reason of at least 10 characters to dispense more." |
| `BATCH_NOT_FOR_ITEM` | 422 | The batch belongs to another medicine | "That batch doesn't belong to this medicine." |

**Status Codes** — `201`, `401`, `403`, `404`, `409`, `422`.

---

### POST /api/v1/medicines/{id}/adjustments

**Purpose** — Record a stock adjustment with a reason category and free-text detail (FR-MED-19, FR-MED-20, BR-41).

**Authentication** — `Session + Role(STO)`.

**Request Body**

```json
{
  "batchId": "0191f901-…",
  "quantityDelta": -30,
  "adjustmentReasonCode": "EXPIRY_REMOVAL",
  "detail": "Expired batch removed from the shelf and disposed of per policy"
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `batchId` | uuid | yes | Must belong to this item |
| `quantityDelta` | integer | yes | VR-59 — **non-zero**. Signed: negative removes, positive corrects upward |
| `adjustmentReasonCode` | enum | yes | VR-59 — `DAMAGE` \| `LOSS` \| `CORRECTION` \| `EXPIRY_REMOVAL` |
| `detail` | string | yes | VR-59, VR-93 — mandatory, ≥10 characters |

**Response Body**

```json
{
  "movementId": "0191fa02-…",
  "kind": "adjustment",
  "quantityDelta": -30,
  "adjustmentReason": { "code": "EXPIRY_REMOVAL", "label": "Expiry removal" },
  "detail": "Expired batch removed from the shelf and disposed of per policy",
  "batchQuantityRemaining": 0,
  "dispensableQuantity": 430,
  "newStatusBand": "available",
  "immutable": true,
  "recordedAt": "2026-08-04T11:35:00+06:00"
}
```

**This is the correction mechanism for the whole module.** A receipt entered with the wrong quantity is corrected by an adjustment with reason `CORRECTION`; the original receipt is never edited (EC-30, FR-MED-21). Adjusting an expired batch downward is permitted and expected — that is how expired stock leaves the ledger.

**Validation** — VR-59 non-zero delta, reason category from the enum, detail ≥10 characters; the resulting `quantity_remaining` must not go below 0 or above `quantity_received`.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `ADJUSTMENT_OUT_OF_RANGE` | 409 | Result would be negative or exceed the received quantity | "That adjustment would leave the batch at −5 units. Check the figure." |
| `VALIDATION_FAILED` | 422 | VR-59 — zero delta, missing reason, or detail under 10 characters | "Choose a reason and give at least 10 characters of detail." |

**Status Codes** — `201`, `401`, `403`, `404`, `409`, `422`.

---

### GET /api/v1/stock-movements

**Purpose** — Read the append-only movement ledger (FR-MED-20). This is the source of truth for all stock figures.

**Authentication** — `Session + Role(STO)` or `Session + Role(ADM)`. Matrix: *Stock movements — STO: C R, ADM: R*. **Note that no role has `U` or `D`** — and correspondingly no update or delete route exists here (FR-MED-21, BR-61).

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `medicineId` | uuid | no | — |
| `batchId` | uuid | no | — |
| `kind` | enum | no | `receipt` \| `dispense` \| `adjustment` |
| `from` / `to` | date | no | Defaults to the last 30 days; range ≤ 365 days |
| `limit` / `cursor` | — | no | §0.8 |

**Response Body**

```json
{
  "items": [
    {
      "movementId": "0191fa01-…",
      "medicineId": "0191f800-…",
      "genericName": "Paracetamol",
      "batchRef": "B-2026-114",
      "kind": "dispense",
      "quantityDelta": -10,
      "adjustmentReason": null,
      "detail": null,
      "fefoOverridden": false,
      "fefoOverrideReason": null,
      "dispensingLimitOverridden": false,
      "limitOverrideReason": null,
      "recordedBy": { "userId": "0191f0bb-…", "fullName": "Imran Hossain" },
      "recordedAt": "2026-08-04T11:20:00+06:00"
    }
  ],
  "nextCursor": null
}
```

No entry carries a student identifier, for dispensing or anything else (FR-MED-28).

**Validation** — `to` ≥ `from`; range ≤ 365 days.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `INVALID_DATE_RANGE` | 422 | Range invalid or over 365 days | "Choose a date range of up to one year." |

**Status Codes** — `200`, `401`, `403`, `422`.

---

### GET /api/v1/stock-adjustment-reasons

**Purpose** — The fixed adjustment reason list (VR-59, FR-MED-19).

**Authentication** — `Session + Role(STO)`.

**Request Body** — none.

**Response Body**

```json
{
  "items": [
    { "code": "DAMAGE", "label": "Damage" },
    { "code": "LOSS", "label": "Loss" },
    { "code": "CORRECTION", "label": "Correction" },
    { "code": "EXPIRY_REMOVAL", "label": "Expiry removal" }
  ]
}
```

The set is closed and enforced by a database CHECK constraint; it is not administrator-configurable in Phase 1.

**Validation** — none.

**Error Responses** — universal set only.

**Status Codes** — `200`, `401`, `403`.

---

## 6.4 Store hours and status

### GET /api/v1/store/hours

**Purpose** — The scheduled weekly opening hours (FR-MED-25).

**Authentication** — `None`. Matrix: *Store hours & status — every role R, STO: C R U*.

**Request Body** — none.

**Response Body**

```json
{
  "items": [
    { "weekday": 0, "opensAt": null, "closesAt": null },
    { "weekday": 1, "opensAt": "09:00", "closesAt": "17:00" },
    { "weekday": 2, "opensAt": "09:00", "closesAt": "17:00" }
  ]
}
```

`weekday` is 0–6 with 0 = Sunday. Null times mean closed that day. At most one interval per weekday in Phase 1 (VR-61).

**Validation** — none.

**Error Responses** — universal set only.

**Status Codes** — `200`.

---

### PUT /api/v1/store/hours

**Purpose** — Replace the weekly opening-hours schedule (FR-MED-25). A full replace rather than per-row edits, because the seven days are one coherent schedule and a partial update invites a half-applied week.

**Authentication** — `Session + Role(STO)`.

**Request Body**

```json
{
  "hours": [
    { "weekday": 0, "opensAt": null, "closesAt": null },
    { "weekday": 1, "opensAt": "09:00", "closesAt": "17:00" },
    { "weekday": 2, "opensAt": "09:00", "closesAt": "17:00" },
    { "weekday": 3, "opensAt": "09:00", "closesAt": "17:00" },
    { "weekday": 4, "opensAt": "09:00", "closesAt": "17:00" },
    { "weekday": 5, "opensAt": null, "closesAt": null },
    { "weekday": 6, "opensAt": "10:00", "closesAt": "14:00" }
  ],
  "version": 3
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `hours[]` | array | yes | Exactly 7 entries, weekdays 0–6, each appearing once |
| `hours[].opensAt` / `closesAt` | `HH:mm` \| null | yes | VR-61 — closing strictly after opening; both null means closed |
| `version` | integer | yes | VR-92 |

**Response Body** — the stored schedule, plus the derived current state.

**Validation** — VR-61 — closing after opening; at most one interval per weekday; all 7 weekdays present exactly once; VR-92.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `INVALID_HOURS` | 422 | VR-61 — closing at or before opening | "Closing time must be after opening time." |
| `INCOMPLETE_WEEK` | 422 | Missing or duplicated weekday | "Give opening hours for all seven days. Use empty times for days you're closed." |
| `CONFLICT_STALE_VERSION` | 409 | VR-92 | See §0.6 |

**Status Codes** — `200`, `401`, `403`, `409`, `422`.

---

### GET /api/v1/store/status

**Purpose** — The store's current open/closed state and its source (FR-MED-08, FR-MED-26, BR-42).

**Authentication** — `None`.

**Request Body** — none.

**Response Body**

```json
{
  "isOpen": false,
  "stateSource": "manual_override",
  "today": { "weekday": 1, "opensAt": "09:00", "closesAt": "17:00" },
  "override": {
    "overrideId": "0191fb00-…",
    "isClosed": true,
    "reason": "Operator called away for a family emergency this afternoon",
    "effectiveDate": "2026-08-04",
    "expiresAt": "2026-08-04T23:59:00+06:00"
  },
  "asOf": "2026-08-04T14:02:00+06:00"
}
```

The state derives from the scheduled hours by default (FR-MED-26, BR-42); a manual override, when present for today, takes precedence. `override` is null otherwise.

**Validation** — none.

**Error Responses** — universal set only.

**Status Codes** — `200`.

---

### POST /api/v1/store/status-override

**Purpose** — Apply a manual override to the store state, expiring automatically at 23:59 BST on the day it was applied (FR-MED-27, BR-42, EC-31).

**Authentication** — `Session + Role(STO)`.

**Request Body**

```json
{
  "isClosed": true,
  "reason": "Operator called away for a family emergency this afternoon"
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `isClosed` | boolean | yes | `true` closes an otherwise-open store; `false` opens an otherwise-closed one |
| `reason` | string | yes | VR-62, VR-93 — mandatory, ≥10 characters |

**Response Body**

```json
{
  "overrideId": "0191fb00-…",
  "effectiveDate": "2026-08-04",
  "isClosed": true,
  "reason": "Operator called away for a family emergency this afternoon",
  "expiresAt": "2026-08-04T23:59:00+06:00",
  "expiresAutomatically": true
}
```

Expiry needs no scheduled job. The override is stored as a dated row; a query for "today" simply finds nothing tomorrow (DATABASE §9, `store_status_override`).

An operator who forgets to apply a closure override is an accepted Phase 1 limitation, mitigated by the scheduled-hours default and the freshness stamp (EC-32).

**Validation** — VR-62 reason ≥10 characters; at most one override per location per date (`uq_store_override_day`).

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `OVERRIDE_ALREADY_SET` | 409 | An override already exists for today | "There's already an override for today. Remove it first if you need to change it." |
| `VALIDATION_FAILED` | 422 | VR-62 | "Give a reason of at least 10 characters." |

**Status Codes** — `201`, `401`, `403`, `409`, `422`.

---

### DELETE /api/v1/store/status-override

**Purpose** — Clear today's manual override, returning the store to its scheduled state (FR-MED-26).

**Authentication** — `Session + Role(STO)`.

**Request Body**

```json
{ "reason": "Operator returned; store reopened for the rest of the afternoon" }
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `reason` | string | yes | VR-93 |

**Response Body** — the current store status object, `stateSource` back to `scheduled_hours`.

**Validation** — VR-93; an override exists for today.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `NO_ACTIVE_OVERRIDE` | 404 | No override for today | "There's no override in place today." |

**Status Codes** — `200`, `401`, `403`, `404`, `422`.

---
# Part 7 — Module NTF
### Notifications

Covers FR-NTF-01…09, BR-53, EC-47, EC-51, EC-52. Base path `/api/v1`.

**Module-wide rules.**

1. **In-app is the floor.** Email delivery failure never removes the in-app notification (FR-NTF-08, EC-51). A student with no registered email gets in-app only, and is warned that external reminders will not arrive (EC-52).
2. **No email body carries clinical content.** No personal health information, diagnosis, reason-for-visit or medicine name appears in any email (FR-NTF-09, NFR-PRIV-03).
3. **Counseling notifications are discreet by construction.** Subject, preview text and body omit the words identifying the counseling or psychiatric service, any category, any urgency, any clinical term, and any counselor specialisation. They convey only that an update is available and require the student to log in to view it (FR-NTF-05, FR-NTF-06, BR-53, EC-47). The Content Policy Guard enforces this at dispatch and rejects a violating send as a security event.
4. **Email only.** No SMS, push or paid channel in Phase 1 (FR-NTF-03, CON-08).

---

### GET /api/v1/me/notifications

**Purpose** — The caller's in-app notification centre: unread and historical (FR-NTF-01, FR-DASH-04).

**Authentication** — `Session + Own`. Matrix: *Notifications (own) — every authenticated role R U*.

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `unreadOnly` | boolean | no | Defaults to `false` |
| `limit` / `cursor` | — | no | §0.8 |

**Response Body**

```json
{
  "unreadCount": 2,
  "items": [
    {
      "notificationId": "0191fc00-…",
      "templateKey": "APT_QUEUE_POSITION_2",
      "subject": "You're next but one",
      "body": "There are 2 patients ahead of you for Dr. Rahman. Estimated wait: about 20 minutes.",
      "isDiscreet": false,
      "readAt": null,
      "createdAt": "2026-08-04T10:18:00+06:00"
    },
    {
      "notificationId": "0191fc01-…",
      "templateKey": "CNS_UPDATE_AVAILABLE",
      "subject": "You have an update",
      "body": "There's an update waiting for you. Sign in to view it.",
      "isDiscreet": true,
      "readAt": null,
      "createdAt": "2026-08-04T09:02:00+06:00"
    }
  ],
  "nextCursor": null,
  "emailDeliveryWarning": null
}
```

| Field | Type | Notes |
|---|---|---|
| `isDiscreet` | boolean | `true` for counseling-originated notifications. Note the body of the discreet example: no category, no urgency, no counselor, no clinical term — only that an update exists (FR-NTF-06) |
| `emailDeliveryWarning` | string \| null | EC-52 — `"You don't have an email address registered, so you'll only see notifications here."` |

**A discreet notification reveals nothing to a reader other than the account holder** — which matters because EC-47 anticipates delivery to a shared or family email account. The in-app record is equally discreet; consistency is the point.

**Validation** — none.

**Error Responses** — universal set only.

**Status Codes** — `200`, `401`, `403`.

---

### POST /api/v1/me/notifications/{id}/read

**Purpose** — Mark one notification read (FR-NTF-01).

**Authentication** — `Session + Own`.

**Request Body** — none.

**Response Body**

```json
{ "notificationId": "0191fc00-…", "readAt": "2026-08-04T10:31:00+06:00", "unreadCount": 1 }
```

Marking an already-read notification is not an error; `readAt` is unchanged.

**Validation** — the notification belongs to the caller.

**Error Responses** — universal set only. Another user's notification returns `404`, not `403`.

**Status Codes** — `200`, `401`, `403`, `404`.

---

### POST /api/v1/me/notifications/read-all

**Purpose** — Mark every unread notification read.

**Authentication** — `Session + Own`.

**Request Body** — none.

**Response Body**

```json
{ "markedCount": 2, "unreadCount": 0, "readAt": "2026-08-04T10:31:00+06:00" }
```

**Validation** — none.

**Error Responses** — universal set only.

**Status Codes** — `200`, `401`, `403`.

---

### GET /api/v1/notification-templates

**Purpose** — The template registry, for administrative review of wording (FR-NTF-05, matrix *Notification templates — ADM: R U*).

**Authentication** — `Session + Role(ADM)`.

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `isDiscreet` | boolean | no | Filter to the discreet allow-list |

**Response Body**

```json
{
  "items": [
    {
      "templateId": "0191fd00-…",
      "templateKey": "CNS_UPDATE_AVAILABLE",
      "isDiscreet": true,
      "allowsFreeText": false,
      "subjectTemplate": "You have an update",
      "bodyTemplate": "There's an update waiting for you. Sign in to view it.",
      "isActive": true,
      "version": 1
    }
  ]
}
```

The registry holds templates, not messages. An Administrator reading it learns which discreet templates exist — **not that any particular student has ever received one** (PRM-09, BR-50). Sent-notification records are not exposed here.

**Validation** — none.

**Error Responses** — universal set only.

**Status Codes** — `200`, `401`, `403`.

---

### PATCH /api/v1/notification-templates/{id}

**Purpose** — Edit template wording (FR-NTF-05, matrix *ADM: U*).

**Authentication** — `Session + Role(ADM)`.

**Request Body**

```json
{
  "subjectTemplate": "You have an update",
  "bodyTemplate": "There's an update waiting for you. Sign in to view it.",
  "isActive": true,
  "version": 1
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `subjectTemplate` | string | no | Non-empty |
| `bodyTemplate` | string | no | Non-empty |
| `isActive` | boolean | no | — |
| `version` | integer | yes | VR-92 |

`templateKey`, `isDiscreet` and `allowsFreeText` are **not editable**. Flipping `isDiscreet` to false on a counseling template, or enabling free text on a discreet one, would breach FR-NTF-05 through a configuration change — so the API does not offer it. The database enforces the same rule (`ck_template_discreet_no_freetext`).

**Response Body** — the updated template object.

**Validation** — VR-92; non-empty templates; **for a discreet template, the submitted subject and body are checked by the Content Policy Guard** and rejected if they contain a counseling-identifying term, a category, an urgency, a clinical term, or a placeholder that would interpolate free text.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `DISCREET_POLICY_VIOLATION` | 422 | Guard rejected the wording (FR-NTF-05). Logged as a security event | "This message is used for confidential updates and can't mention the service, a category, or any clinical detail." |
| `FIELD_NOT_EDITABLE` | 422 | `templateKey`, `isDiscreet` or `allowsFreeText` in body | "That property of a template can't be changed." |
| `CONFLICT_STALE_VERSION` | 409 | VR-92 | See §0.6 |

**Status Codes** — `200`, `401`, `403`, `404`, `409`, `422`.

---

# Part 8 — Module ADM
### Administration & Configuration

Covers FR-ADM-01…09, VR-94, BR-70, EC-50, EC-53. Base path `/api/v1`.

**Module-wide rules.** Every configurable value marked 【A】 in the SRS lives in `config.system_config` and is editable without redeployment (FR-ADM-01, BR-70). Every configuration change records actor, previous value, new value and timestamp (FR-ADM-02). Range validation happens **at save, not at use** (VR-94) — an out-of-range value must never reach the domain.

---

### GET /api/v1/config

**Purpose** — List every runtime configuration value with its type, range and description (FR-ADM-01).

**Authentication** — `Session + Role(ADM)`. Matrix: *System configuration — ADM: R U*, every other role `—`.

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `prefix` | string | no | Key prefix filter, e.g. `booking.` |

**Response Body**

```json
{
  "items": [
    {
      "configKey": "booking.max_active_per_student",
      "valueType": "integer",
      "value": "2",
      "minValue": 1,
      "maxValue": 10,
      "description": "Maximum simultaneous active bookings per student (BR-11, OI-08)",
      "updatedBy": { "userId": "0191f0cc-…", "fullName": "DIU IT" },
      "updatedAt": "2026-07-02T10:00:00+06:00",
      "version": 3
    },
    {
      "configKey": "scheduling.slot_length_minutes",
      "valueType": "integer",
      "value": "10",
      "minValue": 5,
      "maxValue": 60,
      "description": "Default consultation slot length (OI-05, VR-12)",
      "version": 2
    }
  ]
}
```

The registry covers, at minimum: slot length, walk-in allocation, publication window, booking cutoff, maximum active bookings, no-show threshold and suspension period, grace period, estimate slip threshold, consultation fee, low-stock thresholds, dispensing limit, triage SLAs, session timeouts, and case inactivity period (FR-ADM-01).

**Validation** — none.

**Error Responses** — universal set only.

**Status Codes** — `200`, `401`, `403`.

---

### GET /api/v1/config/{key}

**Purpose** — Retrieve one configuration value.

**Authentication** — `Session + Role(ADM)`.

**Request Body** — none.

**Response Body** — a single item object as above.

**Validation** — none.

**Error Responses** — universal set only.

**Status Codes** — `200`, `401`, `403`, `404`.

---

### PATCH /api/v1/config/{key}

**Purpose** — Change a configuration value, with range validation at save and a full audit record (FR-ADM-01, FR-ADM-02, VR-94, BR-70).

**Authentication** — `Session + Role(ADM)`. `Idempotency-Key` is **rejected** — a configuration change must be evaluated against current server state (ARCHITECTURE §5.6).

**Request Body**

```json
{
  "value": "3",
  "reason": "Increased after the July review of booking demand",
  "version": 3
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `value` | string | yes | VR-94 — must parse as the declared `valueType` and fall within `minValue`…`maxValue` |
| `reason` | string | yes | VR-93 — the change is audited with a stated reason |
| `version` | integer | yes | VR-92 |

**Response Body**

```json
{
  "configKey": "booking.max_active_per_student",
  "previousValue": "2",
  "value": "3",
  "effectiveFrom": "2026-08-04T15:10:00+06:00",
  "existingRecordsUnaffected": true,
  "note": "Bookings made before this change keep the terms they were made under. The new value applies to bookings created from now on.",
  "version": 4
}
```

`existingRecordsUnaffected` and the accompanying note implement EC-50 explicitly: existing bookings retain the terms under which they were made, and the new value applies only to bookings created after the change. Retroactive application would change a rule a student has already relied on.

**Validation** — VR-94 type and range checked at save; VR-93 reason; VR-92 version.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `CONFIG_OUT_OF_RANGE` | 422 | VR-94. `error.fields[]` carries `minValue` and `maxValue` | "Maximum active bookings must be between 1 and 10." |
| `CONFIG_TYPE_MISMATCH` | 422 | VR-94 — value does not parse as the declared type | "This setting needs a whole number." |
| `IDEMPOTENCY_NOT_SUPPORTED` | 422 | `Idempotency-Key` present | "Configuration changes can't be retried automatically." |
| `CONFLICT_STALE_VERSION` | 409 | VR-92 | See §0.6 |

**Status Codes** — `200`, `401`, `403`, `404`, `409`, `422`.

---

### GET /api/v1/service-calendar

**Purpose** — The non-service day calendar, for administration (FR-SCH-10, FR-ADM-03).

**Authentication** — `Session + Role(ADM)` for the maintenance view. The unauthenticated read is `GET /api/v1/public/service-calendar` (§2.6).

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `from` / `to` | date | no | Defaults to today through +365 days |

**Response Body**

```json
{
  "items": [
    {
      "id": "0191fe00-…",
      "date": "2026-08-15",
      "isServiceDay": false,
      "reason": "National Mourning Day",
      "createdBy": { "userId": "0191f0cc-…", "fullName": "DIU IT" },
      "createdAt": "2026-01-05T09:00:00+06:00"
    }
  ]
}
```

**Validation** — `to` ≥ `from`.

**Error Responses** — universal set only.

**Status Codes** — `200`, `401`, `403`, `422`.

---

### POST /api/v1/service-calendar

**Purpose** — Record a non-service day: weekly holiday, public holiday or closure period (FR-SCH-10, FR-ADM-03, BR-28).

**Authentication** — `Session + Role(ADM)`. Matrix: *Non-service calendar — ADM: C R U D*.

**Request Body**

```json
{
  "fromDate": "2026-08-15",
  "toDate": "2026-08-15",
  "isServiceDay": false,
  "reason": "National Mourning Day"
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `fromDate` | date | yes | — |
| `toDate` | date | no | Defaults to `fromDate`. On or after it. A range creates one row per date |
| `isServiceDay` | boolean | no | Defaults `false`. `true` marks an exception that reopens an otherwise-closed day |
| `reason` | string | yes | Shown to students when booking is blocked (FR-SCH-11) |

**Response Body**

```json
{
  "created": 1,
  "items": [ { "id": "0191fe00-…", "date": "2026-08-15", "isServiceDay": false, "reason": "National Mourning Day" } ],
  "conflictingSessions": []
}
```

`conflictingSessions` lists any already-scheduled session falling on a newly-closed day, so the Administrator can cancel it deliberately through §3.3. **Creating a calendar entry does not cancel sessions** — that would bypass the FR-SCH-07 impact preview.

**Validation** — `toDate` on or after `fromDate`; range ≤ 366 days; no existing entry for the same location and date (`uq_service_calendar_date`); `reason` non-empty.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `CALENDAR_ENTRY_EXISTS` | 409 | An entry already exists for a date in the range | "15 August is already marked in the calendar. Edit that entry instead." |
| `INVALID_DATE_RANGE` | 422 | `toDate` before `fromDate`, or range over 366 days | "Choose a date range within one year." |

**Status Codes** — `201`, `401`, `403`, `409`, `422`.

---

### PATCH /api/v1/service-calendar/{id}

**Purpose** — Edit a calendar entry's reason or service flag (FR-ADM-03).

**Authentication** — `Session + Role(ADM)`.

**Request Body**

```json
{ "reason": "National Mourning Day — university closed", "version": 1 }
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `isServiceDay` | boolean | no | — |
| `reason` | string | no | Non-empty |
| `version` | integer | yes | VR-92 |

**Response Body** — the updated entry.

**Validation** — VR-92; `reason` non-empty when present.

**Error Responses** — universal set, plus `CONFLICT_STALE_VERSION` (409).

**Status Codes** — `200`, `401`, `403`, `404`, `409`, `422`.

---

### DELETE /api/v1/service-calendar/{id}

**Purpose** — Remove a calendar entry, reopening the day for booking (FR-ADM-03).

**Authentication** — `Session + Role(ADM)`.

**Request Body** — none.

**Response Body** — none.

**Validation** — the date is not in the past. Removing a past closure would rewrite the record of a day the centre was shut.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `CANNOT_EDIT_PAST` | 409 | The entry's date has passed | "You can't remove a closure that's already happened." |

**Status Codes** — `204`, `401`, `403`, `404`, `409`.

---

### GET /api/v1/announcements

**Purpose** — Administrative list of announcements, including scheduled and expired ones (FR-ADM-04).

**Authentication** — `Session + Role(ADM)`. The public read is `GET /api/v1/public/announcements` (§2.5).

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `state` | enum | no | `active` \| `scheduled` \| `expired` \| `all` (default `all`) |

**Response Body**

```json
{
  "items": [
    {
      "id": "0191f5aa-…",
      "body": "The medical centre will close at 1 PM on 12 August for a staff training day.",
      "startsAt": "2026-08-01T00:00:00+06:00",
      "endsAt": "2026-08-12T23:59:00+06:00",
      "state": "active",
      "createdBy": { "userId": "0191f0cc-…", "fullName": "DIU IT" }
    }
  ]
}
```

**Validation** — none.

**Error Responses** — universal set only.

**Status Codes** — `200`, `401`, `403`.

---

### POST /api/v1/announcements

**Purpose** — Publish a dated announcement banner visible to students and on the public view (FR-ADM-04).

**Authentication** — `Session + Role(ADM)`. Matrix: *Announcements — ADM: C R U D*.

**Request Body**

```json
{
  "body": "The medical centre will close at 1 PM on 12 August for a staff training day.",
  "startsAt": "2026-08-01T00:00:00+06:00",
  "endsAt": "2026-08-12T23:59:00+06:00"
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `body` | string ≤500 | yes | Plain text. Stored verbatim, escaped on output, never interpreted as markup (VR-90) |
| `startsAt` | timestamptz | yes | — |
| `endsAt` | timestamptz | yes | Strictly after `startsAt` (`ck_announcement_period`) |

Maintenance during service hours is prohibited; where unavoidable, an announcement must be published at least 24 hours ahead (EC-53, NFR-AVL-02). This endpoint is how that obligation is met.

**Response Body** — the created announcement.

**Validation** — `body` non-empty, ≤500 characters; `endsAt` strictly after `startsAt`.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `INVALID_PERIOD` | 422 | `endsAt` at or before `startsAt` | "The end time must be after the start time." |

**Status Codes** — `201`, `401`, `403`, `422`.

---

### PATCH /api/v1/announcements/{id}

**Purpose** — Edit an announcement's text or schedule (FR-ADM-04).

**Authentication** — `Session + Role(ADM)`.

**Request Body**

```json
{ "endsAt": "2026-08-13T23:59:00+06:00", "version": 1 }
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `body` | string ≤500 | no | VR-90 |
| `startsAt` / `endsAt` | timestamptz | no | `endsAt` strictly after `startsAt` |
| `version` | integer | yes | VR-92 |

**Response Body** — the updated announcement.

**Validation** — period order; VR-92.

**Error Responses** — universal set, plus `INVALID_PERIOD` (422) and `CONFLICT_STALE_VERSION` (409).

**Status Codes** — `200`, `401`, `403`, `404`, `409`, `422`.

---

### DELETE /api/v1/announcements/{id}

**Purpose** — Withdraw an announcement (FR-ADM-04).

**Authentication** — `Session + Role(ADM)`.

**Request Body** — none.

**Response Body** — none.

**Validation** — none.

**Error Responses** — universal set only.

**Status Codes** — `204`, `401`, `403`, `404`.

---

### GET /api/v1/admin/health

**Purpose** — System health indicators: failed login count, failed notification count, outstanding data-entry backlogs (FR-ADM-07, NFR-MNT-02).

**Authentication** — `Session + Role(ADM)`.

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `windowHours` | integer | no | Defaults to 24; 1–168 |

**Response Body**

```json
{
  "windowHours": 24,
  "failedLogins": { "count": 37, "distinctAccounts": 9, "lockedAccounts": 2 },
  "notifications": {
    "pending": 4,
    "failed": 2,
    "skipped": 0,
    "emailChannelEnabled": true
  },
  "dataEntryBacklog": {
    "sessionsEndedNotCompleted": 1,
    "unreconciledCollectionDays": 2,
    "expiredStockAwaitingRemoval": 3
  },
  "counselingServiceReachable": true,
  "asOf": "2026-08-04T15:30:00+06:00"
}
```

`counselingServiceReachable` is a **liveness flag only** — whether the second process answers. It carries no count of requests, cases or students, because a count is itself a disclosure (BR-50, PRM-09). Notification failures surfaced here satisfy EC-51.

**Validation** — `windowHours` between 1 and 168.

**Error Responses** — universal set only.

**Status Codes** — `200`, `401`, `403`, `422`.

---

### POST /api/v1/admin/exports

**Purpose** — Request an export of appointment, queue, fee and inventory data for a date range, in a machine-readable format (FR-ADM-08, CON-09).

**Authentication** — `Session + Role(ADM)`. Matrix: *Data export — ADM: C*, every other role `—`.

**Request Body**

```json
{
  "datasets": ["appointments", "queue_events", "payments", "inventory_movements"],
  "fromDate": "2026-07-01",
  "toDate": "2026-07-31",
  "format": "csv"
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `datasets` | string[] | yes | Any of `appointments`, `queue_events`, `payments`, `inventory_movements`, `schedules`. **No counseling dataset exists** |
| `fromDate` / `toDate` | date | yes | `toDate` on or after `fromDate`; range ≤ 366 days |
| `format` | enum | no | `csv` (default) \| `json` |

**Response Body**

```json
{
  "exportId": "0191ff00-…",
  "status": "queued",
  "datasets": ["appointments", "queue_events", "payments", "inventory_movements"],
  "counselingDataExcluded": true,
  "exclusionMechanism": "structural",
  "estimatedReadyAt": "2026-08-04T15:33:00+06:00"
}
```

`exclusionMechanism: "structural"` states the FR-ADM-09 guarantee precisely. Counseling data is not filtered out of the export — **the Core process holds no credential to the counseling database and cannot read it at all**. A misconfigured filter is a plausible failure; a missing credential is not. This is the everyday payoff of ADR-001.

Export runs asynchronously on the background worker; the response is `202`.

**Validation** — `datasets` non-empty and all recognised; date range valid and ≤ 366 days; a request naming a counseling dataset is rejected.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `UNKNOWN_DATASET` | 422 | An unrecognised dataset name, including any counseling one | "That dataset isn't available for export." |
| `INVALID_DATE_RANGE` | 422 | Range invalid or over 366 days | "Choose a date range within one year." |

**Status Codes** — `202`, `401`, `403`, `422`.

---

### GET /api/v1/admin/exports/{id}

**Purpose** — Poll an export job and retrieve its result (FR-ADM-08).

**Authentication** — `Session + Role(ADM)`.

**Request Body** — none.

**Response Body**

```json
{
  "exportId": "0191ff00-…",
  "status": "ready",
  "requestedAt": "2026-08-04T15:30:00+06:00",
  "readyAt": "2026-08-04T15:32:41+06:00",
  "expiresAt": "2026-08-11T15:32:41+06:00",
  "rowCounts": { "appointments": 1042, "queue_events": 3318, "payments": 921, "inventory_movements": 604 },
  "downloadUrl": "/api/v1/admin/exports/0191ff00-…/download",
  "counselingDataExcluded": true
}
```

| Field | Type | Notes |
|---|---|---|
| `status` | enum | `queued` \| `running` \| `ready` \| `failed` \| `expired` |
| `downloadUrl` | string \| null | Present only when `ready`. Requires the same authentication; expires after 7 days |

**Validation** — none.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `EXPORT_FAILED` | 409 | Job failed. `error.correlationId` for support | "That export didn't finish. Try again, and quote this reference if it happens again." |
| `EXPORT_EXPIRED` | 410 | Past `expiresAt` | "That export has expired. Request a new one." |

**Status Codes** — `200`, `401`, `403`, `404`, `409`, `410`.

---

# Part 9 — Module AUD
### Audit, Access Logs & Break-Glass

Covers FR-AUD-01…07, FR-ADM-05/06, PRM-12, PRM-14, BR-60, BR-61, EC-45. Base path `/api/v1`.

**Module-wide rules.**

1. **Every resource here is read-only over HTTP.** There is no `POST`, `PATCH` or `DELETE` on any audit resource. No role, including System Administrator, can modify or delete an audit entry (FR-AUD-02, BR-61). The database enforces the same thing twice — by `REVOKE` and by a trigger that raises — because a future `GRANT` could undo the first.
2. **The counseling access log is not here.** It lives inside the vault, readable only by Counseling Professionals and the designated service head (§11.16, FR-CSE-16, FR-AUD-04, BR-51). An Administrator cannot read it by any route in this API.
3. **Break-glass is the only path to counseling content for an Administrator, and it is deliberately uncomfortable**: a typed justification, an immediate alert to a person, a hard 60-minute expiry, and no silent renewal (FR-AUD-05…07, PRM-14).

---

### GET /api/v1/admin/audit-log

**Purpose** — The audit log viewer, filterable by actor, date range, entity type and action (FR-ADM-05, FR-AUD-01).

**Authentication** — `Session + Role(ADM)`. Matrix: *General audit log — ADM: R*, every other role `—`.

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `actorId` | uuid | no | — |
| `entityType` | string | no | e.g. `appointment`, `payment`, `medicine_batch`, `user_account`, `system_config` |
| `entityId` | uuid | no | — |
| `action` | string | no | e.g. `created`, `status_advanced`, `cancelled` |
| `from` / `to` | timestamptz | no | Defaults to the last 7 days; range ≤ 90 days |
| `limit` / `cursor` | — | no | §0.8 |

**Response Body**

```json
{
  "items": [
    {
      "id": "01920000-…",
      "entityType": "appointment",
      "entityId": "0191f4a1-…",
      "action": "status_advanced",
      "beforeState": { "status": "waiting" },
      "afterState": { "status": "in_consultation" },
      "actor": { "userId": "0191f0aa-…", "fullName": "Farhana Akter", "role": "MCS" },
      "correlationId": "01J8ZQ7K4M9X2P",
      "occurredAt": "2026-08-04T10:31:00+06:00"
    },
    {
      "id": "01920001-…",
      "entityType": "counseling_activity",
      "entityId": null,
      "action": "counseling case accessed",
      "beforeState": null,
      "afterState": null,
      "actor": { "userId": null, "fullName": null, "role": "CNP" },
      "correlationId": null,
      "occurredAt": "2026-08-04T09:14:00+06:00"
    }
  ],
  "nextCursor": null,
  "counselingEntriesRedacted": true
}
```

**The second item is the shape every counseling entry takes.** FR-ADM-06 requires the viewer to exclude all counseling case content and show counseling entries only as non-identifying activity records: no case identifier, no student identifier, no actor identity, no correlation ID that could be joined to anything. `entityId`, `actor.userId` and `actor.fullName` are null by construction, not filtered on read (BR-50, BR-52, PRM-09).

`counselingEntriesRedacted: true` states the guarantee in the payload so it is testable.

**Validation** — `to` ≥ `from`; range ≤ 90 days.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `INVALID_DATE_RANGE` | 422 | Range invalid or over 90 days | "Choose a date range of up to 90 days." |

**Status Codes** — `200`, `401`, `403`, `422`.

---

### GET /api/v1/admin/authz-denials

**Purpose** — Denied authorization attempts, with actor, resource, operation and timestamp (PRM-12).

**Authentication** — `Session + Role(ADM)`.

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `actorId` | uuid | no | — |
| `resource` | string | no | — |
| `from` / `to` | timestamptz | no | Defaults to the last 7 days; range ≤ 90 days |
| `limit` / `cursor` | — | no | §0.8 |

**Response Body**

```json
{
  "items": [
    {
      "id": "01920100-…",
      "actor": { "userId": "0191f0cc-…", "fullName": "DIU IT", "attemptedRole": "ADM" },
      "resource": "counseling_case",
      "operation": "read",
      "reason": "not_on_clinical_roster",
      "sourceAddress": "10.20.3.44",
      "correlationId": "01J8ZR22NN10QQ",
      "occurredAt": "2026-08-04T09:40:00+06:00"
    }
  ],
  "nextCursor": null
}
```

A denial names the **resource type** attempted, never a resource identifier. EC-45 requires an Administrator's attempt to view counseling content to be denied and logged — and the log of that denial must not itself reveal which case was targeted, or the log becomes the leak.

Kept separate from `audit_log` deliberately: potentially high volume under attack, different retention, different query pattern.

**Validation** — `to` ≥ `from`; range ≤ 90 days.

**Error Responses** — universal set, plus `INVALID_DATE_RANGE` (422).

**Status Codes** — `200`, `401`, `403`, `422`.

---

### GET /api/v1/admin/data-access-log

**Purpose** — Records of access to a student's personal data by a non-owning user (FR-AUD-03, NFR-SEC-05).

**Authentication** — `Session + Role(ADM)`.

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `accessorId` | uuid | no | — |
| `subjectId` | uuid | no | — |
| `dataCategory` | string | no | e.g. `appointment`, `payment`, `account` |
| `from` / `to` | timestamptz | no | Defaults to the last 7 days; range ≤ 90 days |

**Response Body**

```json
{
  "items": [
    {
      "id": "01920200-…",
      "accessor": { "userId": "0191f0aa-…", "fullName": "Farhana Akter", "role": "MCS" },
      "subject": { "userId": "0191f3c2-…", "studentRef": "221-15-5678" },
      "dataCategory": "appointment",
      "correlationId": "01J8ZQ7K4M9X2P",
      "occurredAt": "2026-08-04T10:22:00+06:00"
    }
  ],
  "nextCursor": null
}
```

`dataCategory` never takes a counseling value. Counseling reads are logged inside the vault, in a log this endpoint cannot reach (FR-AUD-04, BR-51).

**Validation** — `to` ≥ `from`; range ≤ 90 days.

**Error Responses** — universal set, plus `INVALID_DATE_RANGE` (422).

**Status Codes** — `200`, `401`, `403`, `422`.

---

### POST /api/v1/admin/break-glass

**Purpose** — Request emergency access to restricted data, requiring a free-text justification of not fewer than 20 characters (FR-AUD-05, PRM-14).

**Authentication** — `Session + Role(ADM)`. Break-glass is available to the System Administrator role and to no other.

**Request Body**

```json
{
  "justification": "Serious incident reported by the Proctor's office at 14:20; the counseling service head is unreachable and the incident team needs to confirm whether a case exists.",
  "scope": "counseling"
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `justification` | string | yes | FR-AUD-05 — **minimum 20 characters** after trimming |
| `scope` | enum | yes | `counseling` — the only restricted scope in Phase 1 |

**Response Body**

```json
{
  "grantId": "01920300-…",
  "scope": "counseling",
  "grantedAt": "2026-08-04T14:25:00+06:00",
  "expiresAt": "2026-08-04T15:25:00+06:00",
  "durationMinutes": 60,
  "renewable": false,
  "serviceHeadNotifiedAt": "2026-08-04T14:25:03+06:00",
  "notice": "This access is recorded, time-limited to 60 minutes, and the counseling service head has been alerted. It cannot be extended without a new justification."
}
```

| Field | Type | Notes |
|---|---|---|
| `renewable` | boolean | Constant `false`. Renewal requires a **new** justification and a new grant (FR-AUD-07) |
| `serviceHeadNotifiedAt` | timestamptz | FR-AUD-06 — the notification is immediate and is not suppressible |

The grant records to `audit.break_glass_grant`. Every read performed under it is additionally logged inside the vault with `was_break_glass: true` (FR-CSE-15).

**Validation** — FR-AUD-05 justification ≥20 characters; the caller holds `ADM`; `expires_at` is at most 60 minutes after `granted_at` (`ck_break_glass_duration`).

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `JUSTIFICATION_TOO_SHORT` | 422 | Under 20 characters (FR-AUD-05) | "Explain why this access is needed, in at least 20 characters. This is recorded and the counseling service head is told." |
| `GRANT_ALREADY_ACTIVE` | 409 | An unexpired grant exists for this administrator and scope | "You already have emergency access until 3:25 PM." |

**Status Codes** — `201`, `401`, `403`, `409`, `422`.

---

### GET /api/v1/admin/break-glass

**Purpose** — List break-glass grants, active and historical (FR-AUD-06).

**Authentication** — `Session + Role(ADM)`.

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `activeOnly` | boolean | no | Defaults to `false` |
| `from` / `to` | timestamptz | no | Defaults to the last 90 days |

**Response Body**

```json
{
  "items": [
    {
      "grantId": "01920300-…",
      "administrator": { "userId": "0191f0cc-…", "fullName": "DIU IT" },
      "justification": "Serious incident reported by the Proctor's office at 14:20; …",
      "scope": "counseling",
      "grantedAt": "2026-08-04T14:25:00+06:00",
      "expiresAt": "2026-08-04T15:25:00+06:00",
      "revokedAt": null,
      "isActive": true,
      "serviceHeadNotifiedAt": "2026-08-04T14:25:03+06:00"
    }
  ]
}
```

The list shows **that** access was granted and why it was claimed to be needed. It does not show what was read — those records live in the vault's own access log, readable only by Counseling Professionals and the service head (FR-CSE-16). An administrator can see their own break-glass history; they cannot see the trail of what it touched.

**Validation** — `to` ≥ `from`.

**Error Responses** — universal set only.

**Status Codes** — `200`, `401`, `403`, `422`.

---

### DELETE /api/v1/admin/break-glass/{id}

**Purpose** — Revoke an active break-glass grant before its expiry.

**Authentication** — `Session + Role(ADM)`.

**Request Body**

```json
{ "reason": "Incident resolved; access no longer required" }
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `reason` | string | yes | VR-93 |

**Response Body**

```json
{ "grantId": "01920300-…", "revokedAt": "2026-08-04T14:52:00+06:00", "isActive": false }
```

Sets `revoked_at`; **the grant row is not deleted** — it is an audit record and shares the append-only guarantee of the module (BR-61). The route is `DELETE` because it ends the grant's effect, not because it removes anything.

**Validation** — VR-93; the grant is currently active.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `GRANT_NOT_ACTIVE` | 409 | Already expired or revoked | "That access has already ended." |

**Status Codes** — `200`, `401`, `403`, `404`, `409`, `422`.

---
# Part 10 — Module CNS *(vault)*
### Counseling Intake & Crisis Safety

Covers FR-CNS-01…17, VR-70…VR-75, VR-80, BR-45…BR-48, BR-53, BR-56, EC-36…EC-43, EC-47. Base path **`/counseling/api/v1`**.

> **All endpoints in Parts 10 and 11 are subject to sign-off by DIU counseling professionals before implementation (ASM-09, OI-01).** This document specifies the *mechanism*. The clinical content of crisis messaging and escalation is supplied by [R3] DIU-CP-01, not by the development team (FR-CSE-19, CON-15). **Every user-facing message string in these two parts is draft copy pending that review** (CON-04, NFR-USE-07).

**Module-wide rules.**

1. **Separate service, separate authority.** These routes are served by the Counseling Service (deployable 2), which holds credential set B. It validates the session with Core IAM but **does not trust the role claim** — every request is checked against `counseling.clinical_roster` or against ownership (ADR-012, NFR-SEC-06, ARCHITECTURE §7.4).
2. **When `counseling.enabled` is off, every route here returns `404`** — the service is not running (BR-68, ARCHITECTURE §3.4). A `403` would confirm the routes exist.
3. **The service refuses to start without [R3].** The crisis protocol content is a deployment gate, not a reminder (OI-01, EC-48, BR-68).
4. **Every read writes `clinical_audit.counseling_access_log`** — including list reads and reads that end in `404` (FR-CSE-15, BR-51).
5. **Nothing crosses to Core.** `CounselingRequestSubmitted` and every other counseling event stay on the vault's own bus. If they entered the Core bus, any Core subscriber could infer the existence of a counseling record (BR-50, ARCHITECTURE §5.5).
6. **No penalty exists anywhere in this module.** There is no no-show counter, no booking restriction and no negative consequence for a missed counseling session — the absence is the requirement (FR-CNS-17, EC-42).

---

### GET /counseling/api/v1/crisis-resources

**Purpose** — Serve the crisis-resources banner content from [R3], to every counseling screen, including for unauthenticated visitors (FR-CNS-03, FR-CNS-04, BR-47).

**Authentication** — `None`. This is deliberate and non-negotiable: someone in crisis must not have to sign in first.

**Request Body** — none.

**Response Body**

```json
{
  "protocolVersion": "DIU-CP-01-r3",
  "bannerTitle": "Need help now?",
  "resources": [
    { "label": "DIU Counseling Centre", "phone": "+880-…", "hours": "Sun–Thu, 9:00 AM – 5:00 PM" },
    { "label": "National emergency", "phone": "999", "hours": "24 hours" }
  ],
  "notEmergencyServiceNotice": "This service is not an emergency service. Requests are reviewed during office hours only. If you need help immediately, use the contacts above.",
  "displayRule": "above_the_fold_all_viewports"
}
```

| Field | Type | Notes |
|---|---|---|
| `protocolVersion` | string | Which revision of [R3] this content came from. Recorded against acknowledgements so we can always say what a given student was shown |
| `displayRule` | string | FR-CNS-04 — the banner must be visible without scrolling on the initial view of every counseling screen, at all supported viewport widths (CON-15). Carried as data so the requirement travels with the content |
| `notEmergencyServiceNotice` | string | FR-CNS-05 — shown at the point of request submission, before submission is possible |

**Validation** — none.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `CRISIS_PROTOCOL_UNAVAILABLE` | 503 | [R3] content missing — the service should not have started (EC-48) | "We can't show this page right now. If you need help immediately, contact the DIU Counseling Centre or call 999." |

Note the 503 message still carries a route to help. A blank error page here would be a safety failure.

**Status Codes** — `200`, `503`.

---

### GET /counseling/api/v1/categories

**Purpose** — The configurable counseling category list offered at intake (VR-70, FR-CNS-07).

**Authentication** — `Session`.

**Request Body** — none.

**Response Body**

```json
{
  "items": [
    { "id": "01921000-…", "code": "ACADEMIC_STRESS", "label": "Academic stress", "sortOrder": 10 },
    { "id": "01921001-…", "code": "RELATIONSHIPS", "label": "Relationships", "sortOrder": 20 }
  ],
  "urgencyScale": [
    { "value": "routine", "label": "I'd like to talk when someone is free" },
    { "value": "soon", "label": "I'd like to talk soon" },
    { "value": "urgent", "label": "I need to talk as soon as possible" }
  ]
}
```

`urgencyScale` is the configured scale required by VR-71. Selecting `urgent` triggers the interstitial gate of FR-CNS-06 — see the next endpoint.

**Validation** — none.

**Error Responses** — universal set only.

**Status Codes** — `200`, `401`, `404`.

---

### POST /counseling/api/v1/crisis-acknowledgements

**Purpose** — Record that the crisis interstitial was displayed and acknowledged, before a highest-urgency request can be accepted (FR-CNS-06, VR-75, EC-37).

**Authentication** — `Session + Role(STU)`.

**Why this is its own endpoint.** VR-75 states the rule is *"not enforceable by the interface alone"* and must be rejected at the server. A boolean flag on the submit request would be trivially forgeable and would prove nothing. A separate, short-lived, single-use acknowledgement record is server-side proof that the interstitial was actually served to this student, at a known time, from a known revision of [R3].

**Request Body**

```json
{
  "urgencyShown": "urgent",
  "protocolVersion": "DIU-CP-01-r3",
  "chosenPath": "continue_with_request"
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `urgencyShown` | enum | yes | `routine` \| `soon` \| `urgent` — the level that triggered the interstitial |
| `protocolVersion` | string | yes | Must match the version currently served by `GET /crisis-resources` |
| `chosenPath` | enum | yes | `contact_immediately` \| `continue_with_request` — FR-CNS-06 requires two explicit paths |

**Response Body**

```json
{
  "acknowledgementId": "01921100-…",
  "urgencyShown": "urgent",
  "protocolVersion": "DIU-CP-01-r3",
  "acknowledgedAt": "2026-08-04T16:02:00+06:00",
  "expiresAt": "2026-08-04T16:32:00+06:00",
  "singleUse": true
}
```

Short-lived (30 minutes) and single-use — it cannot be stored and replayed later against a different request. Consumption is recorded in `consumed_by_request`.

Recording `chosenPath: "contact_immediately"` creates the acknowledgement but implies no request; the student may leave without submitting anything, and nothing partial is stored (EC-38).

**Validation** — `protocolVersion` matches the currently served revision; `urgencyShown` and `chosenPath` are valid enum values.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `PROTOCOL_VERSION_STALE` | 409 | The displayed revision is no longer current | "Some of this information has been updated. Please read it again before continuing." |
| `CRISIS_PROTOCOL_UNAVAILABLE` | 503 | [R3] content missing | "We can't continue right now. If you need help immediately, contact the DIU Counseling Centre or call 999." |

**Status Codes** — `201`, `401`, `403`, `404`, `409`, `503`.

---

### POST /counseling/api/v1/requests

**Purpose** — Submit a counseling request (FR-CNS-07, FR-CNS-08).

**Authentication** — `Session + Role(STU)`. Matrix: *Counseling request (own) — STU: C R U(withdraw) own*, **every other role including `ADM` is `—`**.

**Request Body**

```json
{
  "categoryId": "01921000-…",
  "selfReportedUrgency": "urgent",
  "note": "I've been struggling to sleep and keep up with coursework for a few weeks.",
  "preferredWindows": [
    { "date": "2026-08-06", "fromTime": "14:00", "toTime": "17:00" }
  ],
  "counselorGenderPreference": "female",
  "crisisAcknowledgementId": "01921100-…"
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `categoryId` | uuid | yes | VR-70 — mandatory, from the configured list |
| `selfReportedUrgency` | enum | yes | VR-71 — mandatory, from the configured scale |
| `note` | string ≤1000 | no | VR-72 — optional, maximum 1000 characters |
| `preferredWindows[]` | array | yes | VR-73 — at least one; each must be in the future |
| `counselorGenderPreference` | enum | no | `no_preference` (default) \| `female` \| `male` (SI-7) |
| `crisisAcknowledgementId` | uuid | conditional | VR-75 — **required when `selfReportedUrgency` is `urgent`** |

**Only category and urgency are mandatory** (FR-CNS-08) — with the exception that at least one preferred window is required by VR-73, and the crisis acknowledgement is required by VR-75 at the highest urgency. The form asks for no more than the fields listed here (FR-CNS-07).

**Response Body**

```json
{
  "requestId": "01921200-…",
  "status": "requested",
  "submittedAt": "2026-08-04T16:05:00+06:00",
  "acknowledgementDispatchedAt": "2026-08-04T16:05:12+06:00",
  "triageSlaNote": "A counsellor will review this within one working day.",
  "officeHoursNote": "Requests are reviewed during office hours, Sunday to Thursday, 9:00 AM – 5:00 PM.",
  "crisisResourcesRestated": true,
  "priorityIsProvisional": true
}
```

| Field | Type | Notes |
|---|---|---|
| `acknowledgementDispatchedAt` | timestamptz | FR-CNS-10, BR-46 — an automatic acknowledgement is dispatched **within 1 minute**, restating the triage SLA and the crisis resources |
| `officeHoursNote` | string | EC-36 — a request submitted outside office hours is accepted and acknowledged, and the acknowledgement restates the limitation. **No implication of monitoring is created** |
| `priorityIsProvisional` | boolean | Constant `true` at submission. The student's self-reported urgency is an **input to triage only** and never sets final priority (FR-CNS-09, BR-45) |

The response deliberately carries **no priority value, no triage reasoning and no counselor identity** — none of that is ever exposed to the student (FR-CNS-12, BR-49).

**Validation** — VR-70 category; VR-71 urgency; VR-72 note ≤1000 characters (**truncate with a visible counter, never silently discard**); VR-73 at least one future window; VR-74 no existing request in `requested` or `under_review`; VR-75 crisis acknowledgement present, valid, unexpired and unconsumed when urgency is `urgent`.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `EXISTING_REQUEST_OPEN` | 409 | VR-74 / EC-39. `error.details.existingRequest` carries its id, status and submission date | "You already have a request with us — we've received it and it's being reviewed. You can see its status below." |
| `CRISIS_ACKNOWLEDGEMENT_REQUIRED` | 422 | VR-75 — `urgent` without a valid acknowledgement | "Please take a moment to read the support information before we continue." |
| `CRISIS_ACKNOWLEDGEMENT_EXPIRED` | 422 | VR-75 — expired or already consumed | "Please read the support information again before continuing." |
| `PREFERRED_WINDOW_IN_PAST` | 422 | VR-73 | "Choose a time window in the future." |
| `VALIDATION_FAILED` | 422 | VR-70 / VR-71 missing | "Choose a category and let us know how soon you'd like to talk." |

**On the wording of `EXISTING_REQUEST_OPEN`.** EC-39 requires that this **must not read as a rebuke**, and ARCHITECTURE §10.3 gives the worked example. The rejected phrasing — *"Duplicate request rejected. Constraint violation: one active request per subject."* — is technically accurate and completely wrong for the person reading it. This message, and every message in Parts 10 and 11, is reviewed by a counseling professional before release (CON-04, NFR-USE-07).

**Status Codes** — `201`, `401`, `403`, `404`, `409`, `422`, `503`.

---

### GET /counseling/api/v1/me/requests

**Purpose** — The student's own counseling requests and their current status (FR-CNS-11, BR-63). This is the call the client makes to fill the dashboard panel Core cannot supply (§0.11, §2.1).

**Authentication** — `Session + Own`.

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `scope` | enum | no | `open` (default) \| `all` |

**Response Body**

```json
{
  "items": [
    {
      "requestId": "01921200-…",
      "category": "Academic stress",
      "status": "under_review",
      "submittedAt": "2026-08-04T16:05:00+06:00",
      "statusMessage": "A counsellor is reviewing your request.",
      "canWithdraw": true,
      "upcomingSession": {
        "sessionId": "01921300-…",
        "scheduledFor": "2026-08-07T15:00:00+06:00",
        "durationMinutes": 45,
        "mode": "in_person",
        "location": "Counseling Centre, Room 4",
        "confirmationRequired": true,
        "studentConfirmedAt": null
      }
    }
  ]
}
```

| Field | Type | Notes |
|---|---|---|
| `status` | enum | `requested` \| `under_review` \| `scheduled` \| `withdrawn` \| `declined` |
| `statusMessage` | string | Plain-language rendering of the status. **Draft copy pending counseling review** |
| `canWithdraw` | boolean | True only while `requested` or `under_review` (VR-80) |

**What is never present in this response:** priority, triage reasoning, counselor commentary, case notes, counselor name or specialisation, SLA timers, or any internal case identifier (FR-CNS-12, BR-49). A student sees that their request exists and where it is — nothing about how it is being judged.

Writes `clinical_audit.counseling_access_log` with `access_kind: "request_read"`.

**Validation** — none.

**Error Responses** — universal set only.

**Status Codes** — `200`, `401`, `403`, `404`.

---

### GET /counseling/api/v1/me/requests/{id}

**Purpose** — One of the student's own requests in detail (FR-CNS-11).

**Authentication** — `Session + Own`.

**Request Body** — none.

**Response Body** — a single item object as above, plus the submitted `note`, `preferredWindows[]` and `counselorGenderPreference` echoed back so the student can see what they told us.

Writes `clinical_audit.counseling_access_log`.

**Validation** — none.

**Error Responses** — universal set only. **A request belonging to another student returns `404`**, never `403` — a 403 would confirm that a counseling record exists for someone (BR-50, §0.4 rule 2).

**Status Codes** — `200`, `401`, `403`, `404`.

---

### POST /counseling/api/v1/me/requests/{id}/withdraw

**Purpose** — Withdraw a request, at any time before it reaches `scheduled` status (FR-CNS-13, BR-56).

**Authentication** — `Session + Own`.

**Request Body**

```json
{ "note": "I've been able to sort things out, thank you." }
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `note` | string ≤500 | no | Optional. **Never required** — a student withdrawing should not have to justify it |

**Response Body**

```json
{
  "requestId": "01921200-…",
  "status": "withdrawn",
  "withdrawnAt": "2026-08-05T09:14:00+06:00",
  "message": "Your request has been withdrawn. You're welcome to get in touch again whenever you'd like."
}
```

**Validation** — VR-80 — permitted only while status is `requested` or `under_review`.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `WITHDRAWAL_NOT_PERMITTED` | 409 | VR-80 / EC-43 — a session has already been scheduled | "A session has already been arranged for you. Please contact the Counseling Centre and they'll help — they can cancel it on your behalf." |

EC-43 requires exactly this: rejection, with the student directed to contact the service, and the counselor able to cancel on their behalf.

**Status Codes** — `200`, `401`, `403`, `404`, `409`.

---

### GET /counseling/api/v1/me/sessions

**Purpose** — The student's own scheduled counseling sessions (FR-CNS-14, FR-CNS-16).

**Authentication** — `Session + Own`.

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `scope` | enum | no | `upcoming` (default) \| `past` \| `all` |

**Response Body**

```json
{
  "items": [
    {
      "sessionId": "01921300-…",
      "scheduledFor": "2026-08-07T15:00:00+06:00",
      "durationMinutes": 45,
      "mode": "in_person",
      "location": "Counseling Centre, Room 4",
      "studentConfirmedAt": null,
      "canConfirm": true,
      "canDecline": true,
      "outcome": null
    }
  ]
}
```

`outcome` may be `attended`, `missed` or `cancelled` on past sessions. **A `missed` outcome carries no consequence of any kind** — there is no penalty field here because there is no penalty in the system (FR-CNS-17, EC-42). The counselor may simply re-schedule.

The counselor's name and specialisation are **not** returned — BR-53 and FR-NTF-05 keep counselor identity out of student-facing surfaces and notifications alike.

Writes `clinical_audit.counseling_access_log`.

**Validation** — none.

**Error Responses** — universal set only.

**Status Codes** — `200`, `401`, `403`, `404`.

---

### POST /counseling/api/v1/me/sessions/{id}/confirm

**Purpose** — Confirm attendance at a scheduled session (FR-CNS-16).

**Authentication** — `Session + Own`.

**Request Body** — none.

**Response Body**

```json
{
  "sessionId": "01921300-…",
  "studentConfirmedAt": "2026-08-05T10:02:00+06:00",
  "message": "Thanks — we've let the Counseling Centre know you'll be there."
}
```

**Validation** — the session is in the future and has no recorded outcome.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `SESSION_NOT_PENDING` | 409 | Already passed or has an outcome | "That session has already taken place." |

**Status Codes** — `200`, `401`, `403`, `404`, `409`.

---

### POST /counseling/api/v1/me/sessions/{id}/decline

**Purpose** — Decline a scheduled session (FR-CNS-16).

**Authentication** — `Session + Own`.

**Request Body**

```json
{ "note": "I have an exam at that time." }
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `note` | string ≤500 | no | Optional. Never required |

**Response Body**

```json
{
  "sessionId": "01921300-…",
  "declinedAt": "2026-08-05T10:04:00+06:00",
  "requestStatus": "under_review",
  "penaltyApplied": false,
  "message": "That's no problem — the Counseling Centre will be in touch to arrange another time."
}
```

`penaltyApplied` is a constant `false`. FR-CNS-17 forbids any no-show penalty, booking restriction or negative consequence, and declining in advance is the behaviour we want to make easy, not costly.

The parent request returns to `under_review` so it re-enters the counselor's queue rather than being lost.

**Validation** — the session is in the future and has no recorded outcome.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `SESSION_NOT_PENDING` | 409 | Already passed or has an outcome | "That session has already taken place. Contact the Counseling Centre to arrange another." |

**Status Codes** — `200`, `401`, `403`, `404`, `409`.

---

## 10.11 Counselor availability

The permission matrix places *Counseling availability* at `MCS: R U` and `ADM: R U`, with `CNP: R` and students `R`. These two endpoints are therefore the **only** vault routes reachable by a non-counselor staff role — and they touch no request, case, note or student record of any kind. FR-CNS-01 assigns counselor profile and availability maintenance to Medical Center Staff or an Administrator; PRM-05 simultaneously forbids those roles any access to counseling requests, cases, notes, or the fact of their existence. Both hold, because availability is a published timetable, not clinical data.

### GET /counseling/api/v1/counselor-availability

**Purpose** — Published counselor availability, displayed to students as **windows of availability, not individually bookable slots** (FR-CNS-02).

**Authentication** — `Session`.

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `from` / `to` | date | no | Defaults to today through +14 days |

**Response Body**

```json
{
  "windows": [
    { "date": "2026-08-06", "fromTime": "14:00", "toTime": "17:00", "mode": "in_person" },
    { "date": "2026-08-07", "fromTime": "10:00", "toTime": "13:00", "mode": "in_person" }
  ],
  "displayNote": "These are the times the service is generally available. You'll be offered a specific time after your request is reviewed.",
  "officeHours": "Sunday to Thursday, 9:00 AM – 5:00 PM"
}
```

**No counselor name, no counselor identity, no per-counselor breakdown and no slot count.** [R1] §13.7 and FR-CNS-02 require windows rather than bookable slots — presenting individually bookable slots would turn a clinical triage process into a self-service booking queue, which is not what this service is.

**Validation** — `to` ≥ `from`.

**Error Responses** — universal set only.

**Status Codes** — `200`, `401`, `404`, `422`.

---

### PUT /counseling/api/v1/counselor-availability

**Purpose** — Maintain published availability windows (FR-CNS-01).

**Authentication** — `Session + Role(MCS)` or `Session + Role(ADM)`, per the permission matrix. A `CNP` caller has read access only; changing the published timetable is an administrative act.

**Request Body**

```json
{
  "windows": [
    { "date": "2026-08-06", "fromTime": "14:00", "toTime": "17:00", "mode": "in_person" },
    { "date": "2026-08-07", "fromTime": "10:00", "toTime": "13:00", "mode": "in_person" }
  ],
  "version": 7
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `windows[]` | array | yes | Each: `date` not in the past, `toTime` strictly after `fromTime`, `mode` one of `in_person` \| `online` |
| `version` | integer | yes | VR-92 |

A full replace of the forward window set, for the same reason as store hours: a timetable is one coherent object.

**Response Body** — the stored window set with an incremented `version`.

**Validation** — each window's times ordered and date not in the past; VR-92.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `INVALID_WINDOW` | 422 | End at or before start, or a date in the past | "Each availability window needs an end time after its start time, on today's date or later." |
| `CONFLICT_STALE_VERSION` | 409 | VR-92 | See §0.6 |

**Status Codes** — `200`, `401`, `403`, `404`, `409`, `422`.

---
# Part 11 — Module CSE *(vault)*
### Counseling Triage & Case Management

Covers FR-CSE-01…23, VR-76…VR-79, BR-45, BR-49…BR-52, BR-57, BR-67, EC-40…EC-46. Base path **`/counseling/api/v1`**.

> Subject to sign-off by DIU counseling professionals before implementation (ASM-09, OI-01). All user-facing copy here is draft pending that review.

**Module-wide rules.**

1. **Every endpoint is `Session + ClinicalRoster`.** The vault validates the session with Core IAM, then checks the subject against `counseling.clinical_roster` independently. A forged `CNP` claim from a compromised IAM is still refused, because the subject has no row on the roster (ADR-012, NFR-SEC-06, ARCHITECTURE §7.4).
2. **Every read writes `clinical_audit.counseling_access_log`** — case reads, note reads, timeline reads, list reads, export reads, and reads that end in `404`. FR-CSE-15 says *every* read access, and a 404 is an access attempt that reveals a fact (BR-51).
3. **No role other than Counseling Professional can reach any of this, including System Administrator** — and an administrator's only path is break-glass, which alerts the counseling service head (FR-CSE-13, PRM-08, PRM-14, EC-45).
4. **No clinical judgement is encoded, inferred or automated.** Priority is set by a person, escalation is invoked by a person (FR-CSE-19, BR-67, CON-15). The single permitted system-actor transition in the whole module is the 90-day auto-close of FR-CSE-21.
5. **Requests go to a shared pool, not to an individual** in Phase 1 (FR-CSE-22, OI-20).

---

### GET /counseling/api/v1/triage-queue

**Purpose** — The triage queue: all requests, sorted by priority descending then waiting time descending, with SLA breaches visually distinguishable (FR-CSE-01, FR-CSE-02).

**Authentication** — `Session + ClinicalRoster`.

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `slaState` | enum | no | `all` (default) \| `breached` \| `due_soon` |
| `priority` | enum | no | `normal` \| `priority` \| `urgent` |
| `limit` / `cursor` | — | no | §0.8 |

**Response Body**

```json
{
  "items": [
    {
      "requestId": "01921200-…",
      "caseId": "01921400-…",
      "category": "Academic stress",
      "selfReportedUrgency": "urgent",
      "finalPriority": "urgent",
      "priorityIsProvisional": true,
      "counselorGenderPreference": "female",
      "submittedAt": "2026-08-04T16:05:00+06:00",
      "waitingHours": 19,
      "triageDueAt": "2026-08-05T17:00:00+06:00",
      "slaState": "due_soon",
      "hasCrisisAcknowledgement": true,
      "status": "requested"
    }
  ],
  "nextCursor": null,
  "poolNote": "Requests are held in a shared pool and are not assigned to an individual counsellor."
}
```

| Field | Type | Notes |
|---|---|---|
| `selfReportedUrgency` | enum | Shown as an **input to triage only**. It never sets final priority (FR-CNS-09, BR-45) |
| `priorityIsProvisional` | boolean | `true` until a Counseling Professional confirms or changes it (FR-CSE-04) |
| `counselorGenderPreference` | enum | Honoured as a **visible attribute, without enforcement** (FR-CSE-23, SI-7) |
| `slaState` | enum | `within` \| `due_soon` \| `breached`. SLAs: `urgent` same working day, `priority` 2 working days, `normal` 5 working days (FR-CSE-07, OI-12) |
| `hasCrisisAcknowledgement` | boolean | Whether the FR-CNS-06 interstitial was served and acknowledged |

Breached requests are flagged here and notified daily to all Counseling Professionals (FR-CSE-09, EC-40). Where no counselor is available for an extended period, breaches accumulate and remain visible — **Phase 1 provides no automatic escalation beyond notification**, which is an organisational gap recorded as OI-22, not a defect in this API (EC-41).

Writes `clinical_audit.counseling_access_log` with `access_kind: "list_read"`.

**Validation** — none.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `NOT_ON_CLINICAL_ROSTER` | 403 | The caller is not an active member of `counseling.clinical_roster`, whatever role claim their session carries. Logged as a security event | "You don't have access to this area." |

**Status Codes** — `200`, `401`, `403`, `404`.

---

### GET /counseling/api/v1/requests/{id}

**Purpose** — One request in full, for triage (FR-CSE-01).

**Authentication** — `Session + ClinicalRoster`.

**Request Body** — none.

**Response Body**

```json
{
  "requestId": "01921200-…",
  "caseId": "01921400-…",
  "studentRefId": "0191f3c2-…",
  "category": "Academic stress",
  "selfReportedUrgency": "urgent",
  "note": "I've been struggling to sleep and keep up with coursework for a few weeks.",
  "preferredWindows": [ { "date": "2026-08-06", "fromTime": "14:00", "toTime": "17:00" } ],
  "counselorGenderPreference": "female",
  "crisisAcknowledgement": {
    "acknowledgedAt": "2026-08-04T16:02:00+06:00",
    "protocolVersion": "DIU-CP-01-r3",
    "chosenPath": "continue_with_request"
  },
  "status": "requested",
  "triageDueAt": "2026-08-05T17:00:00+06:00",
  "version": 1
}
```

`studentRefId` is the Core account identifier, carried with **no foreign key** — `identity.user_account` lives in another database, and that is the point (DATABASE P10, ADR-001).

Writes `clinical_audit.counseling_access_log` with `access_kind: "request_read"`.

**Validation** — none.

**Error Responses** — universal set, plus `NOT_ON_CLINICAL_ROSTER` (403).

**Status Codes** — `200`, `401`, `403`, `404`.

---

### POST /counseling/api/v1/requests/{id}/priority

**Purpose** — Set the final priority of a request. **Only a Counseling Professional may do this** (FR-CSE-05, BR-45).

**Authentication** — `Session + ClinicalRoster`.

**Request Body**

```json
{
  "toPriority": "priority",
  "reason": "Student describes sustained sleep disruption but has support at home and no immediate risk indicators",
  "version": 1
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `toPriority` | enum | yes | FR-CSE-03 — `normal` \| `priority` \| `urgent` |
| `reason` | string | yes | VR-76, VR-93 — mandatory, ≥10 characters, recorded in the audit trail (FR-CSE-06) |
| `version` | integer | yes | VR-92 |

**Response Body**

```json
{
  "caseId": "01921400-…",
  "fromPriority": "urgent",
  "toPriority": "priority",
  "priorityIsProvisional": false,
  "triageDueAt": "2026-08-06T17:00:00+06:00",
  "changedBy": { "rosterId": "01921500-…", "displayName": "S. Karim" },
  "changedAt": "2026-08-05T09:30:00+06:00",
  "status": "under_review"
}
```

Setting a priority clears `priorityIsProvisional` and recomputes `triageDueAt` from the new SLA (FR-CSE-04, FR-CSE-07). Every decision is recorded in `counseling.case_priority_change`, whose `changed_by` references `clinical_roster` — **a non-counselor has no row to reference and therefore cannot author one**, at the schema level.

**Validation** — VR-76 reason ≥10 characters; VR-92; the case is not `closed`, `withdrawn` or `declined`.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `CASE_CLOSED` | 409 | Terminal status | "This case is closed." |
| `VALIDATION_FAILED` | 422 | VR-76 | "Give a reason of at least 10 characters for the priority decision." |
| `NOT_ON_CLINICAL_ROSTER` | 403 | Not on the roster | "You don't have access to this area." |

**Status Codes** — `200`, `401`, `403`, `404`, `409`, `422`.

---

### POST /counseling/api/v1/requests/{id}/decline

**Purpose** — Decline a request, e.g. where the service is not the right fit and a referral is more appropriate (FR-CSE-10, terminal state `declined`).

**Authentication** — `Session + ClinicalRoster`.

**Request Body**

```json
{
  "reason": "Referred to the academic advising service, which is better placed to help with this",
  "studentMessage": "We've passed your request to Academic Advising, who are better placed to help. They'll be in touch.",
  "version": 2
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `reason` | string | yes | VR-93 — internal record, ≥10 characters. **Never shown to the student** |
| `studentMessage` | string ≤500 | no | Optional supportive message for the student. Reviewed copy |
| `version` | integer | yes | VR-92 |

**Response Body**

```json
{
  "requestId": "01921200-…",
  "status": "declined",
  "declinedAt": "2026-08-05T09:40:00+06:00",
  "notificationDispatched": true,
  "notificationTemplateKey": "CNS_UPDATE_AVAILABLE"
}
```

The student is notified through the **discreet template only** — the notification says an update is available and requires them to sign in to see it (FR-NTF-05, FR-NTF-06, BR-53). `reason` never leaves the vault (BR-49).

**Validation** — VR-93; VR-92; status is `requested` or `under_review`.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `INVALID_STATUS_TRANSITION` | 409 | Already terminal or scheduled | "This request has already moved on." |

**Status Codes** — `200`, `401`, `403`, `404`, `409`, `422`.

---

### GET /counseling/api/v1/cases

**Purpose** — The case list (FR-CSE-10).

**Authentication** — `Session + ClinicalRoster`.

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `status` | enum | no | `requested` \| `under_review` \| `scheduled` \| `session_completed` \| `follow_up_required` \| `closed` \| `withdrawn` \| `declined` |
| `priority` | enum | no | `normal` \| `priority` \| `urgent` |
| `openOnly` | boolean | no | Defaults to `true` |
| `limit` / `cursor` | — | no | §0.8 |

**Response Body**

```json
{
  "items": [
    {
      "caseId": "01921400-…",
      "requestId": "01921200-…",
      "category": "Academic stress",
      "finalPriority": "priority",
      "priorityIsProvisional": false,
      "status": "scheduled",
      "openedAt": "2026-08-04T16:05:00+06:00",
      "lastActivityAt": "2026-08-05T09:30:00+06:00",
      "daysSinceActivity": 0,
      "nextSessionAt": "2026-08-07T15:00:00+06:00",
      "version": 3
    }
  ],
  "nextCursor": null
}
```

Writes `clinical_audit.counseling_access_log` with `access_kind: "list_read"`.

**Validation** — none.

**Error Responses** — universal set, plus `NOT_ON_CLINICAL_ROSTER` (403).

**Status Codes** — `200`, `401`, `403`, `404`.

---

### GET /counseling/api/v1/cases/{id}

**Purpose** — One case in full (FR-CSE-10).

**Authentication** — `Session + ClinicalRoster | BreakGlass`.

**Request Body** — none.

**Response Body**

```json
{
  "caseId": "01921400-…",
  "requestId": "01921200-…",
  "studentRefId": "0191f3c2-…",
  "category": "Academic stress",
  "finalPriority": "priority",
  "priorityIsProvisional": false,
  "status": "scheduled",
  "openedAt": "2026-08-04T16:05:00+06:00",
  "lastActivityAt": "2026-08-05T09:30:00+06:00",
  "closedAt": null,
  "closureReason": null,
  "sessions": [
    {
      "sessionId": "01921300-…",
      "scheduledFor": "2026-08-07T15:00:00+06:00",
      "durationMinutes": 45,
      "mode": "in_person",
      "studentConfirmedAt": null,
      "outcome": null
    }
  ],
  "noteCount": 2,
  "escalationCount": 0,
  "version": 3
}
```

`noteCount` is a count; note bodies come from the notes endpoint, which logs its own access separately (FR-CSE-15).

**When served under break-glass**, the access log entry carries `was_break_glass: true`, and the grant's use is visible to Counseling Professionals and the service head in §11.16 — the people entitled to know their records were read (FR-AUD-05, FR-CSE-16).

Writes `clinical_audit.counseling_access_log` with `access_kind: "case_read"`.

**Validation** — none.

**Error Responses** — universal set, plus:

| Code | Status | Condition | Message |
|---|---|---|---|
| `NOT_ON_CLINICAL_ROSTER` | 403 | Not on the roster and no active break-glass grant. Logged (PRM-12, EC-45) | "You don't have access to this area." |
| `BREAK_GLASS_REQUIRED` | 403 | An `ADM` caller with no active grant | "This needs emergency access, which is recorded and alerts the counselling service head." |

**Status Codes** — `200`, `401`, `403`, `404`.

---

### GET /counseling/api/v1/cases/{id}/timeline

**Purpose** — The chronological timeline of every status change with actor and timestamp (FR-CSE-11).

**Authentication** — `Session + ClinicalRoster | BreakGlass`.

**Request Body** — none.

**Response Body**

```json
{
  "caseId": "01921400-…",
  "items": [
    {
      "fromStatus": null,
      "toStatus": "requested",
      "note": null,
      "changedBy": null,
      "isSystemAction": true,
      "changedAt": "2026-08-04T16:05:00+06:00"
    },
    {
      "fromStatus": "requested",
      "toStatus": "under_review",
      "note": "Priority set to Priority",
      "changedBy": { "rosterId": "01921500-…", "displayName": "S. Karim" },
      "isSystemAction": false,
      "changedAt": "2026-08-05T09:30:00+06:00"
    }
  ]
}
```

`changedBy` is null **only** where `isSystemAction` is true. BR-67 permits exactly one system-actor transition — the 90-day auto-close of FR-CSE-21 — plus the initial creation. Every other row names a human, enforced by `ck_transition_actor`.

Writes `clinical_audit.counseling_access_log` with `access_kind: "timeline_read"`.

**Validation** — none.

**Error Responses** — universal set, plus `NOT_ON_CLINICAL_ROSTER` (403).

**Status Codes** — `200`, `401`, `403`, `404`.

---

### POST /counseling/api/v1/cases/{id}/sessions

**Purpose** — Schedule a session against a case, specifying date, time, duration and location/mode (FR-CNS-14).

**Authentication** — `Session + ClinicalRoster`.

**Request Body**

```json
{
  "scheduledFor": "2026-08-07T15:00:00+06:00",
  "durationMinutes": 45,
  "mode": "in_person",
  "location": "Counseling Centre, Room 4",
  "outsideWindowReason": null,
  "version": 3
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `scheduledFor` | timestamptz | yes | VR-77 — must be in the future |
| `durationMinutes` | integer | no | 5–240. Defaults to 45 |
| `mode` | enum | no | `in_person` (default) \| `online` |
| `location` | string | no | Room or joining detail |
| `outsideWindowReason` | string \| null | conditional | VR-77, VR-93 — **required when `scheduledFor` falls outside a published availability window**, ≥10 characters |
| `version` | integer | yes | VR-92 |

**Response Body**

```json
{
  "sessionId": "01921300-…",
  "caseId": "01921400-…",
  "scheduledFor": "2026-08-07T15:00:00+06:00",
  "durationMinutes": 45,
  "mode": "in_person",
  "caseStatus": "scheduled",
  "notificationDispatched": true,
  "notificationTemplateKey": "CNS_UPDATE_AVAILABLE",
  "notificationContentDiscreet": true,
  "version": 1
}
```

FR-CNS-15 requires the student to be notified using discreet content per BR-53. The notification request crosses to Core carrying **a recipient and a template key, and nothing else** — no category, no urgency, no counselor identity, no free text (§12.2, ARCHITECTURE §2.4). Core never learns why the notification was sent.

The case moves to `scheduled`, which also closes the student's withdrawal path (VR-80, EC-43).

**Validation** — VR-77 future date and time, with a ≥10-character reason when outside a published window; VR-92; case not in a terminal status.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `SESSION_IN_PAST` | 422 | VR-77 | "Choose a date and time in the future." |
| `OUTSIDE_AVAILABILITY_WINDOW` | 422 | VR-77 — outside a published window with no reason | "That time is outside the published availability windows. Give a reason of at least 10 characters to schedule it anyway." |
| `CASE_CLOSED` | 409 | Terminal status | "This case is closed." |

**Status Codes** — `201`, `401`, `403`, `404`, `409`, `422`.

---

### PATCH /counseling/api/v1/cases/{id}/sessions/{sessionId}

**Purpose** — Reschedule or amend a scheduled session, including cancelling on a student's behalf (EC-43).

**Authentication** — `Session + ClinicalRoster`.

**Request Body**

```json
{
  "scheduledFor": "2026-08-08T11:00:00+06:00",
  "outsideWindowReason": null,
  "version": 1
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `scheduledFor` | timestamptz | no | VR-77 |
| `durationMinutes` | integer | no | 5–240 |
| `mode` / `location` | — | no | — |
| `outsideWindowReason` | string \| null | conditional | VR-77, VR-93 |
| `version` | integer | yes | VR-92 |

Rescheduling clears `studentConfirmedAt` — a student who confirmed one time has not confirmed another — and re-notifies through the discreet template.

**Response Body** — the updated session object.

**Validation** — VR-77; VR-92; the session has no recorded outcome.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `SESSION_ALREADY_CONCLUDED` | 409 | An outcome is recorded | "That session already has an outcome recorded." |
| `SESSION_IN_PAST` | 422 | VR-77 | "Choose a date and time in the future." |

**Status Codes** — `200`, `401`, `403`, `404`, `409`, `422`.

---

### POST /counseling/api/v1/cases/{id}/sessions/{sessionId}/outcome

**Purpose** — Record what happened at a session (FR-CSE-20, FR-CNS-17).

**Authentication** — `Session + ClinicalRoster`.

**Request Body**

```json
{ "outcome": "missed", "version": 2 }
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `outcome` | enum | yes | `attended` \| `missed` \| `cancelled` |
| `version` | integer | yes | VR-92 |

**Response Body**

```json
{
  "sessionId": "01921300-…",
  "outcome": "missed",
  "completedAt": "2026-08-07T15:45:00+06:00",
  "caseStatus": "follow_up_required",
  "penaltyApplied": false,
  "studentNotified": false,
  "note": "No penalty, suspension or restriction is applied for a missed session. The case remains open for rescheduling."
}
```

`penaltyApplied` is a constant `false`, and `note` states the rule in the payload. FR-CNS-17 and EC-42 are absolute: a student who misses a counseling session faces **no penalty, no suspension, no restriction**. The schema deliberately has no counter, no flag and no suspension linkage — the absence is the requirement.

`attended` moves the case to `session_completed`; `missed` and `cancelled` move it to `follow_up_required` so it stays in view for rescheduling.

**Validation** — VR-92; the session's scheduled time has passed; no outcome already recorded.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `SESSION_NOT_YET_DUE` | 409 | Scheduled time is in the future | "That session hasn't taken place yet." |
| `OUTCOME_ALREADY_RECORDED` | 409 | An outcome exists | "An outcome has already been recorded for that session." |

**Status Codes** — `200`, `401`, `403`, `404`, `409`, `422`.

---

### GET /counseling/api/v1/cases/{id}/notes

**Purpose** — Read confidential session notes (FR-CSE-12, FR-CSE-13).

**Authentication** — `Session + ClinicalRoster | BreakGlass`.

**Request Body** — none.

**Response Body**

```json
{
  "caseId": "01921400-…",
  "items": [
    {
      "noteId": "01921600-…",
      "caseSessionId": "01921300-…",
      "body": "…",
      "authoredBy": { "rosterId": "01921500-…", "displayName": "S. Karim" },
      "authoredAt": "2026-08-07T15:50:00+06:00"
    }
  ]
}
```

**Notes are readable only by users holding the Counseling Professional role.** No other role, including System Administrator, can read them by any means other than break-glass — which alerts the counseling service head (FR-CSE-13, BR-49, BR-52, PRM-08, PRM-14, EC-45).

Writes `clinical_audit.counseling_access_log` with `access_kind: "note_read"`, and `was_break_glass: true` where applicable.

**Validation** — none.

**Error Responses** — universal set, plus `NOT_ON_CLINICAL_ROSTER` (403) and `BREAK_GLASS_REQUIRED` (403).

**Status Codes** — `200`, `401`, `403`, `404`.

---

### POST /counseling/api/v1/cases/{id}/notes

**Purpose** — Record a confidential note against a case (FR-CSE-12).

**Authentication** — `Session + ClinicalRoster`. **Break-glass does not grant write access** — emergency read access exists so a genuine emergency is not blocked, not so that an administrator can author clinical content.

**Request Body**

```json
{
  "body": "…",
  "caseSessionId": "01921300-…"
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `body` | string | yes | VR-79 — maximum 5000 characters, non-empty after trimming |
| `caseSessionId` | uuid \| null | no | Links the note to a specific session |

**Response Body** — the created note object.

Authorship references `clinical_roster`, so a non-counselor **cannot author a row at all** — the constraint is structural, not a permission check that could be misconfigured.

**Validation** — VR-79 — ≤5000 characters, and **may not be submitted by a non-Counseling-Professional under any circumstance**; the case is not closed.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `NOT_ON_CLINICAL_ROSTER` | 403 | VR-79 — a non-CNP attempt. **Logged as a security event**, not merely refused | "You don't have access to this area." |
| `NOTE_TOO_LONG` | 422 | VR-79 — over 5000 characters | "Notes can be up to 5000 characters." |
| `CASE_CLOSED` | 409 | Case is closed | "This case is closed. Reopen it before adding notes." |

**Status Codes** — `201`, `401`, `403`, `404`, `409`, `422`.

---

### POST /counseling/api/v1/cases/{id}/close

**Purpose** — Close a case with a closure reason (FR-CSE-20).

**Authentication** — `Session + ClinicalRoster`.

**Request Body**

```json
{
  "closureReason": "Student reports improvement; agreed at the final session to close and re-refer if needed",
  "version": 5
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `closureReason` | string ≤500 | yes | VR-78 — mandatory |
| `version` | integer | yes | VR-92 |

**Response Body**

```json
{
  "caseId": "01921400-…",
  "status": "closed",
  "closedAt": "2026-08-14T11:20:00+06:00",
  "closureReason": "Student reports improvement; agreed at the final session to close and re-refer if needed",
  "closedBy": { "rosterId": "01921500-…", "displayName": "S. Karim" },
  "studentNotified": false,
  "version": 6
}
```

A case with no activity for 90 days is auto-closed with reason `Inactive`, notifying **the assigned Counseling Professional but not the student** (FR-CSE-21, EC-44, OI-19). That is the one system-actor transition BR-67 permits; it appears on the timeline with `isSystemAction: true`.

A student who graduates with an open case keeps that case accessible to Counseling Professionals until it is closed, even though their Core account is deactivated (EC-55). Retention thereafter is governed by OI-02.

**Validation** — VR-78 closure reason mandatory; VR-92; case not already closed.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `ALREADY_CLOSED` | 409 | Already closed | "This case is already closed." |
| `VALIDATION_FAILED` | 422 | VR-78 | "Give a closure reason." |

**Status Codes** — `200`, `401`, `403`, `404`, `409`, `422`.

---

### POST /counseling/api/v1/cases/{id}/escalations

**Purpose** — Invoke the escalation workflow defined in [R3], recording that it was invoked, by whom and when (FR-CSE-18, BR-57).

**Authentication** — `Session + ClinicalRoster`.

**Request Body**

```json
{
  "protocolVersion": "DIU-CP-01-r3",
  "note": "Escalation steps 1–3 followed; service head contacted by phone at 14:12."
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `protocolVersion` | string | yes | Which revision of [R3] was in force. The escalation steps are authored by DIU, not by the development team |
| `note` | string ≤2000 | no | Free-text record of what was done |

**Response Body**

```json
{
  "escalationId": "01921700-…",
  "caseId": "01921400-…",
  "invokedBy": { "rosterId": "01921500-…", "displayName": "S. Karim" },
  "protocolVersion": "DIU-CP-01-r3",
  "invokedAt": "2026-08-07T14:15:00+06:00",
  "automatedJudgement": false
}
```

`automatedJudgement` is a constant `false`, and `invoked_by` is a non-nullable reference to `clinical_roster`. **The system encodes, infers and automates no clinical judgement; escalation is invoked by a human Counseling Professional only** (FR-CSE-19, CON-15, BR-67). There is no endpoint, parameter or configuration in this API that triggers an escalation automatically, and adding one would violate a critical requirement.

This endpoint **records** an escalation. The escalation itself happens between people, following [R3].

**Validation** — `protocolVersion` non-empty; the case exists and is not `closed`.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `CASE_CLOSED` | 409 | Case is closed | "This case is closed. Reopen it first if an escalation is needed." |

**Status Codes** — `201`, `401`, `403`, `404`, `409`, `422`.

---

### GET /counseling/api/v1/me/caseload

**Purpose** — The Counseling Professional's caseload summary: open cases, requests pending triage, cases with overdue follow-up (FR-CSE-17).

**Authentication** — `Session + ClinicalRoster`.

**Request Body** — none.

**Response Body**

```json
{
  "openCases": 14,
  "requestsPendingTriage": 3,
  "slaBreached": 1,
  "slaDueWithinOneWorkingDay": 2,
  "overdueFollowUps": 2,
  "casesInactive60DaysPlus": 1,
  "asOf": "2026-08-05T09:00:00+06:00"
}
```

Counts across the **shared pool** — Phase 1 assigns each new request to a pool visible to all Counseling Professionals rather than to an individual (FR-CSE-22, OI-20), so "my caseload" is the service's caseload.

`casesInactive60DaysPlus` gives early warning of the 90-day auto-close (FR-CSE-21).

Writes `clinical_audit.counseling_access_log` with `access_kind: "list_read"`.

**Validation** — none.

**Error Responses** — universal set, plus `NOT_ON_CLINICAL_ROSTER` (403).

**Status Codes** — `200`, `401`, `403`, `404`.

---

### GET /counseling/api/v1/access-log

**Purpose** — The counseling access log: every read of counseling case data, with the accessing user, the case identifier and the timestamp (FR-CSE-15, FR-CSE-16, BR-51).

**Authentication** — `Session + ClinicalRoster`, **restricted further to Counseling Professionals and the designated counseling service head**. There is no break-glass path to this endpoint.

**This is the one endpoint in the entire API that an Administrator can never reach, by any route, under any grant.** FR-CSE-16 requires the access log to be readable only by Counseling Professionals and the service head. It lives inside the vault precisely so that the Core administrator has no credential path to it — which is what a single-database design could not honestly deliver.

**Request Body** — none. Query parameters:

| Param | Type | Required | Rule |
|---|---|---|---|
| `caseId` | uuid | no | — |
| `accessorRefId` | uuid | no | — |
| `accessKind` | enum | no | `case_read` \| `note_read` \| `request_read` \| `timeline_read` \| `list_read` \| `export_read` |
| `breakGlassOnly` | boolean | no | Defaults to `false` |
| `from` / `to` | timestamptz | no | Defaults to the last 30 days; range ≤ 365 days |

**Response Body**

```json
{
  "items": [
    {
      "id": "01921800-…",
      "caseId": "01921400-…",
      "requestId": null,
      "accessorRefId": "0191f0cc-…",
      "accessorDisplayName": "DIU IT",
      "accessKind": "case_read",
      "wasBreakGlass": true,
      "correlationId": "01J8ZS90AA22BB",
      "accessedAt": "2026-08-04T14:26:00+06:00"
    }
  ],
  "nextCursor": null
}
```

`wasBreakGlass: true` rows are the ones that matter most: they show a Counseling Professional exactly which records an administrator read under emergency access, and when. Break-glass is designed to be uncomfortable — it requires a typed justification, it alerts the service head immediately, it expires in 60 minutes, and it cannot be silently renewed (FR-AUD-05…07). This log is where its use is answerable to the people whose records were touched.

The log is append-only, enforced by trigger as well as by `REVOKE`. There is no write, update or delete route (BR-51).

**Validation** — `to` ≥ `from`; range ≤ 365 days.

**Error Responses**

| Code | Status | Condition | Message |
|---|---|---|---|
| `NOT_ON_CLINICAL_ROSTER` | 403 | Not a Counseling Professional or the service head — **including an administrator holding an active break-glass grant** | "You don't have access to this area." |
| `INVALID_DATE_RANGE` | 422 | Range invalid or over 365 days | "Choose a date range of up to one year." |

**Status Codes** — `200`, `401`, `403`, `404`, `422`.

---
# Part 12 — Internal Service-to-Service Endpoints

ARCHITECTURE §2.4 states that **exactly three things** cross the boundary between the Core Application and the Counseling Service, and nothing else. Those three things are these three endpoints. They are documented rather than left implicit, because §12.2 is the only route by which a counseling-originated call reaches Core, and the restriction on its payload is what makes FR-NTF-05 architecturally enforced rather than a convention someone remembers.

**Authentication for all three is `Service`:** mutual TLS between the two processes, plus a shared service identity header. These routes are not exposed through the reverse proxy and are unreachable from the public internet. A session cookie on any of them is ignored — they are not user-facing, and a user-facing path into them would be a hole in the boundary.

---

### POST /api/v1/internal/sessions/validate

**Direction** — Counseling Service → Core.

**Purpose** — Answer the vault's question *"is this session live, and who is it?"* (ARCHITECTURE §7.4).

**Authentication** — `Service`.

**Request Body**

```json
{ "sessionId": "0192a000-…", "clientFingerprint": "…" }
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `sessionId` | string | yes | The opaque value from the `ccc_session` cookie |
| `clientFingerprint` | string | no | Compared against the bound fingerprint |

**Response Body**

```json
{
  "valid": true,
  "userId": "0191f3c2-…",
  "roles": ["STU"],
  "accountStatus": "active",
  "expiresAt": "2026-08-04T16:35:00+06:00"
}
```

**IAM answers "who are you and is your session live?" — and only that.** The vault then answers "are you clinically authorised?" independently, against its own roster. Two questions, two authorities, two failure modes that do not share a cause (NFR-SEC-06).

The `roles` array is informational. **The vault does not trust it for authorization** — a `CNP` claim here grants nothing; the clinical roster is the authority (ADR-012). It is returned so the vault can distinguish a student (own-records path) from a staff caller, both of which it then verifies itself.

Core learns that *some* request was made to the vault. It does not learn which route, which case, or whether any case exists — the request carries no such field.

**Validation** — `sessionId` present and well-formed.

**Error Responses**

| Code | Status | Condition |
|---|---|---|
| `SERVICE_UNAUTHENTICATED` | 401 | Invalid or absent service credential |
| `SERVICE_UNAVAILABLE` | 503 | Core IAM unreachable |

A session that is unknown, expired or revoked returns `200` with `valid: false` — not a 404. The vault needs an answer, not an exception.

**Status Codes** — `200`, `401`, `503`.

---

### POST /api/v1/internal/notifications

**Direction** — Counseling Service → Core.

**Purpose** — Request that Core dispatch a notification, carrying **only a recipient and a pre-approved discreet template key** (ARCHITECTURE §2.4, FR-NTF-05, BR-53).

**Authentication** — `Service`.

**Request Body**

```json
{
  "recipientId": "0191f3c2-…",
  "templateKey": "CNS_UPDATE_AVAILABLE",
  "correlationId": "01J8ZS90AA22BB"
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `recipientId` | uuid | yes | A Core account identifier |
| `templateKey` | string | yes | Must be on the discreet allow-list, and the template must have `allows_free_text = false` |
| `correlationId` | string | no | Opaque tracing value. Carries no counseling meaning |

**The schema of this request is the enforcement.** There is no `payload`, no `body`, no `subject`, no `category`, no `urgency`, no `counselorName` and no free-text field of any kind. A field that does not exist cannot leak. Anything beyond these three keys is rejected.

**Response Body**

```json
{
  "notificationId": "0192a100-…",
  "accepted": true,
  "channelsQueued": ["in_app", "email"],
  "guardVerdict": "approved"
}
```

The Content Policy Guard validates the request before the outbox accepts it: it asserts the template is on the discreet allow-list and that the payload carries no free text. A violation is **rejected and recorded as a security event** (ARCHITECTURE §2.4, ADR-007).

**Core never learns why the notification was sent.** It learns only that a notification using an approved discreet template must go to a student. That is what makes FR-NTF-05 architecturally enforced rather than conventional — and it is why `CounselingRequestSubmitted` and every other counseling event stay on the vault's own bus, never entering the Core event bus where a subscriber could infer a counseling record exists (BR-50, ARCHITECTURE §5.5).

**Validation** — `templateKey` exists, is active, `is_discreet = true` and `allows_free_text = false`; `recipientId` resolves to an active account; no unrecognised keys in the body.

**Error Responses**

| Code | Status | Condition |
|---|---|---|
| `TEMPLATE_NOT_DISCREET` | 422 | The key is not on the discreet allow-list. **Security event recorded** |
| `UNEXPECTED_FIELD` | 422 | The body carries any key beyond the three above. **Security event recorded** |
| `RECIPIENT_UNKNOWN` | 422 | No active account for `recipientId` |
| `SERVICE_UNAUTHENTICATED` | 401 | Invalid service credential |

Email delivery failure does not fail this call — the in-app notification remains available (FR-NTF-08, EC-51).

**Status Codes** — `202`, `401`, `422`, `503`.

---

### POST /counseling/api/v1/internal/account-events

**Direction** — Core → Counseling Service.

**Purpose** — Deliver student account lifecycle events to the vault, e.g. "account deactivated" (ARCHITECTURE §2.4, EC-06, EC-55).

**Authentication** — `Service`.

**Request Body**

```json
{
  "eventType": "account_deactivated",
  "userId": "0191f3c2-…",
  "occurredAt": "2026-08-14T10:00:00+06:00"
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `eventType` | enum | yes | `account_deactivated` \| `account_suspended` \| `account_reactivated` |
| `userId` | uuid | yes | Core account identifier |
| `occurredAt` | timestamptz | yes | — |

The payload carries **nothing about the student's medical activity** — no appointments, no payments, no reason for deactivation. The vault is told that an account changed state, and no more.

**Response Body**

```json
{ "accepted": true }
```

**The response is deliberately uninformative.** It does not say whether a case exists, whether one was affected, or what the vault did. A richer acknowledgement would turn this endpoint into an oracle: Core could deactivate an account and learn from the reply whether that student had ever used the counseling service. `accepted: true` is returned identically whether the student has ten open cases or has never contacted the service (BR-50, PRM-09).

Inside the vault, an open case belonging to a deactivated student **remains accessible to Counseling Professionals until it is closed** (EC-55). Retention thereafter is governed by OI-02.

**Validation** — `eventType` recognised; `userId` well-formed.

**Error Responses**

| Code | Status | Condition |
|---|---|---|
| `SERVICE_UNAUTHENTICATED` | 401 | Invalid service credential |
| `UNKNOWN_EVENT_TYPE` | 422 | Unrecognised `eventType` |
| `NOT_FOUND` | 404 | `counseling.enabled` is off — the service is not running |

**Status Codes** — `202`, `401`, `404`, `422`.

---

# Part 13 — Traceability & Coverage

## 13.1 Permission matrix → endpoints

Every row of SRS §3.5.2 maps to at least one endpoint. An endpoint with no row here is unreachable by PRM-02.

| §3.5.2 resource row | Endpoints |
|---|---|
| Public availability view | §2.2 `/public/availability`, §2.3 `/public/queue-display`, §2.4 `/public/store-status`, §2.5 `/public/announcements`, §2.6 `/public/service-calendar` |
| Own profile | §1.9 `GET /me`, §1.10 `PATCH /me` |
| User accounts & roles | §1.11–§1.16 `/users…`, §1.17–§1.19 `/roles…` |
| Doctor profiles | §3.1 `/doctors…` (6 endpoints) |
| Doctor schedules & sessions | §3.2 rosters (4), §3.3 sessions (9), §3.4 unavailability (4) |
| Non-service calendar | §2.6 public read; §8.4–§8.6 `/service-calendar` (ADM write) |
| Appointment (own) | §4.2 `POST /appointments`, §4.3 `GET /me/appointments`, §4.5 `…/cancel` |
| Appointment (any) | §4.4 `GET /appointments/{id}` (role-varying shape), §4.9 `/queue/console`, §4.11 `/doctors/me/sessions` |
| Live queue | §2.3 public display, §4.6 `…/queue-position`, §4.10 `/sessions/{id}/queue` |
| Walk-in registration | §4.17 `POST /walk-ins` |
| Emergency designation | §4.16 `…/emergency` |
| Reason-for-visit | §4.8 `/visit-reason-categories`, §4.2 (create own), §4.4 (read) |
| Payment record | §5.2–§5.6 |
| Daily collection summary | §5.7 `/reports/daily-collection`, §5.8 reconciliation |
| Medicine catalogue | §6.1–§6.2 `/medicines…` (6 endpoints) |
| Medicine stock quantities | §6.5 `GET …/batches`; the operator-only fields of §6.1 |
| Stock movements | §6.6 batches, §6.8 dispensings, §6.9 adjustments, §6.10 `GET /stock-movements` |
| Store hours & status | §6.12–§6.16 |
| Counseling availability | §10.12 `GET`, §10.13 `PUT /counselor-availability` |
| **Counseling request (own)** | §10.5 `POST /requests`, §10.6–§10.7 `GET /me/requests`, §10.8 withdraw |
| **Counseling request (any)** | §11.2 `GET /requests/{id}`, §11.3 priority, §11.4 decline |
| **Counseling case & notes** | §11.5–§11.14 |
| **Counseling case existence** | §10.6 (own, student), §11.5 `GET /cases` (CNP) |
| **Counseling access log** | §11.16 `GET /access-log` — **no administrator path exists, break-glass included** |
| Notifications (own) | §7.1–§7.3 |
| Notification templates | §7.4–§7.5 |
| System configuration | §8.1–§8.3 |
| Announcements | §2.5 public read; §8.7–§8.10 (ADM write) |
| General audit log | §9.1 `/admin/audit-log` |
| Data export | §8.12 `POST /admin/exports`, §8.13 `GET /admin/exports/{id}` |

## 13.2 Validation rule → enforcing endpoint

| Rule | Enforced at |
|---|---|
| VR-01 email format | `POST /auth/login`, `POST /auth/password-reset/request`, `POST /users` |
| VR-02 password complexity | `POST /auth/password-reset/confirm` |
| **VR-03 student identifier** | **No endpoint sets it.** Assigned at SSO provisioning; uniqueness enforced by `student_profile.student_ref UNIQUE` |
| VR-04 CNP role assignment | `POST /users`, `POST /users/{id}/roles` |
| VR-05 deactivation confirmation | `POST /users/{id}/deactivate` |
| VR-10 session time order | `POST`/`PATCH /sessions`, `POST /doctors/{id}/duty-rosters`, `PATCH /duty-rosters/{id}` |
| VR-11 session duration | `POST`/`PATCH /sessions` |
| VR-12 slot length 5–60 | `POST`/`PATCH /sessions`; range also held in `PATCH /config/{key}` |
| VR-13 walk-in allocation | `POST`/`PATCH /sessions` |
| VR-14 publication window 1–30 | `PATCH /config/{key}`; clamped in `GET /availability` |
| VR-15 override within window | `POST /sessions` |
| VR-16 unavailability range | `POST …/unavailability/impact-preview`, `POST …/unavailability` |
| VR-17 non-service day | `POST /sessions` |
| VR-18 change within 24 h | `POST`/`PATCH /sessions` |
| VR-19 overlapping sessions | `POST`/`PATCH /sessions` — backed by `ex_session_no_overlap` |
| VR-20 slot selection | `POST /appointments` |
| VR-21 booking count | `POST /appointments` |
| VR-22 same doctor, same day | `POST /appointments` |
| VR-23 booking suspension | `POST /appointments` |
| VR-24 booking cutoff | `POST /appointments` |
| VR-25 reason-for-visit | `POST /appointments`, `POST /walk-ins` |
| VR-26 cancellation state | `POST …/cancel` |
| VR-27 check-in | `POST …/check-in` |
| VR-28 status transition | `POST …/advance`, `…/check-in`, `…/no-show` |
| VR-29 walk-in identifier | `POST /walk-ins` |
| VR-30 emergency reason | `POST …/emergency`, `POST /walk-ins` |
| VR-31 no-show grace period | `POST …/no-show` |
| VR-32 status reversal | `POST …/reverse` |
| VR-40 payment amount | `POST …/payments`, `POST /payments/{id}/adjustments` |
| VR-41 receipt number | `POST …/payments` — backed by `uq_payment_receipt_per_day` |
| VR-42 waiver reason | `POST …/payments/waiver` |
| VR-43 reconciliation | `POST /reports/daily-collection/{date}/reconciliation` |
| VR-44 payment on cancelled appointment | `POST …/payments`, `POST …/payments/waiver` |
| VR-50 catalogue mandatory fields | `POST`/`PATCH /medicines` |
| VR-51 catalogue duplication | `POST`/`PATCH /medicines` — backed by `uq_medicine_natural_key` |
| VR-52 receipt quantity | `POST /medicines/{id}/batches` |
| VR-53 expiry date | `POST /medicines/{id}/batches` — trigger-enforced |
| VR-54 batch identifier | `POST /medicines/{id}/batches` |
| VR-55 dispensing quantity | `POST /medicines/{id}/dispensings` |
| VR-56 expired batch | `POST /medicines/{id}/dispensings` — no override exists |
| VR-57 non-FEFO selection | `POST /medicines/{id}/dispensings` |
| VR-58 per-student dispensing limit | `POST /medicines/{id}/dispensings` |
| VR-59 stock adjustment | `POST /medicines/{id}/adjustments` |
| VR-60 low stock threshold | `POST`/`PATCH /medicines` |
| VR-61 store hours | `PUT /store/hours` |
| VR-62 store override reason | `POST /store/status-override` |
| VR-63 search query length | `GET /medicines` |
| VR-70 counseling category | `POST /counseling/api/v1/requests` |
| VR-71 self-reported urgency | `POST /counseling/api/v1/requests` |
| VR-72 free-text note | `POST /counseling/api/v1/requests` |
| VR-73 preferred windows | `POST /counseling/api/v1/requests` |
| VR-74 duplicate request | `POST /counseling/api/v1/requests` — backed by `uq_request_active_per_student` |
| VR-75 crisis gate | `POST /crisis-acknowledgements` **and** `POST /requests` — backed by `ck_request_crisis_gate` |
| VR-76 priority change reason | `POST /requests/{id}/priority` |
| VR-77 session scheduling | `POST /cases/{id}/sessions`, `PATCH …/sessions/{sessionId}` |
| VR-78 case closure | `POST /cases/{id}/close` |
| VR-79 session notes | `POST /cases/{id}/notes` |
| VR-80 withdrawal | `POST /me/requests/{id}/withdraw` |
| **VR-90 free text as data** | **Global** — §0.8. Escaped on output, never interpreted as markup, on every endpoint |
| **VR-91 BST only** | **Global** — §0.8 |
| **VR-92 concurrent modification** | **Global** — §0.6. Every mutable resource |
| **VR-93 mandatory reason fields** | **Global** — §0.9. Twelve operations enumerated there |
| VR-94 configuration range | `PATCH /config/{key}` — at save, not at use |

## 13.3 Coverage summary

| Part | Module | Endpoints | Primary requirements |
|---|---|---|---|
| 1 | AUTH | 19 | FR-AUTH-01…15 |
| 2 | DASH | 6 | FR-DASH-01…08, FR-UI-04/05 |
| 3 | SCH | 23 | FR-SCH-01…16 |
| 4 | APT | 17 | FR-APT-01…42 |
| 5 | PAY | 8 | FR-PAY-01…11 |
| 6 | MED | 18 | FR-MED-01…28 |
| 7 | NTF | 5 | FR-NTF-01…09 |
| 8 | ADM | 14 | FR-ADM-01…09 |
| 9 | AUD | 6 | FR-AUD-01…07, FR-ADM-05/06 |
| 10 | CNS *(vault)* | 12 | FR-CNS-01…17 |
| 11 | CSE *(vault)* | 16 | FR-CSE-01…23 |
| 12 | Internal | 3 | ARCHITECTURE §2.4, §7.4 |
| | **Total** | **147** | |

## 13.4 Requirements deliberately not served by any endpoint

Listed explicitly, because an absence that looks like an omission invites someone to close the gap by adding a route that should not exist.

| Requirement | Why there is no endpoint |
|---|---|
| FR-APT-33 — expire unstarted bookings | Performed by `POST /sessions/{id}/complete` and by the scheduled sweep. There is no direct "expire this booking" route: `expired` is a system outcome, and exposing it would invite it to be used where `no_show` belongs (BR-22, EC-13) |
| FR-APT-32 — never mark No-show automatically | The absence of an automatic path *is* the requirement. `POST …/no-show` requires a staff session |
| FR-MED-17 — daily 00:01 band recalculation | Scheduled job on the background worker. No endpoint triggers it; a manual trigger would let someone mask an expiry sweep failure |
| FR-CSE-21 — 90-day auto-close | Scheduled job. The single system-actor transition BR-67 permits |
| FR-CSE-08/09 — urgent and SLA-breach notifications | Emitted by the vault's own scheduler and dispatched via §12.2. Not client-triggerable |
| FR-PAY-07 — automatic follow-up waiver | Applied by the system at booking or at payment time, surfaced through `POST …/payments/waiver` with `wasAutomatic: true` |
| FR-PAY-11 — no online payment | No endpoint accepts, processes or stores any payment instrument |
| FR-MED-28 — no student identity on dispensing | `POST …/dispensings` has no field for it. Pending the OI-18 decision |
| FR-CSE-19 — no automated clinical judgement | No endpoint, parameter or configuration triggers an escalation or sets a priority without a named human on the clinical roster |

## 13.5 Open items carried into implementation

| ID | Effect on this API |
|---|---|
| **OI-01** | Parts 10 and 11 require counseling-professional sign-off before implementation. All user-facing copy in them is draft |
| **OI-03** | `POST /auth/login` exists only because SSO availability is unconfirmed. If SSO is guaranteed, the local path and `local_credential` can be removed |
| **OI-18** | `POST …/dispensings` records no student identity. A DIU decision to change that adds a field and a matching privacy assessment |
| **OI-22** | `GET /triage-queue` surfaces accumulating SLA breaches. Phase 1 offers no automatic escalation beyond notification; that gap is organisational |
| **OI-02** | Retention of counseling records after account deactivation is undecided. §12.3 and §11.13 both defer to it |

---

## Document Control

| | |
|---|---|
| **Title** | REST API Specification — DIU CampusCare |
| **Version** | 1.0 |
| **Status** | For review |
| **Endpoints specified** | 147 across two services |
| **Preceded by** | PROJECT_PLANNING.md → SRS.md → ARCHITECTURE.md → DATABASE.md *(approved)* |
| **Next** | Implementation of `apps/core-api` and `apps/counseling-api` per ARCHITECTURE §6 |

**Review gates before implementation begins:**

1. **Counseling sign-off (OI-01, ASM-09)** — Parts 10 and 11, including every user-facing message string, reviewed by DIU counseling professionals.
2. **Permission matrix walkthrough (PRM-01…15)** — §13.1 confirmed row by row against SRS §3.5.2 by someone other than its author.
3. **[R3] availability (EC-48, BR-68)** — the crisis protocol content must exist before the counseling service can start. Absent it, the service does not deploy and its routes return 404.
