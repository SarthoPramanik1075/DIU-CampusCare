-- =====================================================================
-- campuscare_core — 008 Scheduling extensions (M2 · Schedules)
--
-- Three additions, none of which change 001-007 (an applied migration is
-- immutable — see packages/db-tools/src/migrate.ts's checksum guard).
-- Recorded in 000_AMENDMENTS.md as DDL-05.
-- =====================================================================

-- ---- 1. The single Phase 1 location, never seeded before now ----------
-- Every scheduling table (doctor, clinic_session) and config.service_calendar
-- carry `location_id NOT NULL REFERENCES config.location(id)`, but nothing
-- since M0.5 has ever needed a location to exist — M1's account creation
-- treats `locationId` as optional. SRS's own OI-04/DB-3 open item records
-- multi-location as unconfirmed and out of Phase 1 scope, so exactly one
-- row is seeded, not a general-purpose location catalogue.
--
-- Code is `DIU-MC-01`, not the more obvious `MAIN` — seven M1 integration
-- tests already use `code: 'MAIN'` as their own scratch-database fixture
-- (predating this migration), and `config.location.code` is UNIQUE across
-- every database this migration runs against, scratch ones included.
INSERT INTO config.location (id, code, name) VALUES
    ('00000000-0000-7000-8000-000000000201', 'DIU-MC-01', 'DIU Medical Centre')
ON CONFLICT (code) DO NOTHING;

-- ---- 2. Transient storage for the two-step leave flow's preview token --
-- API §3.21/3.22 (FR-SCH-07) requires a 15-minute-lived `previewToken`
-- handing off from the impact-preview call to the confirm call, so confirm
-- can detect "the affected bookings changed since you looked" (IMPACT_CHANGED)
-- by diffing against what preview actually showed the caller. DATABASE.md
-- defines no storage for this — the same category of omission DDL-03
-- resolved for the password-reset token. The token itself needs no hash
-- (unlike a credential, its compromise reveals nothing that a session
-- without MCS/ADM privilege could not already read via the API), so it is
-- the row's own uuid, not a separate secret.
CREATE TABLE scheduling.unavailability_preview (
    id                        uuid PRIMARY KEY,
    doctor_id                 uuid NOT NULL REFERENCES scheduling.doctor(id),
    start_date                date NOT NULL,
    end_date                  date NOT NULL,
    reason                    varchar(500) NOT NULL,
    affected_appointment_ids  uuid[] NOT NULL,
    created_at                timestamptz NOT NULL DEFAULT now(),
    expires_at                timestamptz NOT NULL
);

-- No UPDATE/DELETE: a preview row is written once and either read back by
-- confirm or left to expire, the same "mark, never delete" discipline as
-- every other operational-history table (P4).
GRANT SELECT, INSERT ON scheduling.unavailability_preview TO campuscare_core_app;

-- ---- 3. Notification template for FR-SCH-08/09's leave cancellation ----
-- The confirm-unavailability handler enqueues one notification per
-- affected student; notification.notification_id references this row.
-- Same pattern as 006_iam_extensions.sql's account_locked/
-- password_reset_requested seeds.
INSERT INTO notification.notification_template
    (id, template_key, is_discreet, allows_free_text, subject_template, body_template, is_active)
VALUES
    (
        '00000000-0000-7000-8000-000000000103',
        'doctor_unavailability_cancelled',
        false,
        false,
        'Your appointment on {{sessionDate}} has been cancelled',
        'Dr. {{doctorName}} is unavailable on {{sessionDate}}, so your appointment (serial {{serialNumber}}) has been cancelled. {{refundNote}} Please book another available time.',
        true
    )
ON CONFLICT (template_key) DO NOTHING;
