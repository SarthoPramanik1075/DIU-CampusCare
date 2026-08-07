import type { PolicyStore } from '../../kernel/policy/policy-store.js';

/**
 * Seeds the 【A】 configuration values FR-AUTH-06/14 and OI-14 mark as
 * administrator-adjustable — DR-4 forbids these appearing as literals in
 * `login-with-password.handler.ts` or anywhere else. `defineIfAbsent` is
 * idempotent (an `ON CONFLICT DO NOTHING` insert), so calling this on every
 * boot is safe and never overwrites a value an Administrator has since
 * changed through A-05.
 *
 * The min/max bounds are this implementation's own choice, not a number
 * OI-14 specifies — OI-14 fixes the *default* (30/15 minutes, 5 attempts,
 * 15 minutes) but says nothing about the adjustable range VR-94 requires
 * every ranged config value to have. Conservative bounds are set here;
 * A-05 lets an Administrator narrow or widen them later if that turns out
 * to be wrong.
 */
export async function seedIamPolicies(policyStore: PolicyStore): Promise<void> {
  await policyStore.defineIfAbsent({
    key: 'auth.session.idleTimeoutMinutes.student',
    valueType: 'integer',
    valueText: '30',
    minValue: '5',
    maxValue: '120',
    description: 'Minutes of inactivity before a student session expires (FR-AUTH-06).',
  });

  await policyStore.defineIfAbsent({
    key: 'auth.session.idleTimeoutMinutes.staff',
    valueType: 'integer',
    valueText: '15',
    minValue: '5',
    maxValue: '60',
    description:
      'Minutes of inactivity before a non-student session expires — DOC/MCS/STO/CNP/ADM (FR-AUTH-06).',
  });

  await policyStore.defineIfAbsent({
    key: 'auth.lockout.maxAttempts',
    valueType: 'integer',
    valueText: '5',
    minValue: '3',
    maxValue: '10',
    description: 'Consecutive failed sign-in attempts before an account locks (FR-AUTH-14).',
  });

  await policyStore.defineIfAbsent({
    key: 'auth.lockout.durationMinutes',
    valueType: 'integer',
    valueText: '15',
    minValue: '5',
    maxValue: '60',
    description: 'How long a locked account stays locked (FR-AUTH-14).',
  });

  await policyStore.defineIfAbsent({
    key: 'auth.passwordReset.expiryMinutes',
    valueType: 'integer',
    valueText: '30',
    minValue: '5',
    maxValue: '60',
    description: 'How long a password-reset link stays valid before it must be re-requested (FR-AUTH-08).',
  });
}
