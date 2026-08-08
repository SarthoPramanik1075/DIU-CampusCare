-- =====================================================================
-- campuscare_core — 013 version column for config.service_calendar (M2 · Schedules)
--
-- One addition, recorded as DDL-07 in 000_AMENDMENTS.md. Does not modify
-- 001-012 (an applied migration is immutable — see
-- packages/db-tools/src/migrate.ts's checksum guard).
-- =====================================================================

-- API §8.5 `PATCH /api/v1/service-calendar/{id}` requires `version`
-- (VR-92), but 001_schema.sql never gave `config.service_calendar` a
-- `version` column — the same category of gap DDL-03/DDL-05 resolved for
-- missing storage elsewhere. No trigger: manually incremented in the
-- `UPDATE ... SET version = version + 1 WHERE ... AND version = $expected`
-- statement, the same pattern `scheduling.doctor`/`duty_roster` use
-- (rather than `clinic_session`'s trigger-based bump), since this table
-- has no other reason to need a trigger.
ALTER TABLE config.service_calendar ADD COLUMN version integer NOT NULL DEFAULT 1;
