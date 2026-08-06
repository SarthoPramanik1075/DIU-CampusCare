import type { AuthorizationSubject } from '../authz/policy-decision-point.js';

/**
 * Resolves the {@link AuthorizationSubject} for an incoming request.
 *
 * As of M0.5 this can only ever produce the anonymous subject: there is no
 * identity module yet — no `user_account`, no `user_role`, no login
 * endpoint (that is M1 Foundations) — so no session cookie, however
 * well-formed, could be resolved to a real account and its roles. This is
 * the complete and correct behaviour for a system with no way to sign in,
 * not a stub standing in for logic that is missing. M1 replaces the body of
 * this function with real cookie-to-account-to-roles resolution; it does
 * not "fill in" this one.
 */
export function resolveAnonymousSubject(): AuthorizationSubject {
  return { roles: ['ANON'], accountStatus: null };
}
