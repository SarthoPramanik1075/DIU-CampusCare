-- =====================================================================
-- campuscare_core — 015 Queueing extensions (M3 · Appointments & Queue)
--
-- Two additions, recorded in 000_AMENDMENTS.md as DDL-08. Neither changes
-- 001-014 (an applied migration is immutable — see
-- packages/db-tools/src/migrate.ts's checksum guard).
-- =====================================================================

-- ---- 1. Human-readable appointment reference generator -----------------
-- FR-APT-04 names the format ("MED-<YYYY>-<sequence>", unique) but
-- DATABASE.md never defines how the sequence is produced — the same shape
-- of omission DDL-03/05 already resolved twice for other missing storage.
-- A plain sequence, read inside the booking/walk-in transaction and
-- formatted with the current year, is enough: uniqueness is the actual
-- requirement, and nothing in FR-APT-04 requires the number to reset
-- annually, so a year-scoped counter table (with its own concurrency
-- concerns) would be solving a problem that was never asked for.
CREATE SEQUENCE queueing.appointment_ref_seq START WITH 1;
GRANT USAGE, SELECT ON SEQUENCE queueing.appointment_ref_seq TO campuscare_core_app;

-- ---- 1b. When a waiting/checked-in patient was called (VR-31's clock) --
-- FR-APT-31/BR-14 gate No-show marking on "a grace period since the
-- patient was called," but no column anywhere records that moment — there
-- is no separate "call next patient" action in API §4.3's endpoint list,
-- so the moment is set the first time staff *attempt* to mark No-show on
-- an appointment (an early attempt is rejected with the remaining wait,
-- not silently accepted or requiring a whole extra endpoint just to start
-- a clock).
ALTER TABLE queueing.appointment ADD COLUMN called_at timestamptz;

-- ---- 2. Estimate-accuracy instrumentation (NFR-ACC-01/02, M3-T21) -------
-- Records predicted vs. actual consultation start for every completed
-- consultation, so the accuracy figure NFR-ACC-01 names ("≥75% within
-- ±15 minutes, measured weekly") becomes computable once real usage
-- accumulates. Write-only from the app; a later admin metrics screen
-- (out of M3's scope) is the only intended reader.
CREATE TABLE queueing.estimate_accuracy_sample (
    id                  uuid PRIMARY KEY,
    appointment_id      uuid NOT NULL REFERENCES queueing.appointment(id),
    doctor_id           uuid NOT NULL REFERENCES scheduling.doctor(id),
    predicted_at        timestamptz NOT NULL,
    actual_started_at   timestamptz NOT NULL,
    deviation_minutes   integer NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON queueing.estimate_accuracy_sample TO campuscare_core_app;

-- ---- 3. A small, real starter list of visit-reason categories ----------
-- FR-APT-06/SI-15 name this as a configurable category list, but SI-15 is
-- stakeholder input the SRS records as never supplied. Five genuinely
-- usable categories, not placeholder content — the same category of
-- decision as 008_scheduling_extensions.sql seeding one real location.
INSERT INTO queueing.visit_reason_category (id, code, label, is_active, sort_order) VALUES
    ('00000000-0000-7000-8000-000000000301', 'general_illness', 'General illness', true, 0),
    ('00000000-0000-7000-8000-000000000302', 'injury',          'Injury',           true, 1),
    ('00000000-0000-7000-8000-000000000303', 'follow_up',       'Follow-up visit',  true, 2),
    ('00000000-0000-7000-8000-000000000304', 'vaccination',     'Vaccination',      true, 3),
    ('00000000-0000-7000-8000-000000000305', 'other',           'Other',            true, 4)
ON CONFLICT (code) DO NOTHING;

-- ---- 4. Notification templates for M3's appointment/queue events -------
-- Required FK targets for the outbox rows M3's handlers write. Same
-- pattern as 006_iam_extensions.sql, 008_scheduling_extensions.sql and
-- 011_session_lifecycle_notification_templates.sql.
INSERT INTO notification.notification_template
    (id, template_key, is_discreet, allows_free_text, subject_template, body_template, is_active)
VALUES
    (
        '00000000-0000-7000-8000-000000000107',
        'booking_confirmed',
        false, false,
        'Your appointment is confirmed — {{appointmentRef}}',
        'You are serial {{serialNumber}} with Dr. {{doctorName}} on {{sessionDate}}, estimated around {{estimateAtBooking}}. This is an estimate, not a guaranteed time.',
        true
    ),
    (
        '00000000-0000-7000-8000-000000000108',
        'booking_cancelled_by_student',
        false, false,
        'Your appointment {{appointmentRef}} was cancelled',
        'Your booking with Dr. {{doctorName}} on {{sessionDate}} has been cancelled as requested. The slot has been released.',
        true
    ),
    (
        '00000000-0000-7000-8000-000000000109',
        'queue_position_reached_2',
        false, false,
        'You are almost up — {{appointmentRef}}',
        'Two patients are ahead of you for Dr. {{doctorName}}. Current estimate: {{currentEstimate}}.',
        true
    ),
    (
        '00000000-0000-7000-8000-00000000010a',
        'estimate_slipped',
        false, false,
        'Updated estimate for {{appointmentRef}}',
        'Dr. {{doctorName}}''s queue is running behind. Your new estimate is {{currentEstimate}}.',
        true
    ),
    (
        '00000000-0000-7000-8000-00000000010b',
        'emergency_inserted',
        false, false,
        'Updated estimate for {{appointmentRef}}',
        'An urgent case was just added to Dr. {{doctorName}}''s queue ahead of you. Your new estimate is {{currentEstimate}}.',
        true
    ),
    (
        '00000000-0000-7000-8000-00000000010c',
        'booking_suspended',
        false, false,
        'Online booking paused until {{suspendedUntil}}',
        'After {{noShowCount}} missed appointments, online booking is paused until {{suspendedUntil}}. You can still walk in and be seen at any time.',
        true
    ),
    (
        '00000000-0000-7000-8000-00000000010d',
        'session_expired_rebooking_offer',
        false, false,
        'Sorry we missed you — {{appointmentRef}}',
        'Dr. {{doctorName}}''s session on {{sessionDate}} ended before you were seen. No penalty applies — please book another available time.',
        true
    )
ON CONFLICT (template_key) DO NOTHING;
