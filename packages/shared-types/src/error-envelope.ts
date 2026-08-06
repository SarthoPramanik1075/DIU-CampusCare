/**
 * The uniform error envelope — API.md §0.4.
 *
 * Every non-2xx response from either service carries this shape and nothing
 * else. Three rules govern it (API §0.4), and each has a consequence for the
 * types below:
 *
 *   1. Never leak internals. There is no `stack`, no `sql`, no `constraint`
 *      and no `cause` field, and none may be added — NFR-SEC-07.
 *   2. Never confirm existence through an error. A 403 for a resource the
 *      caller may not see is indistinguishable from a 403 for one that does
 *      not exist, which is what makes PRM-09 achievable.
 *   3. Always correlated. `correlationId` is mandatory, not optional, so a
 *      user can quote it and support can trace it — NFR-MNT-03.
 */

/**
 * A field-level validation failure.
 *
 * `rule` carries the SRS §3.4 identifier (`VR-21`, `VR-93`, …). It is never
 * rendered to the user — FRONTEND §6.2 emits it as a `data-rule` attribute so
 * the traceability suite can assert which rule fired. The user-facing text is
 * `message`.
 */
export interface FieldError {
  /** Request-body path of the offending field, e.g. `sessionSlotId`. */
  readonly field: string;
  /** SRS validation-rule identifier, e.g. `VR-21`. Diagnostic only. */
  readonly rule: string;
  /** Plain-language explanation for this field. */
  readonly message: string;
}

/**
 * The body of every error response.
 *
 * `details` carries endpoint-specific recovery material — the refreshed slot
 * list on `SLOT_TAKEN`, the current representation on
 * `CONFLICT_STALE_VERSION`. API §6.3 requires a 409 to be recoverable rather
 * than a dead end, and this is where the material for that arrives.
 */
export interface ErrorBody {
  /** Stable machine-readable code. Clients branch on this, never on `message`. */
  readonly code: string;
  /** Plain language, states what to do next, no technical terms — NFR-USE-06. */
  readonly message: string;
  /** Always present. Quotable by the user, traceable in logs — NFR-MNT-03. */
  readonly correlationId: string;
  /** Present on 422 only. */
  readonly fields?: readonly FieldError[];
  /** Endpoint-specific recovery context. Drives behaviour, not display. */
  readonly details?: Readonly<Record<string, unknown>>;
}

/** The complete error response body. */
export interface ErrorResponse {
  readonly error: ErrorBody;
}

/**
 * The universal error set — API.md §0.5.
 *
 * These may be returned by any endpoint and are deliberately *not* repeated in
 * individual endpoint specifications. Endpoint-specific codes live with their
 * module.
 */
export const UNIVERSAL_ERROR_CODES = {
  /** 422 — one or more VR-* field rules violated; see `fields`. */
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  /** 401 — no session cookie, or the session is unknown. */
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  /** 401 — session past its idle timeout or revoked. */
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  /** 403 — missing or mismatched X-CSRF-Token on a state-changing request. */
  CSRF_TOKEN_INVALID: 'CSRF_TOKEN_INVALID',
  /** 403 — the policy decision point denied. Logged to audit.authz_denial. */
  FORBIDDEN: 'FORBIDDEN',
  /** 403 — account status is not `active` (FR-AUTH-09, BR-01). */
  ACCOUNT_NOT_ACTIVE: 'ACCOUNT_NOT_ACTIVE',
  /** 404 — does not exist, or exists and the caller may not know that. */
  NOT_FOUND: 'NOT_FOUND',
  /** 409 — version mismatch (VR-92, EC-19). */
  CONFLICT_STALE_VERSION: 'CONFLICT_STALE_VERSION',
  /** 503 — dependency failure; safe to retry with backoff. */
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  /** 500 — unhandled. Correlation ID only. */
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type UniversalErrorCode =
  (typeof UNIVERSAL_ERROR_CODES)[keyof typeof UNIVERSAL_ERROR_CODES];

/** Narrowing helper for clients consuming either service. */
export function isErrorResponse(value: unknown): value is ErrorResponse {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = (value as { error?: unknown }).error;
  if (typeof candidate !== 'object' || candidate === null) return false;
  const { code, message, correlationId } = candidate as Record<string, unknown>;
  return (
    typeof code === 'string' &&
    typeof message === 'string' &&
    typeof correlationId === 'string'
  );
}
