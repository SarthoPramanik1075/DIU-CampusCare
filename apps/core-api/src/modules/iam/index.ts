/**
 * The IAM module's public interface — DR-2. Nothing outside this module
 * imports from `domain/`, `application/` or `infrastructure/` directly.
 * Named `iam` (not `identity` or `auth`) to match ARCHITECTURE.md's own
 * name for this module.
 */
export { seedIamPolicies } from './bootstrap.js';
export {
  canActivate,
  canDeactivate,
  canSuspend,
  type AccountStatus,
  type UserAccount,
} from './domain/user-account.js';
export {
  evaluatePasswordComplexity,
  isDiuInstitutionalEmail,
  type PasswordComplexity,
} from './domain/validation.js';
export { defaultLandingPath } from './domain/default-landing-path.js';
export { PasswordHasher } from './infrastructure/password-hasher.js';
export { KyselyAuthenticationRepository } from './infrastructure/authentication.repository.js';
export {
  OpenIdClientSsoAdapter,
  type OpenIdClientSsoConfig,
} from './infrastructure/openid-client-sso.adapter.js';
export type {
  AccountSummary,
  AccountWithCredential,
  AuthenticationRepository,
} from './application/authentication-repository.js';
export { LoginWithPasswordHandler, type LoginSuccess } from './application/login-with-password.handler.js';
export { LogoutHandler } from './application/logout.handler.js';
export { GetSessionQuery, type SessionSnapshot } from './application/queries/get-session.query.js';
export { SsoLoginHandler } from './application/queries/sso-login.query.js';
export {
  createAuthenticatedSubjectResolver,
  SESSION_COOKIE_NAME,
} from './application/resolve-authenticated-subject.js';
export { SessionIssuer, type IssuedSession } from './application/session-issuer.js';
export type { SsoClient, SsoAuthorizationRequest, SsoIdentity } from './application/sso-client.js';
export { SsoCallbackHandler } from './application/sso-callback.handler.js';
export { registerAuthRoutes, type AuthRouteDeps } from './interface/http/auth.routes.js';
