-- =====================================================================
-- campuscare_core — 003 triggers and functions
-- DATABASE.md §9.2.
--
-- These are not conveniences. Each one enforces a rule that cannot be
-- expressed as a CHECK (because it needs current_date, another row, or a
-- lock) and that must not be left to application code, because the
-- application is not the only writer and is not race-free.
-- =====================================================================

-- ---------------------------------------------------------------------
-- P3: append-only enforcement.
-- REVOKE alone is insufficient — a future GRANT could undo it. The
-- trigger makes the prohibition intrinsic to the table.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit.fn_forbid_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION
        'Table %.% is append-only (BR-61 / FR-MED-21). Attempted: %',
        TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER trg_audit_log_immutable
    BEFORE UPDATE OR DELETE ON audit.audit_log
    FOR EACH ROW EXECUTE FUNCTION audit.fn_forbid_mutation();

CREATE TRIGGER trg_stock_movement_immutable
    BEFORE UPDATE OR DELETE ON pharmacy.stock_movement
    FOR EACH ROW EXECUTE FUNCTION audit.fn_forbid_mutation();

CREATE TRIGGER trg_payment_immutable                        -- FR-PAY-10
    BEFORE UPDATE OR DELETE ON billing.payment
    FOR EACH ROW EXECUTE FUNCTION audit.fn_forbid_mutation();

CREATE TRIGGER trg_authz_denial_immutable
    BEFORE UPDATE OR DELETE ON audit.authz_denial
    FOR EACH ROW EXECUTE FUNCTION audit.fn_forbid_mutation();

-- ---------------------------------------------------------------------
-- P7: optimistic concurrency (VR-92 — reject stale writes, never merge).
--
-- The caller echoes the version it read. If it differs from the stored
-- version the write is rejected, never merged; EC-19 then requires the
-- current state to be re-presented, which the interface layer does.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION config.fn_bump_version()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.version <> OLD.version THEN
        RAISE EXCEPTION
            'Concurrent modification of %.% id=% (VR-92). Expected version %, found %.',
            TG_TABLE_SCHEMA, TG_TABLE_NAME, OLD.id, NEW.version, OLD.version
            USING ERRCODE = 'serialization_failure';
    END IF;
    NEW.version    := OLD.version + 1;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_appointment_version
    BEFORE UPDATE ON queueing.appointment
    FOR EACH ROW EXECUTE FUNCTION config.fn_bump_version();

CREATE TRIGGER trg_clinic_session_version
    BEFORE UPDATE ON scheduling.clinic_session
    FOR EACH ROW EXECUTE FUNCTION config.fn_bump_version();

CREATE TRIGGER trg_medicine_batch_version
    BEFORE UPDATE ON pharmacy.medicine_batch
    FOR EACH ROW EXECUTE FUNCTION config.fn_bump_version();

-- ---------------------------------------------------------------------
-- D1: maintain medicine_batch.quantity_remaining from stock_movement.
-- Same transaction as the movement, so the two can never disagree.
-- The movement log stays authoritative (FR-MED-20).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pharmacy.fn_apply_stock_movement()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_remaining integer;
    v_expiry    date;
BEGIN
    SELECT quantity_remaining, expiry_date
      INTO v_remaining, v_expiry
      FROM pharmacy.medicine_batch
     WHERE id = NEW.medicine_batch_id
       FOR UPDATE;                                  -- serialise per batch

    -- BR-40 / FR-MED-18: dispensing from an expired batch is refused
    -- with NO override available. current_date cannot live in a CHECK,
    -- so the rule is enforced here at the moment of the movement.
    IF NEW.kind = 'dispense' AND v_expiry <= current_date THEN
        RAISE EXCEPTION
            'Batch % expired on % — dispensing is prohibited (BR-40, FR-MED-18).',
            NEW.medicine_batch_id, v_expiry
            USING ERRCODE = 'check_violation';
    END IF;

    IF v_remaining + NEW.quantity_delta < 0 THEN
        RAISE EXCEPTION
            'Insufficient stock in batch %: % remaining, % requested (VR-55).',
            NEW.medicine_batch_id, v_remaining, abs(NEW.quantity_delta)
            USING ERRCODE = 'check_violation';
    END IF;

    -- AMENDMENT DDL-02 (see 000_AMENDMENTS.md): DATABASE.md §9.2 sets
    -- `version = version + 1` here. That collides with trg_medicine_batch_version,
    -- which fires BEFORE UPDATE on this table and treats any NEW.version that
    -- differs from OLD.version as a stale write (VR-92) — so every stock
    -- movement was rejected with serialization_failure.
    --
    -- The version column is left alone; fn_bump_version() owns it and
    -- increments it. One writer per column is the point of that trigger.
    UPDATE pharmacy.medicine_batch
       SET quantity_remaining = quantity_remaining + NEW.quantity_delta
     WHERE id = NEW.medicine_batch_id;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_stock_movement_apply
    AFTER INSERT ON pharmacy.stock_movement
    FOR EACH ROW EXECUTE FUNCTION pharmacy.fn_apply_stock_movement();

-- ---------------------------------------------------------------------
-- VR-53: expiry must be in the future AT RECEIPT.
-- Not a CHECK, because current_date is not immutable.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pharmacy.fn_validate_batch_expiry()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.expiry_date <= current_date THEN
        RAISE EXCEPTION
            'Cannot receive stock expiring on % — already expired (VR-53).',
            NEW.expiry_date
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_batch_expiry_validate
    BEFORE INSERT ON pharmacy.medicine_batch
    FOR EACH ROW EXECUTE FUNCTION pharmacy.fn_validate_batch_expiry();

-- ---------------------------------------------------------------------
-- D3: maintain appointment.payment_status from the payment ledger.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION billing.fn_sync_payment_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE queueing.appointment
       SET payment_status = CASE NEW.kind
                                WHEN 'counter_payment' THEN 'paid'::billing.payment_state
                                WHEN 'waiver'          THEN 'waived'::billing.payment_state
                                ELSE payment_status
                            END
     WHERE id = NEW.appointment_id;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_payment_sync_status
    AFTER INSERT ON billing.payment
    FOR EACH ROW EXECUTE FUNCTION billing.fn_sync_payment_status();

-- ---------------------------------------------------------------------
-- D4 / EC-09: allocate the next serial for a session.
-- Serialises PER SESSION (row lock), not globally — matching the
-- concurrency assumption in ARCHITECTURE §12.2.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION queueing.fn_next_serial(p_session_id uuid)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v_serial integer;
BEGIN
    UPDATE scheduling.clinic_session
       SET next_serial = next_serial + 1
     WHERE id = p_session_id
    RETURNING next_serial - 1 INTO v_serial;

    IF v_serial IS NULL THEN
        RAISE EXCEPTION 'Session % not found (BR-25).', p_session_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN v_serial;
END;
$$;
