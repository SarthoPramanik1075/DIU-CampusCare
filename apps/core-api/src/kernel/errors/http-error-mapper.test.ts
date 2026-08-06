import { isErrorResponse } from '@campuscare/shared-types';
import { describe, expect, it } from 'vitest';

import {
  AuthorizationError,
  ConflictError,
  DomainRuleViolation,
  InfrastructureError,
  ValidationError,
} from './domain-error.js';
import { mapErrorToHttp } from './http-error-mapper.js';

const CID = '01J8ZQ7K4M9X2P';

describe('mapErrorToHttp', () => {
  it('maps ValidationError to 422 with field errors', () => {
    const { status, body } = mapErrorToHttp(
      new ValidationError({
        code: 'VALIDATION_FAILED',
        message: 'Choose a date from today onwards.',
        fields: [{ field: 'from', rule: 'VR-14', message: 'must not be in the past' }],
      }),
      CID,
    );
    expect(status).toBe(422);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.fields).toHaveLength(1);
    expect(body.error.correlationId).toBe(CID);
    expect(isErrorResponse(body)).toBe(true);
  });

  it.each([
    [401, 'UNAUTHENTICATED'],
    [403, 'FORBIDDEN'],
  ] as const)('maps AuthorizationError with httpStatus %i to that status', (status, code) => {
    const mapped = mapErrorToHttp(
      new AuthorizationError({ code, message: 'You do not have access to this area.', httpStatus: status }),
      CID,
    );
    expect(mapped.status).toBe(status);
    expect(mapped.body.error.code).toBe(code);
  });

  it('defaults AuthorizationError to 403 when no status is given', () => {
    const { status } = mapErrorToHttp(new AuthorizationError({ code: 'FORBIDDEN', message: 'No.' }), CID);
    expect(status).toBe(403);
  });

  it('maps DomainRuleViolation and ConflictError to 409', () => {
    expect(
      mapErrorToHttp(new DomainRuleViolation({ code: 'PAYMENT_REQUIRED', message: 'Unpaid.' }), CID).status,
    ).toBe(409);
    expect(
      mapErrorToHttp(new ConflictError({ code: 'CONFLICT_STALE_VERSION', message: 'Stale.' }), CID).status,
    ).toBe(409);
  });

  it('maps a retryable InfrastructureError to 503 and a non-retryable one to 500', () => {
    expect(
      mapErrorToHttp(
        new InfrastructureError({ code: 'SERVICE_UNAVAILABLE', message: 'Try again.', retryable: true }),
        CID,
      ).status,
    ).toBe(503);
    expect(
      mapErrorToHttp(
        new InfrastructureError({ code: 'INTERNAL_ERROR', message: 'Broken.', retryable: false }),
        CID,
      ).status,
    ).toBe(500);
  });

  // NFR-SEC-07 — the one rule this file exists to enforce mechanically.
  it('never exposes the message or stack of a non-DomainError', () => {
    const secret = 'password=hunter2; at /internal/db/pool.ts:42';
    const { status, body } = mapErrorToHttp(new Error(secret), CID);
    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).not.toContain('hunter2');
    expect(body.error.message).not.toContain('pool.ts');
    expect(JSON.stringify(body)).not.toContain(secret);
  });

  it('maps a thrown non-Error value the same way, without inspecting it', () => {
    const { status, body } = mapErrorToHttp('a bare string throw', CID);
    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(body)).not.toContain('bare string');
  });

  it('always carries the supplied correlation ID, on every branch', () => {
    const errors: unknown[] = [
      new ValidationError({ code: 'X', message: 'x' }),
      new AuthorizationError({ code: 'X', message: 'x' }),
      new DomainRuleViolation({ code: 'X', message: 'x' }),
      new ConflictError({ code: 'X', message: 'x' }),
      new InfrastructureError({ code: 'X', message: 'x' }),
      new Error('unknown'),
    ];
    for (const error of errors) {
      expect(mapErrorToHttp(error, CID).body.error.correlationId).toBe(CID);
    }
  });
});
