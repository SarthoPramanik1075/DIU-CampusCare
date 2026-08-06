import { describe, expect, it } from 'vitest';

import { UNIVERSAL_ERROR_CODES, isErrorResponse } from './error-envelope.js';

describe('isErrorResponse', () => {
  it('accepts a minimal well-formed envelope', () => {
    expect(
      isErrorResponse({
        error: {
          code: 'NOT_FOUND',
          message: "We couldn't find that page.",
          correlationId: '01J8ZQ7K4M9X2P',
        },
      }),
    ).toBe(true);
  });

  it('accepts an envelope carrying field errors and recovery details', () => {
    expect(
      isErrorResponse({
        error: {
          code: 'BOOKING_LIMIT_REACHED',
          message: 'You already have 2 upcoming appointments.',
          correlationId: '01J8ZQ7K4M9X2P',
          fields: [
            {
              field: 'sessionSlotId',
              rule: 'VR-21',
              message: 'Maximum active bookings reached',
            },
          ],
          details: { activeAppointments: [] },
        },
      }),
    ).toBe(true);
  });

  // correlationId is mandatory, not optional — NFR-MNT-03. An envelope without
  // one cannot be traced, so it is not a valid envelope.
  it('rejects an envelope with no correlationId', () => {
    expect(
      isErrorResponse({
        error: { code: 'NOT_FOUND', message: 'Not found.' },
      }),
    ).toBe(false);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'NOT_FOUND'],
    ['an empty object', {}],
    ['a null error member', { error: null }],
    ['a non-string code', { error: { code: 404, message: 'x', correlationId: 'y' } }],
  ])('rejects %s', (_label, value) => {
    expect(isErrorResponse(value)).toBe(false);
  });
});

describe('universal error codes', () => {
  // API §0.5 defines exactly these ten. The list is closed: an endpoint-specific
  // code belongs with its module, not here.
  it('contains the ten codes of API §0.5 and no others', () => {
    expect(Object.keys(UNIVERSAL_ERROR_CODES).sort()).toEqual([
      'ACCOUNT_NOT_ACTIVE',
      'CONFLICT_STALE_VERSION',
      'CSRF_TOKEN_INVALID',
      'FORBIDDEN',
      'INTERNAL_ERROR',
      'NOT_FOUND',
      'SERVICE_UNAVAILABLE',
      'SESSION_EXPIRED',
      'UNAUTHENTICATED',
      'VALIDATION_FAILED',
    ]);
  });

  it('maps every key to its own identical string value', () => {
    for (const [key, value] of Object.entries(UNIVERSAL_ERROR_CODES)) {
      expect(value).toBe(key);
    }
  });
});
