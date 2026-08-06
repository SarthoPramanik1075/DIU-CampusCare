-- =====================================================================
-- campuscare_core — 004 availability projection
-- DATABASE.md §9.3.
--
-- AD-5 / NFR-PERF-01: the anonymous public read path. Refreshed by the
-- worker on StockLevelChanged and by the 00:01 expiry sweep (FR-MED-17).
-- CONCURRENTLY requires a unique index, hence the one below.
-- =====================================================================

CREATE MATERIALIZED VIEW pharmacy.mv_medicine_availability AS
SELECT
    m.id                        AS medicine_id,
    m.generic_name,
    m.brand_name,
    m.strength,
    m.dosage_form,
    m.dispensing_class,
    COALESCE(SUM(b.quantity_remaining) FILTER (
        WHERE b.expiry_date > current_date), 0)   AS dispensable_quantity,
    CASE                                                    -- BR-36
        WHEN COALESCE(SUM(b.quantity_remaining) FILTER (
             WHERE b.expiry_date > current_date), 0) = 0
            THEN 'out_of_stock'
        WHEN COALESCE(SUM(b.quantity_remaining) FILTER (
             WHERE b.expiry_date > current_date), 0) <= m.low_stock_threshold
            THEN 'low_stock'
        ELSE 'available'
    END                                            AS status_band,
    MAX(mv.recorded_at)                            AS last_movement_at,  -- FR-MED-04 freshness stamp
    b.location_id
FROM pharmacy.medicine m
LEFT JOIN pharmacy.medicine_batch b ON b.medicine_id = m.id
LEFT JOIN LATERAL (
    SELECT max(recorded_at) AS recorded_at
      FROM pharmacy.stock_movement sm
     WHERE sm.medicine_batch_id = b.id
) mv ON true
WHERE m.is_active
GROUP BY m.id, m.generic_name, m.brand_name, m.strength,
         m.dosage_form, m.dispensing_class, m.low_stock_threshold, b.location_id;

CREATE UNIQUE INDEX uq_mv_medicine_availability
    ON pharmacy.mv_medicine_availability (medicine_id, location_id);

-- NOTE: dispensable_quantity is present because the OPERATOR role needs
-- it (FR-MED-05 permits operator and administrator only). The student-
-- facing read path selects status_band and last_movement_at ONLY.
-- Column-level GRANTs in 005 enforce this rather than trusting the query.
