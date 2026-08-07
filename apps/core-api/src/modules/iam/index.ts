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
export { PasswordHasher } from './infrastructure/password-hasher.js';
