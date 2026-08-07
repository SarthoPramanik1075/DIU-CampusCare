import type { FieldError } from '@campuscare/shared-types';

/**
 * The five-class error taxonomy — ARCHITECTURE §10.1. Every failure in the
 * system is exactly one of these; the HTTP mapper (`http-error-mapper.ts`)
 * is the only place that turns a class into a status code, which is what
 * keeps the mapping in one place instead of scattered through handlers.
 */
export type ErrorClass =
  | 'validation'
  | 'authorization'
  | 'domain_rule'
  | 'conflict'
  | 'infrastructure';

export interface DomainErrorInit {
  /** Stable machine-readable code — API §0.4. Never displayed; clients branch on it. */
  readonly code: string;
  /** Plain language, states the next step, no technical terms — NFR-USE-06. */
  readonly message: string;
  readonly fields?: readonly FieldError[];
  readonly details?: Readonly<Record<string, unknown>>;
}

/**
 * Base of the taxonomy.
 *
 * `DomainError.message` is written to be shown to a user — that is the
 * entire point of the type. This is the opposite default from a bare `Error`,
 * whose message the HTTP mapper must never expose (NFR-SEC-07). Keeping them
 * as distinct classes is what lets the mapper apply that rule mechanically
 * instead of by convention.
 */
export abstract class DomainError extends Error {
  abstract readonly errorClass: ErrorClass;
  readonly code: string;
  readonly fields: readonly FieldError[] | undefined;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  // Public, not protected: `abstract` already makes `new DomainError(...)`
  // impossible on its own, so protecting the constructor too would only
  // force every concrete subclass to redeclare a trivial override just to
  // become instantiable — which is the useless-constructor problem in
  // reverse.
  constructor(init: DomainErrorInit) {
    super(init.message);
    this.name = new.target.name;
    this.code = init.code;
    this.fields = init.fields;
    this.details = init.details;
  }
}

/** 422 — a VR-* field rule was violated. `fields` carries the per-field detail. */
export class ValidationError extends DomainError {
  readonly errorClass = 'validation' as const;
}

/**
 * 401, 403, 404 or 423 — session invalid, the PDP denied, the account is
 * temporarily locked out (423, FR-AUTH-14, API §1.3 `ACCOUNT_LOCKED`), or
 * (404) a resource the caller may not even know exists. None of these were
 * in ARCHITECTURE §10.1's original two-status table — each was added as a
 * later endpoint needed it — but API §0.4 rule 2 makes 404 the same *kind*
 * of failure as 403 by its own definition ("a 403 for a resource the caller
 * may not see is indistinguishable from one that does not exist"), so like
 * 423 before it, this extends the existing class rather than becoming a
 * sixth taxonomy class.
 */
export class AuthorizationError extends DomainError {
  readonly errorClass = 'authorization' as const;
  readonly httpStatus: 401 | 403 | 404 | 423;
  constructor(init: DomainErrorInit & { readonly httpStatus?: 401 | 403 | 404 | 423 }) {
    super(init);
    this.httpStatus = init.httpStatus ?? 403;
  }
}

/** 409 — a BR-* invariant would be broken. State must change before retrying. */
export class DomainRuleViolation extends DomainError {
  readonly errorClass = 'domain_rule' as const;
}

/** 409 — concurrent modification or a lost race (VR-92, EC-01, EC-19). Retryable after refresh. */
export class ConflictError extends DomainError {
  readonly errorClass = 'conflict' as const;
}

/** 503 or 500 — a dependency failed. `retryable` distinguishes the two. */
export class InfrastructureError extends DomainError {
  readonly errorClass = 'infrastructure' as const;
  readonly retryable: boolean;
  constructor(init: DomainErrorInit & { readonly retryable?: boolean }) {
    super(init);
    this.retryable = init.retryable ?? true;
  }
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}
