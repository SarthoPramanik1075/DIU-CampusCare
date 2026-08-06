/**
 * Explicit success/failure — ARCHITECTURE §10.5.
 *
 * Domain operations return a `Result` rather than throwing. A business-rule
 * violation is an expected outcome of the domain's contract, not an
 * exceptional condition: the type system then forces every caller to handle
 * it, and a 70-business-rule test suite becomes table-driven cases rather
 * than exception-plumbing. Genuine exceptions remain for infrastructure
 * failure and programmer error.
 */
export type Result<T, E> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: E }>;

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is Readonly<{ ok: true; value: T }> {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is Readonly<{ ok: false; error: E }> {
  return !result.ok;
}

export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(fn(result.error));
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}
