import type { PolicyStore } from '../../kernel/policy/policy-store.js';

/**
 * Seeds the 【A】 configuration values OI-08/09/10 and EC-12/15 mark as
 * administrator-adjustable — DR-4 forbids these appearing as literals in
 * any queueing handler. Mirrors `modules/scheduling/bootstrap.ts`'s
 * `seedSchedulingPolicies` exactly: `defineIfAbsent` is idempotent, safe
 * to call on every boot, and never overwrites a value an Administrator has
 * since changed through A-05.
 *
 * `scheduling.session.bookingCutoffMinutesBeforeStart` (OI-09's booking
 * cutoff) and `scheduling.publicationWindowDays` (OI-07) already exist
 * from M2 — not redeclared here.
 */
export async function seedQueueingPolicies(policyStore: PolicyStore): Promise<void> {
  await policyStore.defineIfAbsent({
    key: 'queueing.booking.maxActiveBookings',
    valueType: 'integer',
    valueText: '2',
    minValue: '1',
    maxValue: '10',
    description: 'Maximum simultaneous active bookings a student may hold (OI-08, BR-11, VR-21).',
  });

  await policyStore.defineIfAbsent({
    key: 'queueing.booking.cancellationCutoffMinutes',
    valueType: 'integer',
    valueText: '120',
    minValue: '0',
    maxValue: '1440',
    description: 'Free-cancellation window before the estimated time; later is a late cancellation (OI-09, BR-12).',
  });

  await policyStore.defineIfAbsent({
    key: 'queueing.booking.estimateSlipNotifyThresholdMinutes',
    valueType: 'integer',
    valueText: '30',
    minValue: '5',
    maxValue: '180',
    description: 'How far an estimate must slip from booking-time before the student is notified (OI-09, BR-20).',
  });

  await policyStore.defineIfAbsent({
    key: 'queueing.noShow.gracePeriodMinutes',
    valueType: 'integer',
    valueText: '20',
    minValue: '0',
    maxValue: '120',
    description: 'Minutes after being called before staff may mark a patient No-show (OI-10, BR-14, VR-31).',
  });

  await policyStore.defineIfAbsent({
    key: 'queueing.noShow.suspensionThresholdCount',
    valueType: 'integer',
    valueText: '3',
    minValue: '1',
    maxValue: '10',
    description: 'No-shows within the rolling window that trigger a booking suspension (OI-10, BR-15).',
  });

  await policyStore.defineIfAbsent({
    key: 'queueing.noShow.suspensionWindowDays',
    valueType: 'integer',
    valueText: '30',
    minValue: '1',
    maxValue: '365',
    description: 'Rolling window, in days, the No-show count is measured over (OI-10, BR-15).',
  });

  await policyStore.defineIfAbsent({
    key: 'queueing.noShow.suspensionDurationDays',
    valueType: 'integer',
    valueText: '14',
    minValue: '1',
    maxValue: '90',
    description: 'How long online booking is suspended once the threshold is reached (OI-10, BR-15). Walk-in access is never affected (FR-APT-13).',
  });

  await policyStore.defineIfAbsent({
    key: 'queueing.emergency.notificationThrottleMinutes',
    valueType: 'integer',
    valueText: '15',
    minValue: '1',
    maxValue: '120',
    description: 'Minimum interval between delay notifications to the same waiting patient, to avoid flooding on consecutive emergencies (EC-12).',
  });

  await policyStore.defineIfAbsent({
    key: 'queueing.estimation.anomalyMultiplier',
    valueType: 'integer',
    valueText: '4',
    minValue: '2',
    maxValue: '10',
    description: 'Consultation durations beyond this multiple of the slot length are excluded from the rolling mean (EC-15).',
  });

  await policyStore.defineIfAbsent({
    key: 'queueing.queuePosition.pollIntervalSeconds',
    valueType: 'integer',
    valueText: '20',
    minValue: '5',
    maxValue: '60',
    description: 'How often a student’s live queue-position view polls for updates (NFR-PERF-05’s 30s staleness bound).',
  });
}
