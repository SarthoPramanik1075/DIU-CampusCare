-- =====================================================================
-- campuscare_core — 005 in-database grants
-- DATABASE.md §11.
--
-- Role creation and the database-level CONNECT grants live in
-- tools/db-setup.ts, because CREATE ROLE is cluster-scoped and the
-- CONNECT grant on the counseling database cannot be issued from a
-- session connected to this one.
--
-- THE BOUNDARY: campuscare_core_app is deliberately ABSENT from the
-- CONNECT grant on campuscare_counseling. That absence is ADR-001. There
-- is no code path, no view, no join and no search_path trick that
-- crosses it. tests/architecture asserts it on every build.
-- =====================================================================

GRANT USAGE ON SCHEMA config, identity, scheduling, queueing,
                       billing, pharmacy, notification, audit
    TO campuscare_core_app;

GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA
      config, identity, scheduling, queueing, billing, pharmacy, notification
    TO campuscare_core_app;

-- P4: nothing is ever deleted in Phase 1 (NFR-RET-01).
-- No DELETE is granted anywhere, deliberately.

-- P3: append-only tables get INSERT and SELECT only.
GRANT SELECT, INSERT ON audit.audit_log,
                        audit.authz_denial,
                        audit.data_access_log,
                        pharmacy.stock_movement,
                        billing.payment
    TO campuscare_core_app;
REVOKE UPDATE, DELETE ON audit.audit_log,
                         audit.authz_denial,
                         audit.data_access_log,
                         pharmacy.stock_movement,
                         billing.payment
    FROM campuscare_core_app;

GRANT SELECT, INSERT, UPDATE ON audit.break_glass_grant TO campuscare_core_app;

-- D4: the serial allocator is called on the booking path.
GRANT EXECUTE ON FUNCTION queueing.fn_next_serial(uuid) TO campuscare_core_app;

-- The availability projection is read by the public search path.
GRANT SELECT ON pharmacy.mv_medicine_availability TO campuscare_core_app;

-- ---- Reporting: FR-ADM-09 / NFR-PRIV-06 ------------------------------
GRANT USAGE ON SCHEMA queueing, scheduling, billing, pharmacy TO campuscare_reporting;
GRANT SELECT ON queueing.appointment,
                scheduling.clinic_session,
                scheduling.doctor,
                billing.payment,
                billing.daily_reconciliation,
                pharmacy.stock_movement,
                pharmacy.medicine
    TO campuscare_reporting;

-- Credentials and sessions are withheld from reporting entirely.
REVOKE ALL ON identity.local_credential, identity.user_session FROM campuscare_reporting;

-- FR-MED-05: students and non-operator roles must never see exact
-- quantities. Column-level GRANT enforces this at the engine rather than
-- relying on every query being written correctly.
REVOKE ALL ON pharmacy.mv_medicine_availability FROM campuscare_reporting;
GRANT SELECT (medicine_id, generic_name, brand_name, strength, dosage_form,
              dispensing_class, status_band, last_movement_at, location_id)
    ON pharmacy.mv_medicine_availability TO campuscare_reporting;
