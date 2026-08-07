import * as client from 'openid-client';

import type {
  CompleteSsoLoginInput,
  SsoAuthorizationRequest,
  SsoClient,
  SsoIdentity,
} from '../application/sso-client.js';

export interface OpenIdClientSsoConfig {
  readonly issuerUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

/**
 * Real OAuth2 Authorization Code + PKCE against DIU's identity provider
 * (FR-AUTH-01), via `openid-client` — a vetted library, not hand-rolled
 * crypto, for exactly the reason ADR-style decisions in this codebase
 * always give: PKCE verifier generation and state comparison are
 * security-sensitive enough that "we wrote it carefully" is not the same
 * property as "a maintained, audited implementation verified it."
 *
 * `discovery()` makes a real network call to the IdP's well-known metadata
 * endpoint — memoized here so it only happens once, lazily, on first use.
 * No real DIU identity provider exists in development, so this class's
 * `isConfigured` gate and its unit tests (against a fake `SsoClient`) are
 * as far as this repository can verify it; the discovery/exchange calls
 * themselves are unverifiable without real IdP credentials, the same
 * external-dependency gap as the counseling service's `[R3]` content.
 */
export class OpenIdClientSsoAdapter implements SsoClient {
  private configuration: Promise<client.Configuration> | undefined;

  constructor(private readonly ssoConfig: OpenIdClientSsoConfig | undefined) {}

  get isConfigured(): boolean {
    return this.ssoConfig !== undefined;
  }

  async createAuthorizationRequest(redirectTo: string | undefined): Promise<SsoAuthorizationRequest> {
    const config = await this.discover();
    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const state = client.randomState();

    const parameters: Record<string, string> = {
      redirect_uri: this.requireConfig().redirectUri,
      scope: 'openid email profile',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      ...(redirectTo !== undefined && { redirectTo }),
    };

    const url = client.buildAuthorizationUrl(config, parameters);
    return { redirectUrl: url.href, state, codeVerifier };
  }

  async completeLogin(input: CompleteSsoLoginInput): Promise<SsoIdentity> {
    const config = await this.discover();
    const tokens = await client.authorizationCodeGrant(config, input.callbackUrl, {
      pkceCodeVerifier: input.codeVerifier,
      expectedState: input.expectedState,
    });

    const idTokenClaims = tokens.claims();
    const subject = idTokenClaims?.sub;
    if (subject === undefined) {
      throw new Error('SSO identity provider did not return a subject claim.');
    }

    const userInfo = await client.fetchUserInfo(config, tokens.access_token, subject);
    const email = userInfo.email;
    const fullName = userInfo.name;
    if (typeof email !== 'string' || typeof fullName !== 'string') {
      throw new Error('SSO identity provider did not return the required email/name claims.');
    }

    return { subject, email, fullName };
  }

  private discover(): Promise<client.Configuration> {
    this.configuration ??= this.performDiscovery();
    return this.configuration;
  }

  private performDiscovery(): Promise<client.Configuration> {
    const config = this.requireConfig();
    return client.discovery(new URL(config.issuerUrl), config.clientId, config.clientSecret);
  }

  private requireConfig(): OpenIdClientSsoConfig {
    if (this.ssoConfig === undefined) {
      throw new Error('SSO is not configured.');
    }
    return this.ssoConfig;
  }
}
