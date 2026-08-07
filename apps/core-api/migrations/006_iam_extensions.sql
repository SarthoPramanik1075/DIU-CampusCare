-- =====================================================================
-- campuscare_core — 006 IAM extensions (M1 · Foundations)
--
-- Three additions, none of which change 001-005 (an applied migration is
-- immutable — see packages/db-tools/src/migrate.ts's checksum guard).
-- Each is recorded in 000_AMENDMENTS.md as DDL-03.
-- =====================================================================

-- ---- 1. The role catalogue, never seeded in M0.5 -----------------------
-- identity.user_role.role_id references this table; M1's role grant/revoke
-- work is the first code that needs these rows to exist. SRS §3.5.1.
INSERT INTO identity.role (id, code, name) VALUES
    ('00000000-0000-7000-8000-000000000001', 'STU', 'Student'),
    ('00000000-0000-7000-8000-000000000002', 'DOC', 'Doctor'),
    ('00000000-0000-7000-8000-000000000003', 'MCS', 'Medical Center Staff'),
    ('00000000-0000-7000-8000-000000000004', 'STO', 'Store Operator'),
    ('00000000-0000-7000-8000-000000000005', 'CNP', 'Counseling Professional'),
    ('00000000-0000-7000-8000-000000000006', 'ADM', 'System Administrator')
ON CONFLICT (code) DO NOTHING;

-- ---- 2. DDL-03 · identity.password_reset_token -------------------------
-- FR-AUTH-08 / API §1.8 require a "single-use, time-limited reset link",
-- but DATABASE.md never defines where the token lives — see
-- 000_AMENDMENTS.md. Only the hash is stored, same reasoning as
-- local_credential.password_hash (NFR-SEC-02): a leaked row must not be a
-- usable credential.
CREATE TABLE identity.password_reset_token (
    id              uuid PRIMARY KEY,
    user_account_id uuid NOT NULL REFERENCES identity.user_account(id),
    token_hash      text NOT NULL UNIQUE,
    expires_at      timestamptz NOT NULL,
    consumed_at     timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_password_reset_token_expiry CHECK (expires_at > created_at)
);

CREATE INDEX ix_password_reset_token_user ON identity.password_reset_token (user_account_id);

GRANT SELECT, INSERT, UPDATE ON identity.password_reset_token TO campuscare_core_app;
-- Same exclusion as local_credential/user_session: reporting never touches
-- credential material.
REVOKE ALL ON identity.password_reset_token FROM campuscare_reporting;

-- ---- 3. Notification templates for lockout / reset ---------------------
-- FR-AUTH-14 requires the account holder be notified by email on lockout;
-- FR-AUTH-08 delivers the reset link by email. Both go through the
-- existing outbox (writeOutboxEntry, ADR-006), which requires a template
-- row to satisfy notification.notification's FK — M8 builds the actual
-- rendering/delivery worker and the admin CRUD for templates in general;
-- these two rows are seeded here because nothing else creates them yet.
-- `{{placeholder}}` is a plain, self-describing convention — no renderer
-- exists yet to standardise on, so this is not committing to a template
-- engine, only to naming the variables a future one will substitute.
INSERT INTO notification.notification_template
    (id, template_key, is_discreet, allows_free_text, subject_template, body_template, is_active)
VALUES
    (
        '00000000-0000-7000-8000-000000000101',
        'account_locked',
        false,
        false,
        'Your DIU CampusCare account is temporarily locked',
        'For your security, your account was locked after several unsuccessful sign-in attempts. You can try again after {{unlockAt}}. If this wasn''t you, contact DIU IT.',
        true
    ),
    (
        '00000000-0000-7000-8000-000000000102',
        'password_reset_requested',
        false,
        false,
        'Reset your DIU CampusCare password',
        'Use this link to choose a new password: {{resetLink}}. It expires in 30 minutes. If you didn''t request this, you can ignore this email.',
        true
    )
ON CONFLICT (template_key) DO NOTHING;
