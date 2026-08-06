-- =====================================================================
-- campuscare_counseling — 002 indexes
-- DATABASE.md §10.1.
-- =====================================================================

-- FR-CSE-01: the triage queue's exact sort — priority DESC, then waiting
-- time. Partial, so it holds only untriaged and in-review work.
CREATE INDEX ix_case_triage_queue
    ON counseling.counseling_case (final_priority DESC, opened_at ASC)
    WHERE status IN ('requested','under_review');

CREATE INDEX ix_request_sla_due
    ON counseling.counseling_request (triage_due_at)
    WHERE status = 'requested';

CREATE INDEX ix_case_inactivity
    ON counseling.counseling_case (last_activity_at)
    WHERE status NOT IN ('closed','withdrawn','declined');

CREATE INDEX ix_case_note_case
    ON counseling.case_note (case_id, authored_at DESC);

CREATE INDEX ix_case_session_upcoming
    ON counseling.case_session (scheduled_for)
    WHERE outcome IS NULL;

CREATE INDEX ix_access_log_case
    ON clinical_audit.counseling_access_log (case_id, accessed_at DESC);
CREATE INDEX ix_access_log_accessor
    ON clinical_audit.counseling_access_log (accessor_ref_id, accessed_at DESC);

-- ADR-012: hit on EVERY vault request, before anything else happens.
CREATE INDEX ix_roster_active_user
    ON counseling.clinical_roster (user_ref_id)
    WHERE is_active;
