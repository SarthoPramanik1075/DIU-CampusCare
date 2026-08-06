import { describe, expect, it } from 'vitest';

import { err, isErr, isOk, map, mapErr, ok, unwrapOr, type Result } from './result.js';

describe('Result', () => {
  it('ok() produces a success carrying the value', () => {
    const result = ok(42);
    expect(result).toEqual({ ok: true, value: 42 });
    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);
  });

  it('err() produces a failure carrying the error', () => {
    const result = err('BOOM');
    expect(result).toEqual({ ok: false, error: 'BOOM' });
    expect(isOk(result)).toBe(false);
    expect(isErr(result)).toBe(true);
  });

  it('map() transforms the value of a success and leaves a failure untouched', () => {
    expect(map(ok(2), (n) => n * 10)).toEqual(ok(20));
    expect(map(err('BOOM'), (n: number) => n * 10)).toEqual(err('BOOM'));
  });

  it('mapErr() transforms the error of a failure and leaves a success untouched', () => {
    expect(mapErr(err('boom'), (e) => e.toUpperCase())).toEqual(err('BOOM'));
    expect(mapErr(ok(2), (e: string) => e.toUpperCase())).toEqual(ok(2));
  });

  it('unwrapOr() returns the value on success and the fallback on failure', () => {
    expect(unwrapOr(ok(2), 0)).toBe(2);
    expect(unwrapOr(err('boom'), 0)).toBe(0);
  });

  it('narrows the type after an isOk/isErr check', () => {
    const result: Result<number, string> = ok(2);
    if (isOk(result)) {
      // Compiles only because isOk narrowed `result` to the success arm.
      expect(result.value).toBe(2);
    } else {
      expect.fail('expected an ok result');
    }
  });
});
