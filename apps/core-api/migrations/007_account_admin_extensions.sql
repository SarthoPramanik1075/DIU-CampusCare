-- =====================================================================
-- campuscare_core — 007 Account administration extensions (M1 · Foundations)
--
-- One addition, recorded as DDL-04 in 000_AMENDMENTS.md. Does not modify
-- 001-006 (an applied migration is immutable — see
-- packages/db-tools/src/migrate.ts's checksum guard).
-- =====================================================================

-- API §1.3 POST/PATCH /users and VR-04's CNP-grant gate both depend on this
-- flag, but DATABASE.md's identity.user_account never defines it. The
-- existing table-level GRANT on every identity.* table (005_grants.sql)
-- already covers this new column — no additional GRANT needed.
ALTER TABLE identity.user_account
    ADD COLUMN is_clinical_staff boolean NOT NULL DEFAULT false;
