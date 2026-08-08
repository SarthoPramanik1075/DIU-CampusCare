import type { Generated } from 'kysely';

/**
 * The Kysely `Database` interface for `campuscare_core`.
 *
 * Transcribed from `apps/core-api/migrations/*.sql`, which is itself a
 * verbatim transcription of DATABASE.md — this file is the third link in
 * that chain, so it only declares the tables that code written so far
 * actually touches. Each feature module adds its own tables' interfaces
 * here as it is built, in the same migration order as the roadmap; this is
 * not the complete schema, and it is not meant to become complete in one
 * pass.
 *
 * `Generated<T>` marks a column the database populates when omitted from an
 * `insertInto(...).values(...)` call — because it has a `DEFAULT` clause in
 * the DDL. Primary keys are deliberately never `Generated`: DATABASE.md §3
 * requires UUIDv7 ids to be application-generated with no database default,
 * so that a missing id fails loudly rather than silently falling back to
 * something else.
 */

// ---------------------------------------------------------------------
// schema: config
// ---------------------------------------------------------------------

export interface LocationTable {
  id: string;
  code: string;
  name: string;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export type ConfigValueType = 'integer' | 'decimal' | 'boolean' | 'text' | 'duration';

export interface SystemConfigTable {
  id: string;
  config_key: string;
  value_type: ConfigValueType;
  value_text: string;
  min_value: string | null;
  max_value: string | null;
  description: string;
  updated_by: string | null;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface AnnouncementTable {
  id: string;
  location_id: string | null;
  body: string;
  starts_at: Date;
  ends_at: Date;
  created_by: string;
  created_at: Generated<Date>;
}

/** FR-SCH-10/BR-28 — non-service days. An exceptions list, not a full calendar (default `is_service_day: false`). */
export interface ServiceCalendarTable {
  id: string;
  location_id: string;
  calendar_date: string;
  is_service_day: Generated<boolean>;
  reason: string;
  created_by: string;
  created_at: Generated<Date>;
}

// ---------------------------------------------------------------------
// schema: identity
// ---------------------------------------------------------------------

export type AccountStatus = 'pending' | 'active' | 'suspended' | 'deactivated';

export interface UserAccountTable {
  id: string;
  email: string;
  external_subject: string | null;
  full_name: string;
  status: Generated<AccountStatus>;
  location_id: string | null;
  created_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Generated<number>;
  /** DDL-04 (`000_AMENDMENTS.md`) — VR-04's precondition for a `CNP` grant. */
  is_clinical_staff: Generated<boolean>;
}

export interface UserSessionTable {
  id: string;
  user_account_id: string;
  issued_at: Generated<Date>;
  expires_at: Date;
  last_seen_at: Generated<Date>;
  revoked_at: Date | null;
  client_fingerprint: string | null;
}

export type RoleCodeColumn = 'STU' | 'DOC' | 'MCS' | 'STO' | 'CNP' | 'ADM';

export interface RoleTable {
  id: string;
  code: RoleCodeColumn;
  name: string;
}

export interface LocalCredentialTable {
  user_account_id: string;
  password_hash: string;
  failed_attempts: Generated<number>;
  locked_until: Date | null;
  password_changed_at: Generated<Date>;
  version: Generated<number>;
}

export interface UserRoleTable {
  id: string;
  user_account_id: string;
  role_id: string;
  granted_by: string;
  granted_at: Generated<Date>;
  revoked_at: Date | null;
}

export interface LoginAttemptTable {
  id: string;
  email_attempted: string;
  user_account_id: string | null;
  succeeded: boolean;
  source_address: string | null;
  attempted_at: Generated<Date>;
}

/**
 * DDL-03 (`000_AMENDMENTS.md`) — DATABASE.md requires a single-use,
 * time-limited reset token (FR-AUTH-08) but never defines its storage.
 * Only the hash is stored, matching `local_credential.password_hash`.
 */
export interface PasswordResetTokenTable {
  id: string;
  user_account_id: string;
  token_hash: string;
  expires_at: Date;
  consumed_at: Date | null;
  created_at: Generated<Date>;
}

export interface StudentProfileTable {
  user_account_id: string;
  student_ref: string;
  programme: string | null;
  is_enrolled: Generated<boolean>;
  version: Generated<number>;
}

export interface BookingSuspensionTable {
  id: string;
  student_id: string;
  suspended_until: Date;
  no_show_count: number;
  lifted_at: Date | null;
}

// ---------------------------------------------------------------------
// schema: pharmacy (columns the dashboard's medicine-store panel reads —
// not the full M5 table shape)
// ---------------------------------------------------------------------

export interface StoreHoursTable {
  id: string;
  location_id: string;
  weekday: number;
  opens_at: string;
  closes_at: string;
  updated_by: string;
}

export interface StoreStatusOverrideTable {
  id: string;
  location_id: string;
  effective_date: string;
  is_closed: boolean;
  reason: string;
  created_by: string;
}

// ---------------------------------------------------------------------
// schema: scheduling (M2 · Schedules)
// ---------------------------------------------------------------------

export interface DoctorTable {
  id: string;
  user_account_id: string | null;
  full_name: string;
  designation: string | null;
  specialisation: string | null;
  photo_url: string | null;
  location_id: string;
  is_active: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface DutyRosterTable {
  id: string;
  doctor_id: string;
  weekday: number;
  starts_at_local: string;
  ends_at_local: string;
  effective_from: string;
  effective_to: string | null;
  is_active: Generated<boolean>;
  created_by: string;
  created_at: Generated<Date>;
  version: Generated<number>;
}

export type SessionStatus = 'scheduled' | 'started' | 'interrupted' | 'completed' | 'cancelled';

export interface ClinicSessionTable {
  id: string;
  doctor_id: string;
  location_id: string;
  duty_roster_id: string | null;
  session_date: string;
  starts_at: Date;
  ends_at: Date;
  slot_length_minutes: number;
  walk_in_allocation_pct: number;
  total_slot_count: number;
  bookable_slot_count: number;
  status: Generated<SessionStatus>;
  next_serial: Generated<number>;
  actually_started_at: Date | null;
  actually_ended_at: Date | null;
  change_reason: string | null;
  created_by: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

export interface SessionSlotTable {
  id: string;
  clinic_session_id: string;
  slot_index: number;
  slot_starts_at: Date;
  is_online_bookable: boolean;
}

export interface DoctorUnavailabilityTable {
  id: string;
  doctor_id: string;
  /** `daterange` — Kysely has no native range type; read/written as the raw Postgres range literal (`'[2026-08-20,2026-08-24]'`). */
  period: string;
  reason: string;
  created_by: string;
  created_at: Generated<Date>;
}

/** DDL-05 (`000_AMENDMENTS.md`) — the two-step leave flow's preview-to-confirm handoff. */
export interface UnavailabilityPreviewTable {
  id: string;
  doctor_id: string;
  start_date: string;
  end_date: string;
  reason: string;
  affected_appointment_ids: string[];
  created_at: Generated<Date>;
  expires_at: Date;
}

// ---------------------------------------------------------------------
// schema: queueing (same scope note as scheduling above)
// ---------------------------------------------------------------------

export type AppointmentStatus =
  | 'booked'
  | 'checked_in'
  | 'waiting'
  | 'in_consultation'
  | 'completed'
  | 'cancelled'
  | 'late_cancellation'
  | 'no_show'
  | 'expired';

export type AppointmentOrigin = 'booked' | 'walk_in';
export type PaymentState = 'unpaid' | 'paid' | 'waived';

export interface AppointmentTable {
  id: string;
  appointment_ref: string;
  clinic_session_id: string;
  /** NULL for walk-ins (`ck_appointment_walkin_slot`) — set only for `origin: 'booked'`. */
  session_slot_id: string | null;
  student_id: string | null;
  /** `ck_appointment_subject` — set when `student_id` is null (an unregistered walk-in, FR-APT-36). */
  unregistered_name: string | null;
  serial_number: number;
  origin: AppointmentOrigin;
  status: Generated<AppointmentStatus>;
  payment_status: Generated<PaymentState>;
  cancelled_at: Date | null;
  cancellation_reason: string | null;
  created_by: string;
  updated_at: Generated<Date>;
  version: Generated<number>;
}

// ---------------------------------------------------------------------
// schema: notification
// ---------------------------------------------------------------------

export type NotificationChannel = 'in_app' | 'email';
export type NotificationOutboxStatus = 'pending' | 'claimed' | 'delivered' | 'failed' | 'skipped';

export interface NotificationTemplateTable {
  id: string;
  template_key: string;
  is_discreet: Generated<boolean>;
  allows_free_text: Generated<boolean>;
  subject_template: string;
  body_template: string;
  is_active: Generated<boolean>;
  version: Generated<number>;
}

export interface NotificationTable {
  id: string;
  recipient_id: string;
  template_id: string;
  payload: Generated<Record<string, unknown>>;
  read_at: Date | null;
  correlation_id: string | null;
  created_at: Generated<Date>;
}

export interface NotificationOutboxTable {
  id: string;
  notification_id: string;
  channel: NotificationChannel;
  status: Generated<NotificationOutboxStatus>;
  attempt_count: Generated<number>;
  next_attempt_at: Generated<Date>;
  claimed_by: string | null;
  claimed_at: Date | null;
  last_error: string | null;
  delivered_at: Date | null;
}

// ---------------------------------------------------------------------
// schema: audit
// ---------------------------------------------------------------------

export interface AuditLogTable {
  id: string;
  entity_type: string;
  entity_id: string | null;
  action: string;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  actor_id: string | null;
  actor_role: string | null;
  correlation_id: string | null;
  occurred_at: Generated<Date>;
}

export interface AuthzDenialTable {
  id: string;
  actor_id: string | null;
  attempted_role: string | null;
  resource: string;
  operation: string;
  reason: string;
  source_address: string | null;
  correlation_id: string | null;
  occurred_at: Generated<Date>;
}

export interface DataAccessLogTable {
  id: string;
  accessor_id: string;
  subject_id: string;
  data_category: string;
  correlation_id: string | null;
  occurred_at: Generated<Date>;
}

export interface BreakGlassGrantTable {
  id: string;
  administrator_id: string;
  justification: string;
  granted_at: Generated<Date>;
  expires_at: Date;
  head_notified_at: Date | null;
  revoked_at: Date | null;
}

/**
 * Table keys are schema-qualified (`'config.system_config'`), matching how
 * Kysely's query builder is called (`db.selectFrom('config.system_config')`)
 * — no `withSchema()` indirection needed.
 */
export interface Database {
  'config.location': LocationTable;
  'config.system_config': SystemConfigTable;
  'config.announcement': AnnouncementTable;
  'config.service_calendar': ServiceCalendarTable;
  'identity.user_account': UserAccountTable;
  'identity.user_session': UserSessionTable;
  'identity.role': RoleTable;
  'identity.local_credential': LocalCredentialTable;
  'identity.user_role': UserRoleTable;
  'identity.login_attempt': LoginAttemptTable;
  'identity.password_reset_token': PasswordResetTokenTable;
  'identity.student_profile': StudentProfileTable;
  'identity.booking_suspension': BookingSuspensionTable;
  'scheduling.doctor': DoctorTable;
  'scheduling.duty_roster': DutyRosterTable;
  'scheduling.clinic_session': ClinicSessionTable;
  'scheduling.session_slot': SessionSlotTable;
  'scheduling.doctor_unavailability': DoctorUnavailabilityTable;
  'scheduling.unavailability_preview': UnavailabilityPreviewTable;
  'queueing.appointment': AppointmentTable;
  'pharmacy.store_hours': StoreHoursTable;
  'pharmacy.store_status_override': StoreStatusOverrideTable;
  'notification.notification_template': NotificationTemplateTable;
  'notification.notification': NotificationTable;
  'notification.notification_outbox': NotificationOutboxTable;
  'audit.audit_log': AuditLogTable;
  'audit.authz_denial': AuthzDenialTable;
  'audit.data_access_log': DataAccessLogTable;
  'audit.break_glass_grant': BreakGlassGrantTable;
}
