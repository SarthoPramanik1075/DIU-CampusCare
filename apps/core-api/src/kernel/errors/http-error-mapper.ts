import { UNIVERSAL_ERROR_CODES, type ErrorResponse } from '@campuscare/shared-types';

import {
  AuthorizationError,
  ConflictError,
  DomainRuleViolation,
  InfrastructureError,
  ValidationError,
  isDomainError,
} from './domain-error.js';

export interface MappedError {
  readonly status: number;
  readonly body: ErrorResponse;
}

/**
 * The single place a caught error becomes an HTTP response.
 *
 * Three rules govern this function (API §0.4), and each is enforced here
 * rather than left to the discretion of whichever route happens to catch the
 * error:
 *
 *   1. Never leak internals — NFR-SEC-07. A `DomainError`'s `message` was
 *      authored to be shown to a user; anything else's was not, so a bare
 *      `Error` or a thrown non-Error value never has its `message` or
 *      `stack` placed in the response. Only the correlation ID identifies it.
 *   2. Never confirm existence through an error — an `AuthorizationError`
 *      with no explicit message renders exactly the same generic text
 *      whether the resource is forbidden or does not exist (§0.4 rule 2, and
 *      the `NOT_FOUND` universal code below).
 *   3. Always correlated — every branch, including the unknown-error
 *      fallback, carries the same `correlationId` the caller generated
 *      before dispatching the request, so a log line and a user's bug report
 *      can be joined.
 */
export function mapErrorToHttp(error: unknown, correlationId: string): MappedError {
  if (isDomainError(error)) {
    if (error instanceof ValidationError) {
      return withCode(422, error.code, error.message, correlationId, error.fields, error.details);
    }
    if (error instanceof AuthorizationError) {
      return withCode(
        error.httpStatus,
        error.code,
        error.message,
        correlationId,
        undefined,
        error.details,
      );
    }
    if (error instanceof DomainRuleViolation) {
      return withCode(409, error.code, error.message, correlationId, undefined, error.details);
    }
    if (error instanceof ConflictError) {
      return withCode(409, error.code, error.message, correlationId, undefined, error.details);
    }
    if (error instanceof InfrastructureError) {
      const status = error.retryable ? 503 : 500;
      return withCode(status, error.code, error.message, correlationId, undefined, error.details);
    }
  }

  // Anything that is not a DomainError is, by definition, a failure nobody
  // authored a user-facing message for — an unhandled exception, a library
  // throw, a network error. NFR-SEC-07 forbids exposing what it actually
  // says, so it never reaches `body`.
  return withCode(
    500,
    UNIVERSAL_ERROR_CODES.INTERNAL_ERROR,
    'Something went wrong. Your data is safe.',
    correlationId,
  );
}

function withCode(
  status: number,
  code: string,
  message: string,
  correlationId: string,
  fields?: ErrorResponse['error']['fields'],
  details?: ErrorResponse['error']['details'],
): MappedError {
  return {
    status,
    body: {
      error: {
        code,
        message,
        correlationId,
        ...(fields !== undefined && { fields }),
        ...(details !== undefined && { details }),
      },
    },
  };
}
