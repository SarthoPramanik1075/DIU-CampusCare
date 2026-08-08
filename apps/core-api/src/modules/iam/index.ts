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
export { isRoleAssignableByAdmin, roleRequiresClinicalStaff } from './domain/role.js';
export {
  evaluatePasswordComplexity,
  isDiuInstitutionalEmail,
  type PasswordComplexity,
} from './domain/validation.js';
export { defaultLandingPath } from './domain/default-landing-path.js';
export { PasswordHasher } from './infrastructure/password-hasher.js';
export { PasswordResetTokenGenerator } from './infrastructure/password-reset-token-generator.js';
export { KyselyAuthenticationRepository } from './infrastructure/authentication.repository.js';
export { KyselyPasswordResetRepository } from './infrastructure/password-reset.repository.js';
export { KyselyOwnProfileRepository } from './infrastructure/own-profile.repository.js';
export { KyselyAccountAdminRepository } from './infrastructure/account-admin.repository.js';
export {
  OpenIdClientSsoAdapter,
  type OpenIdClientSsoConfig,
} from './infrastructure/openid-client-sso.adapter.js';
export type {
  AccountSummary,
  AccountWithCredential,
  AuthenticationRepository,
} from './application/authentication-repository.js';
export type {
  CreateResetTokenInput,
  PasswordResetRepository,
  ValidResetToken,
} from './application/password-reset-repository.js';
export type {
  OwnProfileAccount,
  OwnProfileRepository,
  StudentProfile,
  UpdateFullNameInput,
  UpdateFullNameOutcome,
} from './application/own-profile-repository.js';
export type {
  AccountAdminRepository,
  AccountDetail,
  AccountListFilter,
  AccountListItem,
  AccountListPage,
  ActiveAppointmentSummary,
  CreateAccountInput,
  CreateAccountResult,
  GrantRoleInput,
  GrantRoleOutcome,
  RevokeRoleInput,
  RevokeRoleOutcome,
  RoleCatalogueEntry,
  RoleGrant,
  TransitionStatusInput,
  TransitionStatusOutcome,
  UpdateAccountAdminInput,
  UpdateAccountAdminOutcome,
} from './application/account-admin-repository.js';
export { ActivateAccountHandler } from './application/activate-account.handler.js';
export { ConfirmPasswordResetHandler } from './application/confirm-password-reset.handler.js';
export { CreateAccountHandler } from './application/create-account.handler.js';
export { DeactivateAccountHandler } from './application/deactivate-account.handler.js';
export { GrantRoleHandler } from './application/grant-role.handler.js';
export { LoginWithPasswordHandler, type LoginSuccess } from './application/login-with-password.handler.js';
export { LogoutHandler } from './application/logout.handler.js';
export { GetAccountDetailQuery } from './application/queries/get-account-detail.query.js';
export { GetOwnProfileQuery, type OwnProfile } from './application/queries/get-own-profile.query.js';
export { GetSessionQuery, type SessionSnapshot } from './application/queries/get-session.query.js';
/** Generic "who, specifically, is asking" resolution from the session cookie — reused by other modules' routes (e.g. `scheduling`) rather than duplicating this cookie-reading path. */
export { resolveOwnUserId, unauthenticatedError } from './application/resolve-own-user-id.js';
export { ListAccountsQuery } from './application/queries/list-accounts.query.js';
export { ListRoleCatalogueQuery } from './application/queries/list-role-catalogue.query.js';
export { SsoLoginHandler } from './application/queries/sso-login.query.js';
export { RequestPasswordResetHandler } from './application/request-password-reset.handler.js';
export { RevokeRoleHandler } from './application/revoke-role.handler.js';
export { SuspendAccountHandler } from './application/suspend-account.handler.js';
export { UpdateAccountAdminHandler } from './application/update-account-admin.handler.js';
export { UpdateOwnProfileHandler } from './application/update-own-profile.handler.js';
export {
  createAuthenticatedSubjectResolver,
  SESSION_COOKIE_NAME,
} from './application/resolve-authenticated-subject.js';
export { SessionIssuer, type IssuedSession } from './application/session-issuer.js';
export type { SsoClient, SsoAuthorizationRequest, SsoIdentity } from './application/sso-client.js';
export { SsoCallbackHandler } from './application/sso-callback.handler.js';
export { registerAccountAdminRoutes, type AccountAdminRouteDeps } from './interface/http/account-admin.routes.js';
export { registerAuthRoutes, type AuthRouteDeps } from './interface/http/auth.routes.js';
export { registerOwnProfileRoutes, type OwnProfileRouteDeps } from './interface/http/own-profile.routes.js';
