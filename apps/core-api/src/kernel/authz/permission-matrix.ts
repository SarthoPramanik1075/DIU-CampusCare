import type { RoleCode } from '@campuscare/shared-types';

/**
 * The permission matrix as declarative data — SRS §3.5.2, ARCHITECTURE §8.3.
 *
 * "Adding a resource without a rule fails closed" (PRM-02) only holds if the
 * matrix is data a machine can walk, not conditionals scattered through
 * handlers. This file is that data. It is also, deliberately, testable as
 * data: `permission-matrix.test.ts` re-derives this exact table from the SRS
 * text so a transcription error is a failing test, not a silent gap.
 *
 * ## Scope: 24 of the SRS's 30 resource rows
 *
 * SRS §3.5.2 lists 30 resources in one table because it is describing the
 * system as a whole. But six of those rows — counseling availability,
 * counseling request (own and any), counseling case & notes, counseling case
 * existence, and the counseling access log — are enforced by the
 * **counseling-api** service's own Clinical PEP, against its own clinical
 * roster, in its own database (ADR-001, ADR-012). Core-api holds no
 * credential to that database and no route within it ever accepts a
 * counseling resource name; encoding those six rows here would be dead data
 * at best and a standing invitation to build a Core-side counseling
 * shortcut at worst (exactly what DR-3 forbids). They belong to
 * counseling-api's own permission matrix, built in that service's own
 * milestone (M6).
 *
 * The 24 rows here are everything else.
 */

export type PermissionAction = 'create' | 'read' | 'update' | 'delete';

/**
 * `'any'`  — granted unconditionally to every subject holding the role.
 * `'own'`  — granted only when the caller-supplied {@link OwnershipEvaluator}
 *            confirms the subject owns the specific resource instance. The
 *            kernel has no domain knowledge of what "owns" a doctor profile
 *            or an appointment (DR-1), so it never evaluates this itself.
 */
export type PermissionScope = 'any' | 'own';

export interface PermissionGrant {
  readonly actions: readonly PermissionAction[];
  readonly scope: PermissionScope;
  /**
   * A nuance SRS §3.5.2 states in the same cell that the PDP does not itself
   * apply — response shaping, mostly: "band only", "metadata only", "serial
   * only". Enforcing the note is the owning module's responsibility (its
   * query only selects the permitted columns); the PDP only decides whether
   * the operation is permitted at all. Documentation, not behaviour.
   */
  readonly note?: string;
}

export const CORE_RESOURCE_NAMES = [
  'public-availability-view',
  'own-profile',
  'user-accounts-and-roles',
  'doctor-profiles',
  'doctor-schedules-and-sessions',
  'non-service-calendar',
  'appointment-own',
  'appointment-any',
  'live-queue',
  'walk-in-registration',
  'emergency-designation',
  'reason-for-visit',
  'payment-record',
  'daily-collection-summary',
  'medicine-catalogue',
  'medicine-stock-quantities',
  'stock-movements',
  'store-hours-and-status',
  'notifications-own',
  'notification-templates',
  'system-configuration',
  'announcements',
  'general-audit-log',
  'data-export',
] as const;

export type CoreResourceName = (typeof CORE_RESOURCE_NAMES)[number];

export type PermissionMatrix = Readonly<
  Record<CoreResourceName, Readonly<Partial<Record<RoleCode, PermissionGrant>>>>
>;

const READ_ANY: PermissionGrant = { actions: ['read'], scope: 'any' };
const CRUD_ANY: PermissionGrant = { actions: ['create', 'read', 'update', 'delete'], scope: 'any' };

export const CORE_PERMISSION_MATRIX: PermissionMatrix = {
  // "Public availability view | R | R | R | R | R | R | R" — every role, ANON included.
  'public-availability-view': {
    ANON: READ_ANY,
    STU: READ_ANY,
    DOC: READ_ANY,
    MCS: READ_ANY,
    STO: READ_ANY,
    CNP: READ_ANY,
    ADM: READ_ANY,
  },

  // "Own profile | — | R U | R U | R U | R U | R U | R U"
  'own-profile': {
    STU: { actions: ['read', 'update'], scope: 'own' },
    DOC: { actions: ['read', 'update'], scope: 'own' },
    MCS: { actions: ['read', 'update'], scope: 'own' },
    STO: { actions: ['read', 'update'], scope: 'own' },
    CNP: { actions: ['read', 'update'], scope: 'own' },
    ADM: { actions: ['read', 'update'], scope: 'own' },
  },

  // "User accounts & roles | — | — | — | — | — | — | C R U D"
  'user-accounts-and-roles': {
    ADM: CRUD_ANY,
  },

  // "Doctor profiles | R | R | R own | C R U D | — | — | R"
  'doctor-profiles': {
    ANON: READ_ANY,
    STU: READ_ANY,
    DOC: { actions: ['read'], scope: 'own' },
    MCS: CRUD_ANY,
    ADM: READ_ANY,
  },

  // "Doctor schedules & sessions | R | R | R | C R U D | — | — | R"
  'doctor-schedules-and-sessions': {
    ANON: READ_ANY,
    STU: READ_ANY,
    DOC: READ_ANY,
    MCS: CRUD_ANY,
    ADM: READ_ANY,
  },

  // "Non-service calendar | R | R | R | R | R | R | C R U D"
  'non-service-calendar': {
    ANON: READ_ANY,
    STU: READ_ANY,
    DOC: READ_ANY,
    MCS: READ_ANY,
    STO: READ_ANY,
    CNP: READ_ANY,
    ADM: CRUD_ANY,
  },

  // "Appointment (own) | — | C R U(cancel) own | — | — | — | — | —"
  'appointment-own': {
    STU: { actions: ['create', 'read', 'update'], scope: 'own' },
  },

  // "Appointment (any) | — | — | R own-session | C R U | — | — | R (metadata only)"
  'appointment-any': {
    DOC: { actions: ['read'], scope: 'own', note: 'own-session: sessions assigned to that doctor' },
    MCS: { actions: ['create', 'read', 'update'], scope: 'any' },
    ADM: { ...READ_ANY, note: 'metadata only — no student identity, no reason-for-visit (PRM-09)' },
  },

  // "Live queue | R (serial only) | R own position | R own session | R U | — | — | R"
  'live-queue': {
    ANON: { ...READ_ANY, note: 'serial only — no patient identity (BR-04)' },
    STU: { actions: ['read'], scope: 'own', note: 'own position only' },
    DOC: { actions: ['read'], scope: 'own', note: 'own session only' },
    MCS: { actions: ['read', 'update'], scope: 'any' },
    ADM: READ_ANY,
  },

  // "Walk-in registration | — | — | — | C | — | — | —"
  'walk-in-registration': {
    MCS: { actions: ['create'], scope: 'any' },
  },

  // "Emergency designation | — | — | — | C | — | — | —"
  'emergency-designation': {
    MCS: { actions: ['create'], scope: 'any' },
  },

  // "Reason-for-visit | — | C own | R own-session | R | — | — | —"
  'reason-for-visit': {
    STU: { actions: ['create'], scope: 'own' },
    DOC: { actions: ['read'], scope: 'own', note: 'own-session' },
    MCS: READ_ANY,
  },

  // "Payment record | — | R own | — | C R U | — | — | R"
  'payment-record': {
    STU: { actions: ['read'], scope: 'own' },
    MCS: { actions: ['create', 'read', 'update'], scope: 'any' },
    ADM: READ_ANY,
  },

  // "Daily collection summary | — | — | — | R | — | — | R"
  'daily-collection-summary': {
    MCS: READ_ANY,
    ADM: READ_ANY,
  },

  // "Medicine catalogue | R (band only) x5 | STO: C R U D | ADM: R"
  'medicine-catalogue': {
    ANON: { ...READ_ANY, note: 'band only — no exact quantity (FR-MED-05, BR-35)' },
    STU: { ...READ_ANY, note: 'band only' },
    DOC: { ...READ_ANY, note: 'band only' },
    MCS: { ...READ_ANY, note: 'band only' },
    CNP: { ...READ_ANY, note: 'band only' },
    STO: CRUD_ANY,
    ADM: READ_ANY,
  },

  // "Medicine stock quantities | — | — | — | — | R U | — | R"
  'medicine-stock-quantities': {
    STO: { actions: ['read', 'update'], scope: 'any' },
    ADM: READ_ANY,
  },

  // "Stock movements | — | — | — | — | C R | — | R"
  'stock-movements': {
    STO: { actions: ['create', 'read'], scope: 'any' },
    ADM: READ_ANY,
  },

  // "Store hours & status | R x6 | STO: C R U"
  'store-hours-and-status': {
    ANON: READ_ANY,
    STU: READ_ANY,
    DOC: READ_ANY,
    MCS: READ_ANY,
    CNP: READ_ANY,
    ADM: READ_ANY,
    STO: { actions: ['create', 'read', 'update'], scope: 'any' },
  },

  // "Notifications (own) | — | R U x6"
  'notifications-own': {
    STU: { actions: ['read', 'update'], scope: 'own' },
    DOC: { actions: ['read', 'update'], scope: 'own' },
    MCS: { actions: ['read', 'update'], scope: 'own' },
    STO: { actions: ['read', 'update'], scope: 'own' },
    CNP: { actions: ['read', 'update'], scope: 'own' },
    ADM: { actions: ['read', 'update'], scope: 'own' },
  },

  // "Notification templates | — x6 | R U"
  'notification-templates': {
    ADM: { actions: ['read', 'update'], scope: 'any' },
  },

  // "System configuration | — x6 | R U"
  'system-configuration': {
    ADM: { actions: ['read', 'update'], scope: 'any' },
  },

  // "Announcements | R x6 | C R U D"
  announcements: {
    ANON: READ_ANY,
    STU: READ_ANY,
    DOC: READ_ANY,
    MCS: READ_ANY,
    STO: READ_ANY,
    CNP: READ_ANY,
    ADM: CRUD_ANY,
  },

  // "General audit log | — x6 | R"
  'general-audit-log': {
    ADM: READ_ANY,
  },

  // "Data export | — x6 | C"
  'data-export': {
    ADM: { actions: ['create'], scope: 'any' },
  },
};
