-- =====================================================================
-- campuscare_counseling — 003 grants and row-level security
-- DATABASE.md §11 and §11.1.
-- =====================================================================

GRANT USAGE ON SCHEMA counseling, clinical_audit TO campuscare_counseling_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA counseling
    TO campuscare_counseling_app;

-- FR-CSE-15/16: the access log is written and read, never altered.
GRANT SELECT, INSERT ON clinical_audit.counseling_access_log TO campuscare_counseling_app;
REVOKE UPDATE, DELETE ON clinical_audit.counseling_access_log FROM campuscare_counseling_app;

-- =====================================================================
-- Row-Level Security — vault only. DATABASE §11.1.
--
-- Defence in depth for the one dataset rated Critical (NFR-SEC-06).
-- Even if the Clinical PEP were bypassed, a session that has not set
-- app.current_counselor to an ACTIVE roster member sees zero rows.
--
-- Applied ONLY to the counseling database. Adding RLS across the core
-- schema would add complexity for data whose exposure is rated Medium,
-- and PRM-01 already places authoritative enforcement in the PDP.
--
-- ---------------------------------------------------------------------
-- OPEN FINDING — RLS-01, must be resolved before M6 builds intake.
--
-- As specified, p_request_counselor_only applies FOR ALL to the single
-- application role and requires an active roster member. A student
-- submitting a request (FR-CNS-07) connects as the same role with no
-- app.current_counselor set, so the EXISTS is false and the INSERT is
-- refused — a student could not create or read their own request.
--
-- The policy is applied here VERBATIM as approved rather than silently
-- altered. Two candidate resolutions for M6, neither chosen here:
--
--   (a) add a second policy admitting the owning student when
--       app.current_student matches counseling_request.student_ref_id;
--   (b) drop RLS from counseling_request and keep it on counseling_case
--       and case_note, where every reader is by definition a counsellor.
--
-- (a) preserves the defence-in-depth intent for intake; (b) is simpler
-- and loses nothing the Clinical PEP does not already enforce. This is a
-- DATABASE.md amendment, not an implementation decision, so it is raised
-- rather than taken.
-- =====================================================================

ALTER TABLE counseling.counseling_case ENABLE ROW LEVEL SECURITY;
ALTER TABLE counseling.case_note       ENABLE ROW LEVEL SECURITY;
ALTER TABLE counseling.counseling_request ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_case_counselor_only ON counseling.counseling_case
    FOR ALL TO campuscare_counseling_app
    USING (EXISTS (
        SELECT 1 FROM counseling.clinical_roster r
         WHERE r.user_ref_id = current_setting('app.current_counselor', true)::uuid
           AND r.is_active
    ));

CREATE POLICY p_note_counselor_only ON counseling.case_note
    FOR ALL TO campuscare_counseling_app
    USING (EXISTS (
        SELECT 1 FROM counseling.clinical_roster r
         WHERE r.user_ref_id = current_setting('app.current_counselor', true)::uuid
           AND r.is_active
    ));

CREATE POLICY p_request_counselor_only ON counseling.counseling_request
    FOR ALL TO campuscare_counseling_app
    USING (EXISTS (
        SELECT 1 FROM counseling.clinical_roster r
         WHERE r.user_ref_id = current_setting('app.current_counselor', true)::uuid
           AND r.is_active
    ));

-- current_setting(..., true) returns NULL when unset, and NULL::uuid
-- matches nothing — so an unconfigured session sees no rows. Fails closed,
-- consistent with PRM-02.
