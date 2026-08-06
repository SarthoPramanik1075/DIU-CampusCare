import { describe, expect, it, vi } from 'vitest';

import { CORE_PERMISSION_MATRIX, CORE_RESOURCE_NAMES } from './permission-matrix.js';
import { PolicyDecisionPoint, type AuthorizationSubject } from './policy-decision-point.js';

const pdp = new PolicyDecisionPoint();

function subject(overrides: Partial<AuthorizationSubject> = {}): AuthorizationSubject {
  return { roles: ['STU'], accountStatus: 'active', ...overrides };
}

describe('PolicyDecisionPoint', () => {
  // FR-AUTH-09 / BR-01 — this check precedes the matrix entirely.
  describe('account status', () => {
    it.each(['pending', 'suspended', 'deactivated'] as const)(
      'denies with ACCOUNT_NOT_ACTIVE when status is %s, even for an otherwise-granted action',
      async (accountStatus) => {
        const decision = await pdp.decide({
          subject: subject({ roles: ['ADM'], accountStatus }),
          resource: 'announcements',
          action: 'read',
        });
        expect(decision).toMatchObject({ permit: false, reasonCode: 'ACCOUNT_NOT_ACTIVE' });
      },
    );

    it('does not apply the active-account check to ANON, whose accountStatus is null', async () => {
      const decision = await pdp.decide({
        subject: subject({ roles: ['ANON'], accountStatus: null }),
        resource: 'public-availability-view',
        action: 'read',
      });
      expect(decision).toEqual({ permit: true });
    });
  });

  // PRM-02 — the default.
  describe('deny by default', () => {
    it('denies an action with no matching rule for any held role', async () => {
      const decision = await pdp.decide({
        subject: subject({ roles: ['STU'] }),
        resource: 'medicine-stock-quantities',
        action: 'update',
      });
      expect(decision).toMatchObject({ permit: false, reasonCode: 'NO_MATCHING_RULE' });
    });

    it('denies an action the role holds for a different verb on the same resource', async () => {
      // STU may create/read/update its own appointments, never delete them.
      const decision = await pdp.decide({
        subject: subject({ roles: ['STU'] }),
        resource: 'appointment-own',
        action: 'delete',
        isOwner: () => true,
      });
      expect(decision.permit).toBe(false);
    });
  });

  // scope: 'any'
  describe('scope: any', () => {
    it('permits without consulting an ownership evaluator', async () => {
      const isOwner = vi.fn();
      const decision = await pdp.decide({
        subject: subject({ roles: ['STO'] }),
        resource: 'medicine-catalogue',
        action: 'create',
        isOwner,
      });
      expect(decision).toEqual({ permit: true });
      expect(isOwner).not.toHaveBeenCalled();
    });
  });

  // scope: 'own'
  describe('scope: own', () => {
    it('permits when the ownership evaluator returns true', async () => {
      const decision = await pdp.decide({
        subject: subject({ roles: ['STU'] }),
        resource: 'appointment-own',
        action: 'read',
        isOwner: () => true,
      });
      expect(decision).toEqual({ permit: true });
    });

    it('denies when the ownership evaluator returns false', async () => {
      const decision = await pdp.decide({
        subject: subject({ roles: ['STU'] }),
        resource: 'appointment-own',
        action: 'read',
        isOwner: () => false,
      });
      expect(decision).toMatchObject({ permit: false, reasonCode: 'NO_MATCHING_RULE' });
    });

    it('awaits an async ownership evaluator', async () => {
      const decision = await pdp.decide({
        subject: subject({ roles: ['STU'] }),
        resource: 'appointment-own',
        action: 'read',
        isOwner: () => Promise.resolve(true),
      });
      expect(decision).toEqual({ permit: true });
    });

    it('fails closed — denies rather than guesses — when no ownership evaluator is supplied', async () => {
      const decision = await pdp.decide({
        subject: subject({ roles: ['STU'] }),
        resource: 'appointment-own',
        action: 'read',
      });
      expect(decision).toMatchObject({ permit: false, reasonCode: 'NO_MATCHING_RULE' });
    });
  });

  // BR-03 — permissions are the union of every held role.
  describe('multiple roles (BR-03 union)', () => {
    it('permits via a second role when the first role fails its ownership check', async () => {
      const decision = await pdp.decide({
        subject: subject({ roles: ['DOC', 'MCS'] }), // DOC: own-session read only. MCS: any.
        resource: 'appointment-any',
        action: 'read',
        isOwner: () => false,
      });
      expect(decision).toEqual({ permit: true });
    });

    it('permits via the first role without needing the second', async () => {
      const decision = await pdp.decide({
        subject: subject({ roles: ['MCS', 'STO'] }),
        resource: 'walk-in-registration',
        action: 'create',
      });
      expect(decision).toEqual({ permit: true });
    });

    it('denies when no held role grants the action', async () => {
      const decision = await pdp.decide({
        subject: subject({ roles: ['DOC', 'CNP'] }),
        resource: 'medicine-stock-quantities',
        action: 'read',
      });
      expect(decision.permit).toBe(false);
    });
  });

  // PRM-04/PRM-09-shaped property test: sweep the whole matrix and confirm
  // the PDP's verdict always matches what the data says, for every
  // resource/role/action combination — not just the cases picked above.
  describe('exhaustive sweep of the matrix', () => {
    const allActions = ['create', 'read', 'update', 'delete'] as const;

    it.each(CORE_RESOURCE_NAMES)('resource "%s": every role × action matches its grant', async (resource) => {
      for (const role of ['ANON', 'STU', 'DOC', 'MCS', 'STO', 'CNP', 'ADM'] as const) {
        const grant = CORE_PERMISSION_MATRIX[resource][role];
        for (const action of allActions) {
          const expectedPermit = grant?.actions.includes(action) ?? false;

          const decision = await pdp.decide({
            subject: { roles: [role], accountStatus: role === 'ANON' ? null : 'active' },
            resource,
            action,
            isOwner: () => true, // grant ownership so scope:'own' rows are exercised as permits too
          });
          expect(
            decision.permit,
            `${resource} / ${role} / ${action} expected permit=${String(expectedPermit)}`,
          ).toBe(expectedPermit);
        }
      }
    });
  });
});
