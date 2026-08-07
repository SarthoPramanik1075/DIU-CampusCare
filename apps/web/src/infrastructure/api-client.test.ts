import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiGet, ApiError, MalformedApiResponseError } from './api-client.js';

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
