import { describe, expect, it, vi } from 'vitest';

import type { SsoAuthorizationRequest, SsoClient } from '../sso-client.js';

import { SsoLoginHandler } from './sso-login.query.js';

const AUTHORIZATION_REQUEST: SsoAuthorizationRequest = {
  redirectUrl: 'https://idp.diu.edu.bd/authorize?...',
  state: 'state-1',
  codeVerifier: 'verifier-1',
};

describe('SsoLoginHandler — API §1.1', () => {
  it('returns SSO_UNAVAILABLE (mapped to 503) when no IdP is configured', async () => {
    const ssoClient: SsoClient = {
      isConfigured: false,
      createAuthorizationRequest: vi.fn(),
      completeLogin: vi.fn(),
    };
    const handler = new SsoLoginHandler(ssoClient);

    const result = await handler.execute(undefined);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SSO_UNAVAILABLE');
    expect(ssoClient.createAuthorizationRequest).not.toHaveBeenCalled();
  });

  it('rejects an absolute redirectTo with INVALID_REDIRECT before ever consulting the IdP', async () => {
    const ssoClient: SsoClient = {
      isConfigured: true,
      createAuthorizationRequest: vi.fn(),
      completeLogin: vi.fn(),
    };
    const handler = new SsoLoginHandler(ssoClient);

    const result = await handler.execute('https://evil.example.com');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_REDIRECT');
    expect(ssoClient.createAuthorizationRequest).not.toHaveBeenCalled();
  });

  it('rejects a protocol-relative redirectTo — "//evil.example.com" is not same-origin', async () => {
    const ssoClient: SsoClient = { isConfigured: true, createAuthorizationRequest: vi.fn(), completeLogin: vi.fn() };
    const handler = new SsoLoginHandler(ssoClient);

    const result = await handler.execute('//evil.example.com');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_REDIRECT');
  });

  it('returns the authorization request when configured and redirectTo is safe', async () => {
    const ssoClient: SsoClient = {
      isConfigured: true,
      createAuthorizationRequest: vi.fn().mockResolvedValue(AUTHORIZATION_REQUEST),
      completeLogin: vi.fn(),
    };
    const handler = new SsoLoginHandler(ssoClient);

    const result = await handler.execute('/student');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(AUTHORIZATION_REQUEST);
    expect(ssoClient.createAuthorizationRequest).toHaveBeenCalledWith('/student');
  });
});
