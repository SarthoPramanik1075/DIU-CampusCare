import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiDelete, apiGet, apiPatch, apiPost, ApiError, MalformedApiResponseError } from './api-client.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('apiGet', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the parsed body on a 2xx response', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { items: [] }));
    const result = await apiGet<{ items: unknown[] }>('http://core.test', '/api/v1/public/announcements');
    expect(result).toEqual({ items: [] });
  });

  it('throws ApiError with the envelope fields on a non-2xx response — API §0.4', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(503, {
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Try again shortly.',
          correlationId: '01J8ZQ7K4M9X2P',
        },
      }),
    );

    await expect(apiGet('http://core.test', '/api/v1/public/announcements')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Try again shortly.',
      correlationId: '01J8ZQ7K4M9X2P',
      status: 503,
    });
  });

  it('is an instance of ApiError so callers can branch on `code`, never on `message`', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'Not found.', correlationId: 'abc' } }),
    );
    await expect(apiGet('http://core.test', '/x')).rejects.toBeInstanceOf(ApiError);
  });

  it('throws MalformedApiResponseError when a non-2xx body does not match the envelope', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(500, { oops: true }));
    await expect(apiGet('http://core.test', '/x')).rejects.toBeInstanceOf(MalformedApiResponseError);
  });
});

describe('apiPost/apiPatch/apiDelete', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('apiPost sends the method, JSON body, and credentials, with no X-CSRF-Token when omitted', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { ok: true }));
    await apiPost('http://core.test', '/api/v1/auth/login', { email: 'a@diu.edu.bd', password: 'x' });

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('http://core.test/api/v1/auth/login');
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('include');
    expect(init?.body).toBe(JSON.stringify({ email: 'a@diu.edu.bd', password: 'x' }));
    expect((init?.headers as Record<string, string>)['X-CSRF-Token']).toBeUndefined();
  });

  it('apiPost attaches X-CSRF-Token when given — API §0.2', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, {}));
    await apiPost('http://core.test', '/api/v1/auth/logout', {}, 'csrf-abc');

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect((init?.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-abc');
  });

  it('apiPatch sends method PATCH with the CSRF token', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, {}));
    await apiPatch('http://core.test', '/api/v1/me', { fullName: 'New Name', version: 1 }, 'csrf-abc');

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(init?.method).toBe('PATCH');
    expect((init?.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-abc');
  });

  it('apiDelete sends method DELETE with a body and the CSRF token', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, {}));
    await apiDelete('http://core.test', '/api/v1/users/u1/roles/STO', { reason: 'Transferred out' }, 'csrf-abc');

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(init?.method).toBe('DELETE');
    expect(init?.body).toBe(JSON.stringify({ reason: 'Transferred out' }));
  });

  it('resolves to undefined on a 204 response rather than trying to parse an empty body', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));
    await expect(apiPost('http://core.test', '/api/v1/auth/logout', {}, 'csrf-abc')).resolves.toBeUndefined();
  });

  it('throws ApiError on a non-2xx mutating response, same as apiGet', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(409, { error: { code: 'CONFLICT_STALE_VERSION', message: 'Stale.', correlationId: 'c1' } }),
    );
    await expect(apiPatch('http://core.test', '/api/v1/me', { version: 1 }, 'csrf-abc')).rejects.toBeInstanceOf(ApiError);
  });
});
