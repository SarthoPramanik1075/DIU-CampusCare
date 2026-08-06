-- =====================================================================
-- campuscare_core — 002 indexes
-- DATABASE.md §9.1. Column order mirrors the queries that use them.
-- =====================================================================

-- ---- queueing: the hot path (NFR-PERF-04, < 1 s p95) ----------------
-- Column order mirrors the queue's ORDER BY exactly:
--   ORDER BY is_emergency DESC, serial_number ASC   (BR-17, BR-18)
-- Partial, so the index holds only live rows — a fraction of the table.
CREATE INDEX ix_appointment_session_queue
    ON queueing.appointment (clinic_session_id, is_emergency DESC, serial_number)
    WHERE status IN ('booked','checked_in','waiting');

CREATE INDEX ix_appointment_student_active
    ON queueing.appointment (student_id, status)
    WHERE status IN ('booked','checked_in','waiting');

-- FR-APT-22: rolling mean over completed consultations in this session.
CREATE INDEX ix_appointment_completed_duration
    ON queueing.appointment (clinic_session_id, consultation_completed_at)
    WHERE consultation_completed_at IS NOT NULL;

CREATE INDEX ix_appointment_session_all
    ON queueing.appointment (clinic_session_id);

-- ---- scheduling: public availability (NFR-PERF-01, < 3 s on 3G) -----
CREATE INDEX ix_clinic_session_date_location
    ON scheduling.clinic_session (location_id, session_date, status);

CREATE INDEX ix_clinic_session_doctor_date
    ON scheduling.clinic_session (doctor_id, session_date);

CREATE INDEX ix_session_slot_bookable
    ON scheduling.session_slot (clinic_session_id, slot_starts_at)
    WHERE is_online_bookable;

-- ---- pharmacy -------------------------------------------------------
-- FR-MED-02: approximate matching across BOTH names. Without pg_trgm a
-- leading-wildcard LIKE cannot use an index at all.
CREATE INDEX ix_medicine_generic_trgm
    ON pharmacy.medicine USING gin (generic_name gin_trgm_ops);
CREATE INDEX ix_medicine_brand_trgm
    ON pharmacy.medicine USING gin (brand_name gin_trgm_ops)
    WHERE brand_name IS NOT NULL;

-- BR-39: FEFO selection — earliest-expiring batch with stock remaining.
CREATE INDEX ix_batch_fefo
    ON pharmacy.medicine_batch (medicine_id, expiry_date)
    WHERE quantity_remaining > 0;

-- FR-MED-17: the 00:01 daily expiry sweep.
CREATE INDEX ix_batch_expiry_sweep
    ON pharmacy.medicine_batch (expiry_date)
    WHERE quantity_remaining > 0;

CREATE INDEX ix_movement_batch_time
    ON pharmacy.stock_movement (medicine_batch_id, recorded_at DESC);

-- ---- identity -------------------------------------------------------
CREATE INDEX ix_user_session_active
    ON identity.user_session (user_account_id)
    WHERE revoked_at IS NULL;

CREATE INDEX ix_login_attempt_email_time
    ON identity.login_attempt (email_attempted, attempted_at DESC);

-- BR-15. NOTE: the predicate cannot contain now() — it is not immutable
-- and PostgreSQL rejects it. Recency is filtered in the query instead.
CREATE INDEX ix_suspension_student
    ON identity.booking_suspension (student_id, suspended_until DESC);

-- ---- notification ---------------------------------------------------
CREATE INDEX ix_outbox_pending
    ON notification.notification_outbox (next_attempt_at)
    WHERE status = 'pending';

CREATE INDEX ix_notification_recipient_unread
    ON notification.notification (recipient_id, created_at DESC)
    WHERE read_at IS NULL;

-- ---- audit ----------------------------------------------------------
CREATE INDEX ix_audit_entity
    ON audit.audit_log (entity_type, entity_id, occurred_at DESC);
CREATE INDEX ix_audit_actor_time
    ON audit.audit_log (actor_id, occurred_at DESC);
CREATE INDEX ix_audit_correlation
    ON audit.audit_log (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX ix_authz_denial_actor
    ON audit.authz_denial (actor_id, occurred_at DESC);
CREATE INDEX ix_break_glass_active
    ON audit.break_glass_grant (administrator_id, expires_at DESC);

-- ---- config: the announcement query of API §2.5 ----------------------
-- Not in DATABASE.md §9.1, added here because the M0.5 vertical slice
-- reads active announcements by instant on every public page load.
CREATE INDEX ix_announcement_active_window
    ON config.announcement (starts_at, ends_at);
