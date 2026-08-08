-- =====================================================================
-- campuscare_core — 009 DELETE grant for scheduling.doctor (M2 · Schedules)
--
-- One addition, recorded as GRANT-01 in 000_AMENDMENTS.md. Does not
-- modify 001-008 (an applied migration is immutable — see
-- packages/db-tools/src/migrate.ts's checksum guard).
-- =====================================================================

-- API §3.1 `DELETE /api/v1/doctors/{id}` (EC-20) is a real, specified hard
-- delete — "permitted only when no appointment has ever referenced it" —
-- but 005_grants.sql withholds DELETE from campuscare_core_app on every
-- table, deliberately, per P4/NFR-RET-01 ("nothing is ever deleted in
-- Phase 1"). Scoped narrowly to the one table with a genuine, specified
-- hard-delete requirement, rather than reopening DELETE broadly — every
-- other table keeps zero DELETE privilege exactly as 005_grants.sql
-- intended. The `clinic_session.doctor_id` foreign key (no `ON DELETE
-- CASCADE`) still makes deletion physically impossible once real
-- appointment history exists, so P4's spirit — nothing with real
-- operational history is ever deleted — holds regardless of this grant.
GRANT DELETE ON scheduling.doctor TO campuscare_core_app;
