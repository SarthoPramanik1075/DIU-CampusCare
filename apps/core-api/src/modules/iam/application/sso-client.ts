/**
 * Port for the OAuth2 Authorization Code + PKCE flow against DIU's SSO
 * identity provider (FR-AUTH-01, API §1.1/§1.2). `application/` owns this
 * interface so the callback handler's business logic — validate state,
 * find-or-provision the account, issue a session — is testable without a
 * real identity provider; `infrastructure/openid-client-sso.adapter.ts`
 * supplies the real implementation.
 */
export interface SsoAuthorizationRequest {
  /** Where to redirect the browser (the IdP's authorization endpoint, with query parameters). */
  readonly redirectUrl: string;
  readonly state: string;
  readonly codeVerifier: string;
}

/** Claims recovered from the IdP once the code exchange succeeds. */
export interface SsoIdentity {
  readonly subject: string;
  readonly email: string;
  readonly fullName: string;
}

export interface CompleteSsoLoginInput {
  /** The full callback URL the browser was redirected to, including its query string. */
  readonly callbackUrl: URL;
  readonly codeVerifier: string;
  readonly expectedState: string;
}

export interface SsoClient {
  /** `false` when no IdP is configured (`SSO_ISSUER_URL` etc. unset) — API §1.1's `SSO_UNAVAILABLE` path. */
  readonly isConfigured: boolean;
  createAuthorizationRequest(redirectTo: string | undefined): Promise<SsoAuthorizationRequest>;
  completeLogin(input: CompleteSsoLoginInput): Promise<SsoIdentity>;
}
