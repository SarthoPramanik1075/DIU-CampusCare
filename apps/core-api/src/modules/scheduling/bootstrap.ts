import type { PolicyStore } from '../../kernel/policy/policy-store.js';

/**
 * Seeds the 【A】 configuration values OI-05/OI-06/OI-07 mark as
 * administrator-adjustable — DR-4 forbids these appearing as literals in
 * `create-clinic-session.handler.ts` or anywhere else. Mirrors
 * `modules/iam/bootstrap.ts`'s `seedIamPolicies` exactly: `defineIfAbsent`
 * is idempotent, safe to call on every boot, and never overwrites a value
 * an Administrator has since changed through A-05.
 *
 * The min/max bounds are this implementation's own choice — OI-05/06/07
 * fix only the *defaults* (10 minutes, 30%, 7 days), not the adjustable
 * range VR-94 requires every ranged config value to carry.
 */
export async function seedSchedulingPolicies(policyStore: PolicyStore): Promise<void> {
  await policyStore.defineIfAbsent({
    key: 'scheduling.session.defaultSlotLengthMinutes',
    valueType: 'integer',
    valueText: '10',
    minValue: '5',
    maxValue: '60',
    description: 'Default slot length in minutes when creating a clinic session (OI-05, VR-12).',
  });

  await policyStore.defineIfAbsent({
    key: 'scheduling.session.defaultWalkInAllocationPct',
    valueType: 'integer',
    valueText: '30',
    minValue: '0',
    maxValue: '99',
    description: 'Default share of session capacity reserved for walk-ins, not bookable online (OI-06, BR-16, VR-13).',
  });

  await policyStore.defineIfAbsent({
    key: 'scheduling.publicationWindowDays',
    valueType: 'integer',
    valueText: '7',
    minValue: '1',
    maxValue: '30',
    description: 'How many days ahead students may view and book published sessions (OI-07, FR-SCH-12, VR-14).',
  });

  await policyStore.defineIfAbsent({
    key: 'scheduling.session.bookingCutoffMinutesBeforeStart',
    valueType: 'integer',
    valueText: '0',
    minValue: '0',
    maxValue: '1440',
    description: 'How long before a session starts online booking closes (FR-APT-11). Default: session start.',
  });
}
