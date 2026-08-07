import { isErrorResponse } from '@campuscare/shared-types';

/**
 * API.md §0.4 — every non-2xx response carries the uniform error envelope.
 * Callers branch on `code` (stable, `SCREAMING_SNAKE`), never on `message`
 * (plain-language, may change wording without notice).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly correlationId: string;

  constructor(status: number, code: string, message: string, correlationId: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;
  }
}

/**
 * Thrown when a non-2xx response's body does not match the documented
 * envelope at all — a condition the contract test suite exists to catch
 * before it reaches a browser, but the client does not trust the network
 * to always agree with the contract.
 */
export class MalformedApiResponseError extends Error {
  readonly status: number;

  constructor(status: number) {
    super('The server returned an unexpected response.');
    this.name = 'MalformedApiResponseError';
    this.status = status;
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    if (isErrorResponse(body)) {
      throw new ApiError(response.status, body.error.code, body.error.message, body.error.correlationId);
    }
    throw new MalformedApiResponseError(response.status);
  }

  // API §1.4's 204 (logout) and a handful of other no-body successes never
  // send a JSON payload — parsing an empty body as JSON throws, so this is
  // checked rather than assumed.
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * `GET` against one of the two services (ADR-001 — each has its own base
 * URL, never a shared one). No credentials are sent by the public
 * endpoints this client currently calls; `credentials: 'include'` is
 * carried anyway so a later authenticated call added to this same client
 * does not silently omit the session cookie.
 */
export async function apiGet<T>(baseUrl: string, path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  return handleResponse<T>(response);
}

/**
 * `POST`/`PATCH`/`DELETE` — API §0.2: "every state-changing request
 * additionally requires a `X-CSRF-Token`" derived from the session the
 * login/session response issued. `csrfToken` is omitted only for the
 * handful of pre-session calls (login itself, password-reset request)
 * that have no session yet to derive one from.
 */
async function mutate<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  baseUrl: string,
  path: string,
  body: unknown,
  csrfToken: string | undefined,
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(csrfToken === undefined ? {} : { 'X-CSRF-Token': csrfToken }),
    },
    body: JSON.stringify(body ?? {}),
  });
  return handleResponse<T>(response);
}

export function apiPost<T>(baseUrl: string, path: string, body: unknown, csrfToken?: string): Promise<T> {
  return mutate<T>('POST', baseUrl, path, body, csrfToken);
}

export function apiPatch<T>(baseUrl: string, path: string, body: unknown, csrfToken: string): Promise<T> {
  return mutate<T>('PATCH', baseUrl, path, body, csrfToken);
}

export function apiDelete<T>(baseUrl: string, path: string, body: unknown, csrfToken: string): Promise<T> {
  return mutate<T>('DELETE', baseUrl, path, body, csrfToken);
}
