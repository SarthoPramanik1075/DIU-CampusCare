-- =====================================================================
-- campuscare_core — 014 DELETE grant for config.service_calendar (M2 · Schedules)
--
-- One addition, recorded as GRANT-04 in 000_AMENDMENTS.md. Does not
-- modify 001-013 (an applied migration is immutable — see
-- packages/db-tools/src/migrate.ts's checksum guard).
-- =====================================================================

-- API §8.6 `DELETE /api/v1/service-calendar/{id}` genuinely removes the
-- row — "reopening the day for booking," not a soft-deactivation, and the
-- table has no `is_active`/`deleted_at` column. Fourth instance of the
-- same shape of gap as GRANT-01/02/03 (`scheduling.doctor`,
-- `scheduling.session_slot`, `scheduling.doctor_unavailability`):
-- 005_grants.sql withholds DELETE from `campuscare_core_app` everywhere
-- by design, and this table has the same kind of specified, narrow
-- exception the other three did. Added proactively, not found live.
GRANT DELETE ON config.service_calendar TO campuscare_core_app;
