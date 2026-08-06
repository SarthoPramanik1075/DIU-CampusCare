import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { registerCorrelationId } from '../http/correlation.js';

import { createCounselingFeatureGate } from './counseling-gate.js';

/**
 * No production route exists in this service yet (M6 adds the first). This
 * proves the gate mechanism itself against a throwaway route registered
 * only inside the test — the gate is what M6's real routes will rely on,
 * and it needs to be correct before they exist, not verified for the first
 * time once they do.
 */
describe('createCounselingFeatureGate — BR-68', () => {
  async function buildTestApp(enabled: boolean) {
    const app = Fastify();
    await app.register(registerCorrelationId);
    await app.register(createCounselingFeatureGate(enabled));
    app.get('/counseling/api/v1/example', () => ({ ok: true }));
    await app.ready();
    return app;
  }

  let app: Awaited<ReturnType<typeof buildTestApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('lets requests through normally when the flag is on', async () => {
    app = await buildTestApp(true);
    const response = await app.inject({ method: 'GET', url: '/counseling/api/v1/example' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('returns 404 — not 403 — for an existing route when the flag is off', async () => {
    app = await buildTestApp(false);
    const response = await app.inject({ method: 'GET', url: '/counseling/api/v1/example' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('returns the same 404 shape for a route that never existed, when the flag is off', async () => {
    app = await buildTestApp(false);
    const response = await app.inject({ method: 'GET', url: '/counseling/api/v1/does-not-exist' });
    expect(response.statusCode).toBe(404);
    // Same code and shape as the real route above — BR-68 requires a 404
    // that cannot be used to infer which routes exist.
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('still returns 404 for an unmatched route when the flag is on', async () => {
    app = await buildTestApp(true);
    const response = await app.inject({ method: 'GET', url: '/counseling/api/v1/does-not-exist' });
    expect(response.statusCode).toBe(404);
  });
});
