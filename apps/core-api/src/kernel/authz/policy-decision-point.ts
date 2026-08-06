import type { RoleCode } from '@campuscare/shared-types';

import type { AccountStatus } from '../../infrastructure/database/client.js';

import type { OwnershipEvaluator } from './ownership.js';
import {
  CORE_PERMISSION_MATRIX,
  type CoreResourceName,
  type PermissionAction,
  type PermissionMatrix,
} from './permission-matrix.js';

/**
 * The Policy Decision Point — ARCHITECTURE §8.1/§8.2.
 *
 * Pure decision logic, deliberately free of HTTP and of any database
 * dependency of its own: it is handed everything it needs to decide
 * (the subject, the matrix, an ownership thunk) and returns a decision. The
 * Policy *Enforcement* Point — the Fastify middleware that calls this,
 * extracts the subject from the session, and writes the PRM-12 denial log —
 * is HTTP-layer plumbing built in Checkpoint D, kept separate so this class
 * is testable with no server and no database running at all.
 *
 * This PDP decides access to the 24 core resources only. Counseling
 * resources are decided by counseling-api's own PDP against its own
 * clinical roster — see `permission-matrix.ts` for why they are not here.
 */
export interface AuthorizationSubject {
  /** `['ANON']` for an unauthenticated caller. BR-03: permissions are the union of every held role. */
  readonly roles: readonly RoleCode[];
  /** `null` for ANON, which has no account to be active or otherwise. */
  readonly accountStatus: AccountStatus | null;
}

export interface AuthorizationRequest {
  readonly subject: AuthorizationSubject;
  readonly resource: CoreResourceName;
  readonly action: PermissionAction;
  /** Required when a matched rule's scope is `'own'`; see {@link OwnershipEvaluator}. */
  readonly isOwner?: OwnershipEvaluator;
}

export type AuthorizationDecision =
  | { readonly permit: true }
  | {
      readonly permit: false;
      /** FR-AUTH-09/BR-01 vs PRM-02 — the two ways a request is denied. Maps 1:1 to a universal error code. */
      readonly reasonCode: 'ACCOUNT_NOT_ACTIVE' | 'NO_MATCHING_RULE';
      readonly message: string;
    };

export class PolicyDecisionPoint {
  constructor(private readonly matrix: PermissionMatrix = CORE_PERMISSION_MATRIX) {}

  async decide(request: AuthorizationRequest): Promise<AuthorizationDecision> {
    const { subject, resource, action } = request;

    // FR-AUTH-09 / BR-01: only an Active account may act. ANON has no
    // account at all (accountStatus is null) and is judged on the matrix
    // alone, same as every other role.
    if (subject.accountStatus !== null && subject.accountStatus !== 'active') {
      return {
        permit: false,
        reasonCode: 'ACCOUNT_NOT_ACTIVE',
        message: 'This account is not active.',
      };
    }

    const resourceRules = this.matrix[resource];

    // BR-03: the union of the subject's roles. The first role that grants
    // the action wins; a role whose rule is scoped to 'own' but fails the
    // ownership check does not end the search — a subject holding two roles
    // may still be permitted via the other one.
    for (const role of subject.roles) {
      const grant = resourceRules[role];
      if (!grant?.actions.includes(action)) continue;

      if (grant.scope === 'any') {
        return { permit: true };
      }

      // scope === 'own'. A caller invoking a scope-'own' rule without
      // supplying the ownership check is a bug in the calling module, not a
      // policy question — fail closed rather than guess.
      if (request.isOwner === undefined) continue;

       
      // check is independent and short-circuits the loop on the first
      // permit; running them concurrently would mean evaluating ownership
      // for roles the request may never need.
      if (await request.isOwner()) {
        return { permit: true };
      }
    }

    // PRM-02: absence of a matching, satisfied rule is a denial.
    return {
      permit: false,
      reasonCode: 'NO_MATCHING_RULE',
      message: 'You do not have permission to do that.',
    };
  }
}
