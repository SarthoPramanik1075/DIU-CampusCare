-- =====================================================================
-- DIU CampusCare — campuscare_core — 001 schema
--
-- Transcribed from DATABASE.md §9. The DDL is applied verbatim: every
-- CHECK, EXCLUDE, partial unique index and trigger stays in the database,
-- because that is where the invariant is race-free. Application code must
-- never re-implement what is enforced here.
--
-- CREATE DATABASE and role creation are handled by tools/db-setup.ts,
-- since neither can run inside a transaction alongside this file.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS config;
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS scheduling;
CREATE SCHEMA IF NOT EXISTS queueing;
CREATE SCHEMA IF NOT EXISTS billing;
CREATE SCHEMA IF NOT EXISTS pharmacy;
CREATE SCHEMA IF NOT EXISTS notification;
CREATE SCHEMA IF NOT EXISTS audit;

-- SRS §2.4 — Bangladesh Standard Time (UTC+06). No multi-timezone support.
SET timezone = 'Asia/Dhaka';

-- ---------------------------------------------------------------------
-- ENUM TYPES  (P9: structural lifecycles are enums)
-- ---------------------------------------------------------------------
CREATE TYPE identity.account_status  AS ENUM ('pending','active','suspended','deactivated');            -- FR-AUTH-10
CREATE TYPE scheduling.session_status AS ENUM ('scheduled','started','interrupted','completed','cancelled'); -- EC-04
CREATE TYPE queueing.appointment_origin AS ENUM ('booked','walk_in');                                   -- FR-APT-19
CREATE TYPE queueing.appointment_status AS ENUM (
    'booked','checked_in','waiting','in_consultation','completed',
    'cancelled','late_cancellation','no_show','expired');                                               -- FR-APT-28
CREATE TYPE billing.payment_state AS ENUM ('unpaid','paid','waived');                                   -- FR-PAY-02
CREATE TYPE billing.payment_kind  AS ENUM ('counter_payment','waiver','adjustment');                    -- FR-PAY-10
CREATE TYPE pharmacy.dispensing_class AS ENUM ('otc','prescription_only');                              -- FR-MED-11
CREATE TYPE pharmacy.movement_kind AS ENUM ('receipt','dispense','adjustment');                         -- FR-MED-20
CREATE TYPE notification.channel AS ENUM ('in_app','email');                                            -- FR-NTF-03
CREATE TYPE notification.outbox_status AS ENUM ('pending','claimed','delivered','failed','skipped');

-- =====================================================================
-- SCHEMA: config
-- =====================================================================

-- ADR-013: every scoped entity carries location_id from day one, even
-- though exactly one row will exist in Phase 1. Retro-fitting this
-- dimension in Phase 3 would touch the entire schema.
CREATE TABLE config.location (
    id              uuid PRIMARY KEY,
    code            text NOT NULL UNIQUE,
    name            text NOT NULL,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    version         integer NOT NULL DEFAULT 1
);

-- FR-ADM-01 / BR-70: every 【A】 value lives here, never in code.
-- min_value / max_value implement VR-94 (range rejected at save, not at use).
CREATE TABLE config.system_config (
    id              uuid PRIMARY KEY,
    config_key      text NOT NULL UNIQUE,
    value_type      text NOT NULL CHECK (value_type IN ('integer','decimal','boolean','text','duration')),
    value_text      text NOT NULL,
    min_value       numeric,
    max_value       numeric,
    description     text NOT NULL,
    updated_by      uuid,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    version         integer NOT NULL DEFAULT 1,
    CONSTRAINT ck_system_config_range
        CHECK (min_value IS NULL OR max_value IS NULL OR max_value >= min_value)
);

-- FR-SCH-10 / BR-28. reason is surfaced to students (FR-SCH-11).
CREATE TABLE config.service_calendar (
    id              uuid PRIMARY KEY,
    location_id     uuid NOT NULL REFERENCES config.location(id),
    calendar_date   date NOT NULL,
    is_service_day  boolean NOT NULL DEFAULT false,
    reason          text NOT NULL,
    created_by      uuid NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_service_calendar_date UNIQUE (location_id, calendar_date)
);

CREATE TABLE config.announcement (                          -- FR-ADM-04
    id              uuid PRIMARY KEY,
    location_id     uuid REFERENCES config.location(id),
    body            varchar(500) NOT NULL,
    starts_at       timestamptz NOT NULL,
    ends_at         timestamptz NOT NULL,
    created_by      uuid NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_announcement_period CHECK (ends_at > starts_at)
);

-- =====================================================================
-- SCHEMA: identity
-- =====================================================================

CREATE TABLE identity.user_account (
    id                  uuid PRIMARY KEY,
    email               citext NOT NULL UNIQUE,             -- VR-01
    external_subject    text UNIQUE,                        -- SSO subject; NULL for local accounts (OI-03)
    full_name           text NOT NULL,
    status              identity.account_status NOT NULL DEFAULT 'pending',
    location_id         uuid REFERENCES config.location(id),
    created_by          uuid,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    version             integer NOT NULL DEFAULT 1
);

-- Separated from user_account so that SSO users have NO row here at all.
-- A nullable password_hash on user_account would leave a column that is
-- meaningless for most rows and tempting to populate.
CREATE TABLE identity.local_credential (
    user_account_id     uuid PRIMARY KEY REFERENCES identity.user_account(id),
    password_hash       text NOT NULL,                      -- NFR-SEC-02: argon2id/bcrypt, never reversible
    failed_attempts     smallint NOT NULL DEFAULT 0,        -- FR-AUTH-14
    locked_until        timestamptz,
    password_changed_at timestamptz NOT NULL DEFAULT now(),
    version             integer NOT NULL DEFAULT 1,
    CONSTRAINT ck_local_credential_attempts CHECK (failed_attempts >= 0)
);

CREATE TABLE identity.role (
    id          uuid PRIMARY KEY,
    code        text NOT NULL UNIQUE
                CHECK (code IN ('STU','DOC','MCS','STO','CNP','ADM')),   -- SRS §3.5.1
    name        text NOT NULL
);

-- BR-03: a user may hold multiple roles. Counseling access is NOT granted
-- by this table alone — the vault keeps its own roster (ADR-012).
CREATE TABLE identity.user_role (
    id              uuid PRIMARY KEY,
    user_account_id uuid NOT NULL REFERENCES identity.user_account(id),
    role_id         uuid NOT NULL REFERENCES identity.role(id),
    granted_by      uuid NOT NULL REFERENCES identity.user_account(id),  -- PRM-13
    granted_at      timestamptz NOT NULL DEFAULT now(),
    revoked_at      timestamptz,                                          -- P4: revoke, never delete
    CONSTRAINT uq_user_role UNIQUE (user_account_id, role_id)
);

-- Server-side sessions: PRM-15 requires a permission REDUCTION to take
-- effect without re-authentication. A self-contained token cannot be
-- revoked mid-flight, so session state is stored.
CREATE TABLE identity.user_session (
    id                  uuid PRIMARY KEY,
    user_account_id     uuid NOT NULL REFERENCES identity.user_account(id),
    issued_at           timestamptz NOT NULL DEFAULT now(),
    expires_at          timestamptz NOT NULL,               -- FR-AUTH-06
    last_seen_at        timestamptz NOT NULL DEFAULT now(),
    revoked_at          timestamptz,                        -- NFR-SEC-08
    client_fingerprint  text,
    CONSTRAINT ck_user_session_expiry CHECK (expires_at > issued_at)
);

CREATE TABLE identity.login_attempt (                       -- FR-AUTH-13
    id              uuid PRIMARY KEY,
    email_attempted citext NOT NULL,
    user_account_id uuid REFERENCES identity.user_account(id),
    succeeded       boolean NOT NULL,
    source_address  inet,
    attempted_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identity.student_profile (
    user_account_id uuid PRIMARY KEY REFERENCES identity.user_account(id),
    student_ref     text NOT NULL UNIQUE,                   -- VR-03
    programme       text,
    is_enrolled     boolean NOT NULL DEFAULT true,          -- BR-01
    version         integer NOT NULL DEFAULT 1
);

-- BR-15. Note: this suspends ONLINE BOOKING only. Nothing in the schema
-- references it from the walk-in path — FR-APT-38 requires walk-in
-- registration to succeed regardless.
CREATE TABLE identity.booking_suspension (
    id                  uuid PRIMARY KEY,
    student_id          uuid NOT NULL REFERENCES identity.student_profile(user_account_id),
    suspended_from      timestamptz NOT NULL DEFAULT now(),
    suspended_until     timestamptz NOT NULL,
    no_show_count       smallint NOT NULL,
    lifted_at           timestamptz,
    lifted_by           uuid REFERENCES identity.user_account(id),
    lift_reason         varchar(500),
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_suspension_period CHECK (suspended_until > suspended_from)
);

-- =====================================================================
-- SCHEMA: scheduling
-- =====================================================================

CREATE TABLE scheduling.doctor (
    id                  uuid PRIMARY KEY,
    user_account_id     uuid UNIQUE REFERENCES identity.user_account(id),  -- nullable: CON-02, doctors need no login
    full_name           text NOT NULL,
    designation         text,
    specialisation      text,
    photo_url           text,
    location_id         uuid NOT NULL REFERENCES config.location(id),
    is_active           boolean NOT NULL DEFAULT true,      -- EC-20: deactivate, never delete
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    version             integer NOT NULL DEFAULT 1
);

-- FR-SCH-02. Local wall-clock times: a roster is "every Sunday 09:00",
-- a recurring intention rather than an absolute instant.
CREATE TABLE scheduling.duty_roster (
    id              uuid PRIMARY KEY,
    doctor_id       uuid NOT NULL REFERENCES scheduling.doctor(id),
    weekday         smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    starts_at_local time NOT NULL,
    ends_at_local   time NOT NULL,
    effective_from  date NOT NULL,
    effective_to    date,
    is_active       boolean NOT NULL DEFAULT true,
    created_by      uuid NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    version         integer NOT NULL DEFAULT 1,
    CONSTRAINT ck_roster_time_order CHECK (ends_at_local > starts_at_local),
    CONSTRAINT ck_roster_effective  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

-- A session is materialised (not computed) because EC-01 needs slot rows
-- to claim, and because FR-SCH-03 overrides must be storable.
--
-- session_date is a stored column rather than GENERATED: converting
-- timestamptz to a local date requires AT TIME ZONE, which is STABLE and
-- therefore not permitted in a generated column. The application sets it.
CREATE TABLE scheduling.clinic_session (
    id                      uuid PRIMARY KEY,
    doctor_id               uuid NOT NULL REFERENCES scheduling.doctor(id),
    location_id             uuid NOT NULL REFERENCES config.location(id),
    duty_roster_id          uuid REFERENCES scheduling.duty_roster(id),   -- NULL when created as an override
    session_date            date NOT NULL,
    starts_at               timestamptz NOT NULL,
    ends_at                 timestamptz NOT NULL,
    slot_length_minutes     smallint NOT NULL,                            -- 【A: OI-05】
    walk_in_allocation_pct  smallint NOT NULL,                            -- 【A: OI-06】 BR-16
    total_slot_count        smallint NOT NULL,
    bookable_slot_count     smallint NOT NULL,                            -- FR-SCH-05
    status                  scheduling.session_status NOT NULL DEFAULT 'scheduled',
    next_serial             integer NOT NULL DEFAULT 1,                   -- D4, EC-09
    actually_started_at     timestamptz,                                  -- EC-02
    actually_ended_at       timestamptz,
    change_reason           varchar(500),                                 -- BR-29
    created_by              uuid NOT NULL,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    version                 integer NOT NULL DEFAULT 1,

    CONSTRAINT ck_session_time_order   CHECK (ends_at > starts_at),                       -- VR-10
    CONSTRAINT ck_session_slot_length  CHECK (slot_length_minutes BETWEEN 5 AND 60),      -- VR-12
    CONSTRAINT ck_session_walkin_pct   CHECK (walk_in_allocation_pct BETWEEN 0 AND 99),   -- VR-13
    CONSTRAINT ck_session_bookable     CHECK (bookable_slot_count BETWEEN 0 AND total_slot_count),
    CONSTRAINT ck_session_next_serial  CHECK (next_serial >= 1),

    -- VR-19: no two sessions for one doctor may overlap. An EXCLUDE
    -- constraint is race-free; a trigger doing SELECT-then-INSERT is not.
    CONSTRAINT ex_session_no_overlap EXCLUDE USING gist (
        doctor_id WITH =,
        tstzrange(starts_at, ends_at, '[)') WITH &&
    ) WHERE (status <> 'cancelled')
);

CREATE TABLE scheduling.session_slot (
    id                  uuid PRIMARY KEY,
    clinic_session_id   uuid NOT NULL REFERENCES scheduling.clinic_session(id),
    slot_index          smallint NOT NULL,
    slot_starts_at      timestamptz NOT NULL,
    is_online_bookable  boolean NOT NULL,                   -- false for the walk-in allocation (BR-16)
    CONSTRAINT uq_session_slot_index UNIQUE (clinic_session_id, slot_index)
);

CREATE TABLE scheduling.doctor_unavailability (             -- FR-SCH-06
    id              uuid PRIMARY KEY,
    doctor_id       uuid NOT NULL REFERENCES scheduling.doctor(id),
    period          daterange NOT NULL,
    reason          varchar(500) NOT NULL,
    created_by      uuid NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_unavailability_reason CHECK (length(btrim(reason)) >= 10),   -- VR-93
    CONSTRAINT ex_unavailability_no_overlap EXCLUDE USING gist (
        doctor_id WITH =, period WITH &&
    )
);

-- =====================================================================
-- SCHEMA: queueing
-- =====================================================================

CREATE TABLE queueing.visit_reason_category (               -- FR-APT-06, SI-15
    id          uuid PRIMARY KEY,
    code        text NOT NULL UNIQUE,
    label       text NOT NULL,
    is_active   boolean NOT NULL DEFAULT true,
    sort_order  smallint NOT NULL DEFAULT 0
);

-- THE UNIFIED QUEUE ENTRY.
--
-- One table holds both booked appointments and walk-ins because FR-APT-19
-- and BR-18 mandate a single ordered queue with one serial sequence
-- (EC-09). Two tables would require a UNION on the console's hot path and
-- would make the shared serial sequence unenforceable.
--
-- Note the ABSENCE of doctor_id: it is reachable via clinic_session, and
-- duplicating it would create a transitive dependency (§4.2).
CREATE TABLE queueing.appointment (
    id                          uuid PRIMARY KEY,
    appointment_ref             text NOT NULL UNIQUE,       -- FR-APT-04, 'MED-2026-0081'
    clinic_session_id           uuid NOT NULL REFERENCES scheduling.clinic_session(id),
    session_slot_id             uuid REFERENCES scheduling.session_slot(id),  -- NULL for walk-ins
    student_id                  uuid REFERENCES identity.student_profile(user_account_id),
    unregistered_name           text,                       -- VR-29
    serial_number               integer NOT NULL,
    origin                      queueing.appointment_origin NOT NULL,
    status                      queueing.appointment_status NOT NULL DEFAULT 'booked',

    is_emergency                boolean NOT NULL DEFAULT false,   -- BR-17
    emergency_reason            varchar(500),                      -- VR-30
    exceeded_walkin_allocation  boolean NOT NULL DEFAULT false,   -- FR-APT-42 / EC-10

    visit_reason_category_id    uuid REFERENCES queueing.visit_reason_category(id),
    visit_reason_note           varchar(200),               -- VR-25

    estimate_at_booking         timestamptz,                -- BR-20 baseline for slip detection
    current_estimate            timestamptz,                -- D2
    last_slip_notified_at       timestamptz,                -- EC-12 flood control
    payment_status              billing.payment_state NOT NULL DEFAULT 'unpaid',   -- D3

    checked_in_at               timestamptz,
    consultation_started_at     timestamptz,                -- FR-APT-25
    consultation_completed_at   timestamptz,
    no_show_marked_at           timestamptz,
    no_show_marked_by           uuid REFERENCES identity.user_account(id),   -- FR-APT-32: never automatic
    cancelled_at                timestamptz,
    cancellation_reason         varchar(500),

    entered_retrospectively     boolean NOT NULL DEFAULT false,  -- NFR-REL-04, EC-18
    idempotency_key             text UNIQUE,                     -- command-buffer replay (§5.6)

    created_by                  uuid NOT NULL,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now(),
    version                     integer NOT NULL DEFAULT 1,       -- VR-92

    CONSTRAINT ck_appointment_subject
        CHECK (student_id IS NOT NULL OR unregistered_name IS NOT NULL),          -- VR-29
    CONSTRAINT ck_appointment_walkin_slot
        CHECK (origin <> 'walk_in' OR session_slot_id IS NULL),                   -- FR-APT-35
    CONSTRAINT ck_appointment_booked_slot
        CHECK (origin <> 'booked' OR session_slot_id IS NOT NULL),
    CONSTRAINT ck_appointment_emergency_reason
        CHECK (NOT is_emergency OR length(btrim(coalesce(emergency_reason,''))) >= 10),  -- VR-30
    CONSTRAINT ck_appointment_serial CHECK (serial_number >= 1),
    CONSTRAINT ck_appointment_consult_order
        CHECK (consultation_completed_at IS NULL
               OR consultation_started_at IS NULL
               OR consultation_completed_at >= consultation_started_at),
    CONSTRAINT uq_appointment_session_serial UNIQUE (clinic_session_id, serial_number)  -- EC-09
);

-- EC-01: exactly one winner for a contested slot, enforced by the index.
-- The partial predicate also delivers BR-21 — a cancelled appointment
-- leaves the set and the slot becomes claimable with no cleanup step.
CREATE UNIQUE INDEX uq_appointment_slot_active
    ON queueing.appointment (session_slot_id)
    WHERE session_slot_id IS NOT NULL
      AND status IN ('booked','checked_in','waiting','in_consultation','completed');

-- BR-11, second clause: at most one active booking per student per doctor
-- per day. Enforced against the session (which carries doctor + date).
CREATE UNIQUE INDEX uq_appointment_student_session_active
    ON queueing.appointment (student_id, clinic_session_id)
    WHERE student_id IS NOT NULL
      AND status IN ('booked','checked_in','waiting','in_consultation');

-- =====================================================================
-- SCHEMA: billing
-- =====================================================================

CREATE TABLE billing.fee_waiver_reason (                    -- VR-42
    id          uuid PRIMARY KEY,
    code        text NOT NULL UNIQUE,
    label       text NOT NULL,
    is_active   boolean NOT NULL DEFAULT true
);

-- An immutable financial ledger. FR-PAY-10 forbids overwriting or
-- deleting a payment; corrections are new rows referencing the original.
CREATE TABLE billing.payment (
    id                  uuid PRIMARY KEY,
    appointment_id      uuid NOT NULL REFERENCES queueing.appointment(id),
    location_id         uuid NOT NULL REFERENCES config.location(id),
    kind                billing.payment_kind NOT NULL,
    amount              numeric(10,2) NOT NULL,             -- P6, NFR-ACC-04
    receipt_number      text,                               -- VR-41; NULL for waivers
    waiver_reason_id    uuid REFERENCES billing.fee_waiver_reason(id),
    adjusts_payment_id  uuid REFERENCES billing.payment(id),    -- FR-PAY-10, EC-23
    adjustment_reason   varchar(500),
    recorded_on         date NOT NULL,                      -- receipt uniqueness is per day (VR-41)
    recorded_by         uuid NOT NULL REFERENCES identity.user_account(id),
    recorded_at         timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ck_payment_amount CHECK (amount >= 0),                              -- VR-40
    CONSTRAINT ck_payment_receipt
        CHECK (kind <> 'counter_payment' OR receipt_number IS NOT NULL),           -- VR-41
    CONSTRAINT ck_payment_waiver
        CHECK (kind <> 'waiver' OR waiver_reason_id IS NOT NULL),                  -- BR-33, VR-42
    CONSTRAINT ck_payment_adjustment
        CHECK (kind <> 'adjustment'
               OR (adjusts_payment_id IS NOT NULL
                   AND length(btrim(coalesce(adjustment_reason,''))) >= 10))       -- VR-93
);

CREATE UNIQUE INDEX uq_payment_receipt_per_day                                     -- VR-41
    ON billing.payment (location_id, recorded_on, receipt_number)
    WHERE receipt_number IS NOT NULL;

-- BR-34 / FR-PAY-09: discrepancies are RECORDED, never silently corrected.
-- discrepancy is GENERATED because the expression is immutable.
CREATE TABLE billing.daily_reconciliation (
    id                  uuid PRIMARY KEY,
    location_id         uuid NOT NULL REFERENCES config.location(id),
    business_date       date NOT NULL,
    system_total        numeric(10,2) NOT NULL,
    counted_cash        numeric(10,2) NOT NULL,
    discrepancy         numeric(10,2) GENERATED ALWAYS AS (counted_cash - system_total) STORED,
    discrepancy_reason  varchar(500),
    reconciled_by       uuid NOT NULL REFERENCES identity.user_account(id),
    reconciled_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_reconciliation_day UNIQUE (location_id, business_date),
    CONSTRAINT ck_reconciliation_reason                                            -- VR-43
        CHECK (counted_cash = system_total
               OR length(btrim(coalesce(discrepancy_reason,''))) >= 10)
);

-- =====================================================================
-- SCHEMA: pharmacy
-- =====================================================================

CREATE TABLE pharmacy.medicine (
    id                      uuid PRIMARY KEY,
    generic_name            text NOT NULL,
    brand_name              text,
    strength                text NOT NULL,
    dosage_form             text NOT NULL,
    dispensing_class        pharmacy.dispensing_class NOT NULL,     -- FR-MED-11: never unclassified
    low_stock_threshold     integer NOT NULL DEFAULT 0,             -- FR-MED-22
    is_active               boolean NOT NULL DEFAULT true,          -- EC-35: deactivate, never delete
    created_by              uuid NOT NULL,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    version                 integer NOT NULL DEFAULT 1,
    CONSTRAINT uq_medicine_natural_key
        UNIQUE (generic_name, strength, dosage_form),                -- VR-51
    CONSTRAINT ck_medicine_threshold CHECK (low_stock_threshold >= 0)  -- VR-60
);

-- FR-MED-13: batch-level stock. quantity_remaining is D1 — a maintained
-- aggregate over stock_movement, which remains the source of truth.
CREATE TABLE pharmacy.medicine_batch (
    id                  uuid PRIMARY KEY,
    medicine_id         uuid NOT NULL REFERENCES pharmacy.medicine(id),
    location_id         uuid NOT NULL REFERENCES config.location(id),
    batch_ref           text NOT NULL,
    expiry_date         date NOT NULL,
    quantity_received   integer NOT NULL,
    quantity_remaining  integer NOT NULL,
    received_by         uuid NOT NULL REFERENCES identity.user_account(id),
    received_at         timestamptz NOT NULL DEFAULT now(),
    -- AMENDMENT DDL-01 (see 000_AMENDMENTS.md): DATABASE.md §9 omits
    -- updated_at here, but §3's own convention requires it "on every mutable
    -- table", the table is mutable (quantity_remaining changes on every
    -- movement), and config.fn_bump_version() assigns NEW.updated_at — so
    -- without this column every UPDATE on a batch fails outright.
    updated_at          timestamptz NOT NULL DEFAULT now(),
    version             integer NOT NULL DEFAULT 1,
    CONSTRAINT uq_batch_ref UNIQUE (medicine_id, batch_ref),                       -- VR-54
    CONSTRAINT ck_batch_received CHECK (quantity_received > 0),                    -- VR-52
    CONSTRAINT ck_batch_remaining
        CHECK (quantity_remaining >= 0 AND quantity_remaining <= quantity_received)
    -- VR-53 (expiry must be in the future AT RECEIPT) is enforced by trigger:
    -- current_date is not immutable and cannot appear in a CHECK.
);

CREATE TABLE pharmacy.stock_adjustment_reason (             -- VR-59
    id          uuid PRIMARY KEY,
    code        text NOT NULL UNIQUE
                CHECK (code IN ('DAMAGE','LOSS','CORRECTION','EXPIRY_REMOVAL')),
    label       text NOT NULL
);

-- APPEND-ONLY (FR-MED-21, P3). No updated_at, no version — nothing here
-- is ever modified. Corrections are new rows (EC-30).
CREATE TABLE pharmacy.stock_movement (
    id                      uuid PRIMARY KEY,
    medicine_batch_id       uuid NOT NULL REFERENCES pharmacy.medicine_batch(id),
    kind                    pharmacy.movement_kind NOT NULL,
    quantity_delta          integer NOT NULL,               -- +receipt, -dispense, signed adjustment
    adjustment_reason_id    uuid REFERENCES pharmacy.stock_adjustment_reason(id),
    detail                  varchar(500),
    fefo_overridden         boolean NOT NULL DEFAULT false, -- BR-39
    fefo_override_reason    varchar(500),                   -- VR-57
    dispensing_limit_overridden boolean NOT NULL DEFAULT false,  -- VR-58, EC-29
    limit_override_reason   varchar(500),
    recorded_by             uuid NOT NULL REFERENCES identity.user_account(id),
    recorded_at             timestamptz NOT NULL DEFAULT now(),
    correlation_id          text,

    CONSTRAINT ck_movement_delta CHECK (quantity_delta <> 0),
    CONSTRAINT ck_movement_receipt_sign  CHECK (kind <> 'receipt'  OR quantity_delta > 0),
    CONSTRAINT ck_movement_dispense_sign CHECK (kind <> 'dispense' OR quantity_delta < 0),
    CONSTRAINT ck_movement_adjustment                                              -- VR-59
        CHECK (kind <> 'adjustment'
               OR (adjustment_reason_id IS NOT NULL
                   AND length(btrim(coalesce(detail,''))) >= 10)),
    CONSTRAINT ck_movement_fefo_override                                           -- VR-57
        CHECK (NOT fefo_overridden OR length(btrim(coalesce(fefo_override_reason,''))) >= 10),
    CONSTRAINT ck_movement_limit_override                                          -- VR-58
        CHECK (NOT dispensing_limit_overridden
               OR length(btrim(coalesce(limit_override_reason,''))) >= 10)
);

-- BR-42: scheduled hours are the DEFAULT source of truth.
-- VR-61: at most one interval per weekday in Phase 1.
CREATE TABLE pharmacy.store_hours (
    id              uuid PRIMARY KEY,
    location_id     uuid NOT NULL REFERENCES config.location(id),
    weekday         smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    opens_at        time NOT NULL,
    closes_at       time NOT NULL,
    updated_by      uuid NOT NULL,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    version         integer NOT NULL DEFAULT 1,
    CONSTRAINT uq_store_hours_weekday UNIQUE (location_id, weekday),
    CONSTRAINT ck_store_hours_order CHECK (closes_at > opens_at)                   -- VR-61
);

-- BR-42: a manual override expires automatically at end of day. Modelled
-- as a dated row rather than a mutable flag, so expiry needs no job — a
-- query for "today" simply finds nothing tomorrow.
CREATE TABLE pharmacy.store_status_override (
    id              uuid PRIMARY KEY,
    location_id     uuid NOT NULL REFERENCES config.location(id),
    effective_date  date NOT NULL,
    is_closed       boolean NOT NULL,
    reason          varchar(500) NOT NULL,
    created_by      uuid NOT NULL REFERENCES identity.user_account(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_store_override_day UNIQUE (location_id, effective_date),
    CONSTRAINT ck_store_override_reason CHECK (length(btrim(reason)) >= 10)        -- VR-62
);

-- =====================================================================
-- SCHEMA: notification
-- =====================================================================

-- FR-NTF-05 enforced at DEFINITION time: a discreet template may not
-- accept free text, because free text cannot be validated for leakage.
-- The Content Policy Guard (ADR-007) enforces the same rule at dispatch.
CREATE TABLE notification.notification_template (
    id                  uuid PRIMARY KEY,
    template_key        text NOT NULL UNIQUE,
    is_discreet         boolean NOT NULL DEFAULT false,
    allows_free_text    boolean NOT NULL DEFAULT false,
    subject_template    text NOT NULL,
    body_template       text NOT NULL,
    is_active           boolean NOT NULL DEFAULT true,
    version             integer NOT NULL DEFAULT 1,
    CONSTRAINT ck_template_discreet_no_freetext
        CHECK (NOT is_discreet OR NOT allows_free_text)
);

CREATE TABLE notification.notification (
    id              uuid PRIMARY KEY,
    recipient_id    uuid NOT NULL REFERENCES identity.user_account(id),
    template_id     uuid NOT NULL REFERENCES notification.notification_template(id),
    payload         jsonb NOT NULL DEFAULT '{}'::jsonb,     -- NFR-PRIV-03: never PHI
    read_at         timestamptz,
    correlation_id  text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- ADR-006: transactional outbox. claimed_by + claimed_at permit multiple
-- workers without double dispatch (architecture §12.5).
CREATE TABLE notification.notification_outbox (
    id                  uuid PRIMARY KEY,
    notification_id     uuid NOT NULL REFERENCES notification.notification(id),
    channel             notification.channel NOT NULL,
    status              notification.outbox_status NOT NULL DEFAULT 'pending',
    attempt_count       smallint NOT NULL DEFAULT 0,
    next_attempt_at     timestamptz NOT NULL DEFAULT now(),
    claimed_by          text,
    claimed_at          timestamptz,
    last_error          text,
    delivered_at        timestamptz,
    CONSTRAINT ck_outbox_attempts CHECK (attempt_count >= 0 AND attempt_count <= 3)
);

-- =====================================================================
-- SCHEMA: audit
-- =====================================================================

-- APPEND-ONLY (BR-61, P3). Enforced twice: REVOKE in §11 and a trigger
-- that raises. Two mechanisms because a future GRANT could undo the first.
CREATE TABLE audit.audit_log (
    id              uuid PRIMARY KEY,
    entity_type     text NOT NULL,
    entity_id       uuid,
    action          text NOT NULL,
    before_state    jsonb,                                  -- BR-60
    after_state     jsonb,
    actor_id        uuid REFERENCES identity.user_account(id),
    actor_role      text,
    correlation_id  text,                                   -- §11.3 of the architecture
    occurred_at     timestamptz NOT NULL DEFAULT now()
);

-- PRM-12. Separated from audit_log: potentially high volume under attack,
-- different retention, different query pattern.
CREATE TABLE audit.authz_denial (
    id              uuid PRIMARY KEY,
    actor_id        uuid REFERENCES identity.user_account(id),
    attempted_role  text,
    resource        text NOT NULL,
    operation       text NOT NULL,
    reason          text NOT NULL,
    source_address  inet,
    correlation_id  text,
    occurred_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit.data_access_log (                        -- FR-AUD-03
    id              uuid PRIMARY KEY,
    accessor_id     uuid NOT NULL REFERENCES identity.user_account(id),
    subject_id      uuid NOT NULL REFERENCES identity.user_account(id),
    data_category   text NOT NULL,
    correlation_id  text,
    occurred_at     timestamptz NOT NULL DEFAULT now()
);

-- FR-AUD-05/06/07. Deliberately uncomfortable: a long justification, an
-- immediate notification, a hard expiry, no silent renewal.
CREATE TABLE audit.break_glass_grant (
    id                  uuid PRIMARY KEY,
    administrator_id    uuid NOT NULL REFERENCES identity.user_account(id),
    justification       text NOT NULL,
    granted_at          timestamptz NOT NULL DEFAULT now(),
    expires_at          timestamptz NOT NULL,
    head_notified_at    timestamptz,                        -- FR-AUD-06
    revoked_at          timestamptz,
    CONSTRAINT ck_break_glass_justification
        CHECK (length(btrim(justification)) >= 20),         -- FR-AUD-05
    CONSTRAINT ck_break_glass_duration
        CHECK (expires_at > granted_at
               AND expires_at <= granted_at + interval '60 minutes')   -- FR-AUD-07
);
