-- =====================================================================
-- campuscare_core — 011 Notification templates for session lifecycle (M2 · Schedules)
--
-- One addition, recorded as DDL-06 in 000_AMENDMENTS.md. Does not modify
-- 001-010 (an applied migration is immutable — see
-- packages/db-tools/src/migrate.ts's checksum guard).
-- =====================================================================

-- API §3.3's `interrupt`, `complete` and `cancel` endpoints each queue a
-- notification per affected appointment (FR-SCH-08/09, EC-04, EC-13), and
-- every `notification.notification` row requires a `template_id` FK.
-- Distinct from `doctor_unavailability_cancelled` (008_scheduling_extensions.sql)
-- because these three are triggered by a specific session event, not a
-- doctor-wide leave, and each carries a different message.
INSERT INTO notification.notification_template
    (id, template_key, is_discreet, allows_free_text, subject_template, body_template, is_active)
VALUES
    (
        '00000000-0000-7000-8000-000000000104',
        'session_interrupted',
        false,
        false,
        'Your appointment with Dr. {{doctorName}} has been delayed',
        'Dr. {{doctorName}}''s session on {{sessionDate}} was interrupted ({{reason}}). Your appointment (serial {{serialNumber}}) is still in the queue — staff will update you when the session resumes.',
        true
    ),
    (
        '00000000-0000-7000-8000-000000000105',
        'session_cancelled',
        false,
        false,
        'Your appointment on {{sessionDate}} has been cancelled',
        'Dr. {{doctorName}}''s session on {{sessionDate}} was cancelled ({{reason}}), so your appointment (serial {{serialNumber}}) has been cancelled too. Please book another available time.',
        true
    ),
    (
        '00000000-0000-7000-8000-000000000106',
        'session_completed_expired',
        false,
        false,
        'Sorry we missed you on {{sessionDate}}',
        'Dr. {{doctorName}}''s session on {{sessionDate}} ended before your appointment (serial {{serialNumber}}) could be called. No penalty applies — please book another available time whenever suits you.',
        true
    )
ON CONFLICT (template_key) DO NOTHING;
