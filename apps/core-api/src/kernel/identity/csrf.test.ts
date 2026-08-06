import { describe, expect, it } from 'vitest';

import { CsrfTokenService } from './csrf.js';

const SECRET = 'a'.repeat(32);
const OTHER_SECRET = 'b'.repeat(32);

describe('CsrfTokenService', () => {
  it('rejects a secret shorter than 32 characters at construction', () => {
    expect(() => new CsrfTokenService('too-short')).toThrow(/at least 32 characters/);
  });

  it('issues a token that verifies against the same session id', () => {
    const service = new CsrfTokenService(SECRET);
    const token = service.issue('session-1');
    expect(service.verify('session-1', token)).toBe(true);
  });

  it('is deterministic — the same session id always yields the same token', () => {
    const service = new CsrfTokenService(SECRET);
    expect(service.issue('session-1')).toBe(service.issue('session-1'));
  });

  it('produces different tokens for different session ids', () => {
    const service = new CsrfTokenService(SECRET);
    expect(service.issue('session-1')).not.toBe(service.issue('session-2'));
  });

  it('rejects a token issued for a different session id', () => {
    const service = new CsrfTokenService(SECRET);
    const token = service.issue('session-1');
    expect(service.verify('session-2', token)).toBe(false);
  });

  it('rejects a token produced with a different secret', () => {
    const a = new CsrfTokenService(SECRET);
    const b = new CsrfTokenService(OTHER_SECRET);
    expect(b.verify('session-1', a.issue('session-1'))).toBe(false);
  });

  it('rejects a missing or empty token', () => {
    const service = new CsrfTokenService(SECRET);
    expect(service.verify('session-1', undefined)).toBe(false);
    expect(service.verify('session-1', '')).toBe(false);
  });

  it('rejects a token of the wrong length without throwing', () => {
    const service = new CsrfTokenService(SECRET);
    expect(service.verify('session-1', 'short')).toBe(false);
  });

  it('rejects a subtly altered token', () => {
    const service = new CsrfTokenService(SECRET);
    const token = service.issue('session-1');
    const tampered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    expect(service.verify('session-1', tampered)).toBe(false);
  });
});
