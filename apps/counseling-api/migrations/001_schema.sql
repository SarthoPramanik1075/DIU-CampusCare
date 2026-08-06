-- =====================================================================
-- DIU CampusCare — campuscare_counseling — 001 schema
-- DATABASE.md §10.
--
-- SEPARATE DATABASE. ADR-001.
-- campuscare_core_app has NO CONNECT privilege here, and that is the
-- point. Nothing in this file may reference a Core table, and no Core
-- table may reference anything here — the student and counsellor
-- identifiers below carry NO foreign key precisely because the accounts
-- they name live in another database (DATABASE §10, P10).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS counseling;
CREATE SCHEMA IF NOT EXISTS clinical_audit;

SET timezone = 'Asia/Dhaka';

CREATE TYPE counseling.self_urgency   AS ENUM ('routine','soon','urgent');           -- BR-45: INPUT ONLY
CREATE TYPE counseling.case_priority  AS ENUM ('normal','priority','urgent');        -- FR-CSE-03
CREATE TYPE counseling.request_status AS ENUM ('requested','under_review','scheduled','withdrawn','declined');
CREATE TYPE counseling.case_status    AS ENUM (
    'requested','under_review','scheduled','session_completed',
    'follow_up_required','closed','withdrawn','declined');                           -- FR-CSE-10
CREATE TYPE counseling.session_outcome AS ENUM ('attended','missed','cancelled');    -- FR-CNS-17
CREATE TYPE counseling.gender_pref    AS ENUM ('no_preference','female','male');     -- SI-7

-- ---------------------------------------------------------------------
-- ADR-012: THE INDEPENDENT AUTHORISATION AUTHORITY.
--
-- The vault receives a session assertion from Core carrying role=CNP.
-- It does NOT trust that claim. Every request is checked against this
-- table. A forged CNP claim from a compromised IAM is still refused,
-- because the subject is not on this roster.
--
-- user_ref_id has NO foreign key: identity.user_account lives in another
-- database, and that is the point (P10).
-- ---------------------------------------------------------------------
CREATE TABLE counseling.clinical_roster (
    id              uuid PRIMARY KEY,
    user_ref_id     uuid NOT NULL UNIQUE,
    display_name    text NOT NULL,
    is_service_head boolean NOT NULL DEFAULT false,     -- receives break-glass alerts (FR-AUD-06)
    is_active       boolean NOT NULL DEFAULT true,
    added_by        uuid REFERENCES counseling.clinical_roster(id),
    added_at        timestamptz NOT NULL DEFAULT now(),
    deactivated_at  timestamptz,
    version         integer NOT NULL DEFAULT 1
);

CREATE TABLE counseling.counseling_category (           -- VR-70
    id          uuid PRIMARY KEY,
    code        text NOT NULL UNIQUE,
    label       text NOT NULL,
    is_active   boolean NOT NULL DEFAULT true,
    sort_order  smallint NOT NULL DEFAULT 0
);

-- The vault holds its own configuration so it remains self-sufficient
-- when Core is unavailable (ARCHITECTURE §10.4, failure mode F3).
CREATE TABLE counseling.counseling_config (
    id              uuid PRIMARY KEY,
    config_key      text NOT NULL UNIQUE,
    value_text      text NOT NULL,
    description     text NOT NULL,
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- VR-75: server-side proof that the crisis interstitial was shown and
-- acknowledged BEFORE a high-urgency request is accepted. Without a
-- record, the interface alone could be bypassed.
--
-- protocol_version records WHICH revision of [R3] was displayed — if the
-- crisis protocol changes, we can still say what a given student saw.
CREATE TABLE counseling.crisis_acknowledgement (
    id                  uuid PRIMARY KEY,
    student_ref_id      uuid NOT NULL,                  -- no FK (P10)
    urgency_shown       counseling.self_urgency NOT NULL,
    protocol_version    text NOT NULL,
    acknowledged_at     timestamptz NOT NULL DEFAULT now(),
    expires_at          timestamptz NOT NULL,           -- short-lived; cannot be reused later
    consumed_by_request uuid,
    CONSTRAINT ck_ack_window CHECK (expires_at > acknowledged_at)
);

CREATE TABLE counseling.counseling_request (
    id                          uuid PRIMARY KEY,
    student_ref_id              uuid NOT NULL,          -- NO FK — ADR-001 / P10
    category_id                 uuid NOT NULL REFERENCES counseling.counseling_category(id),
    self_reported_urgency       counseling.self_urgency NOT NULL,   -- BR-45: triage INPUT only
    note                        varchar(1000),                       -- VR-72
    preferred_windows           jsonb NOT NULL,                      -- VR-73, at least one
    counselor_gender_preference counseling.gender_pref NOT NULL DEFAULT 'no_preference',  -- SI-7
    crisis_acknowledgement_id   uuid REFERENCES counseling.crisis_acknowledgement(id),
    status                      counseling.request_status NOT NULL DEFAULT 'requested',
    acknowledged_at             timestamptz,            -- BR-46: within 1 minute
    triage_due_at               timestamptz NOT NULL,   -- FR-CSE-07 SLA
    withdrawn_at                timestamptz,            -- BR-56
    submitted_at                timestamptz NOT NULL DEFAULT now(),
    version                     integer NOT NULL DEFAULT 1,

    CONSTRAINT ck_request_windows CHECK (jsonb_array_length(preferred_windows) >= 1),  -- VR-73
    -- FR-CNS-06 / VR-75: a highest-urgency request REQUIRES a recorded
    -- crisis acknowledgement. Enforced structurally, not by the interface.
    CONSTRAINT ck_request_crisis_gate
        CHECK (self_reported_urgency <> 'urgent' OR crisis_acknowledgement_id IS NOT NULL)
);

-- VR-74: at most one request in flight per student. Supportive wording
-- on violation is an application concern (EC-39) — but the invariant
-- itself belongs here.
CREATE UNIQUE INDEX uq_request_active_per_student
    ON counseling.counseling_request (student_ref_id)
    WHERE status IN ('requested','under_review');

CREATE TABLE counseling.counseling_case (
    id                      uuid PRIMARY KEY,
    counseling_request_id   uuid NOT NULL UNIQUE REFERENCES counseling.counseling_request(id),
    final_priority          counseling.case_priority NOT NULL DEFAULT 'normal',
    priority_is_provisional boolean NOT NULL DEFAULT true,   -- FR-CSE-04
    status                  counseling.case_status NOT NULL DEFAULT 'requested',
    opened_at               timestamptz NOT NULL DEFAULT now(),
    last_activity_at        timestamptz NOT NULL DEFAULT now(),   -- FR-CSE-21, 90-day sweep
    closed_at               timestamptz,
    closure_reason          varchar(500),                         -- VR-78
    version                 integer NOT NULL DEFAULT 1,
    CONSTRAINT ck_case_closure                                    -- VR-78
        CHECK (status <> 'closed' OR length(btrim(coalesce(closure_reason,''))) >= 1)
);

-- BR-45 / FR-CSE-05: only a Counseling Professional may set final
-- priority. changed_by references clinical_roster — a non-counselor
-- literally has no row to reference.
CREATE TABLE counseling.case_priority_change (
    id              uuid PRIMARY KEY,
    case_id         uuid NOT NULL REFERENCES counseling.counseling_case(id),
    from_priority   counseling.case_priority,
    to_priority     counseling.case_priority NOT NULL,
    reason          varchar(500) NOT NULL,
    changed_by      uuid NOT NULL REFERENCES counseling.clinical_roster(id),
    changed_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_priority_reason CHECK (length(btrim(reason)) >= 10)   -- VR-76
);

CREATE TABLE counseling.case_status_transition (        -- FR-CSE-11
    id              uuid PRIMARY KEY,
    case_id         uuid NOT NULL REFERENCES counseling.counseling_case(id),
    from_status     counseling.case_status,
    to_status       counseling.case_status NOT NULL,
    note            varchar(500),
    -- BR-67: nullable ONLY for the 90-day auto-close (FR-CSE-21), which
    -- is the single permitted system-actor transition. Every other row
    -- must name a human.
    changed_by      uuid REFERENCES counseling.clinical_roster(id),
    is_system_action boolean NOT NULL DEFAULT false,
    changed_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_transition_actor                                     -- BR-67
        CHECK (is_system_action OR changed_by IS NOT NULL)
);

CREATE TABLE counseling.case_session (
    id              uuid PRIMARY KEY,
    case_id         uuid NOT NULL REFERENCES counseling.counseling_case(id),
    scheduled_for   timestamptz NOT NULL,
    duration_minutes smallint NOT NULL DEFAULT 45,
    mode            text NOT NULL DEFAULT 'in_person',
    outside_window_reason varchar(500),                 -- VR-77
    student_confirmed_at timestamptz,                   -- FR-CNS-16
    outcome         counseling.session_outcome,
    -- FR-CNS-17 / EC-42: a MISSED outcome carries NO penalty. There is
    -- deliberately no counter, no flag, and no suspension linkage here —
    -- the absence is the requirement.
    completed_at    timestamptz,
    scheduled_by    uuid NOT NULL REFERENCES counseling.clinical_roster(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    version         integer NOT NULL DEFAULT 1,
    CONSTRAINT ck_session_duration CHECK (duration_minutes BETWEEN 5 AND 240)
);

-- FR-CSE-12/13: readable ONLY by Counseling Professionals. The authorship
-- FK to clinical_roster means a non-counselor cannot author a row at all.
CREATE TABLE counseling.case_note (
    id              uuid PRIMARY KEY,
    case_id         uuid NOT NULL REFERENCES counseling.counseling_case(id),
    case_session_id uuid REFERENCES counseling.case_session(id),
    body            varchar(5000) NOT NULL,             -- VR-79
    authored_by     uuid NOT NULL REFERENCES counseling.clinical_roster(id),
    authored_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_note_body CHECK (length(btrim(body)) >= 1)
);

-- FR-CSE-18 / BR-67. protocol_version records which revision of [R3] was
-- in force — the escalation steps are authored by DIU, not by us.
CREATE TABLE counseling.escalation_invocation (
    id                  uuid PRIMARY KEY,
    case_id             uuid NOT NULL REFERENCES counseling.counseling_case(id),
    invoked_by          uuid NOT NULL REFERENCES counseling.clinical_roster(id),  -- human only
    protocol_version    text NOT NULL,
    note                varchar(2000),
    invoked_at          timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- FR-CSE-15/16, BR-51: EVERY READ of case data is recorded.
--
-- Lives inside the vault, so the Core administrator cannot read it —
-- which is precisely what FR-CSE-16 requires and what a single-database
-- design cannot honestly deliver.
--
-- Append-only, enforced by trigger as well as by REVOKE.
-- ---------------------------------------------------------------------
CREATE TABLE clinical_audit.counseling_access_log (
    id              uuid PRIMARY KEY,
    case_id         uuid,
    request_id      uuid,
    accessor_ref_id uuid NOT NULL,
    access_kind     text NOT NULL
                    CHECK (access_kind IN ('case_read','note_read','request_read',
                                           'timeline_read','list_read','export_read')),
    was_break_glass boolean NOT NULL DEFAULT false,     -- FR-AUD-05
    correlation_id  text,
    accessed_at     timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION clinical_audit.fn_forbid_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'counseling_access_log is append-only (FR-CSE-15, BR-51). Attempted: %', TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER trg_access_log_immutable
    BEFORE UPDATE OR DELETE ON clinical_audit.counseling_access_log
    FOR EACH ROW EXECUTE FUNCTION clinical_audit.fn_forbid_mutation();
