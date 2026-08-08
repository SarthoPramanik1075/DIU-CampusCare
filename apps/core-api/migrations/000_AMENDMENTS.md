# Schema amendments against DATABASE.md

Findings raised while implementing M0.5 and M1, with what was done about each.

`DATABASE.md` is approved, so nothing here is a preference. Each entry is
either an **internal contradiction** — the document disagreeing with itself,
where the intent is unambiguous — or an **open question** left for the owning
milestone. Contradictions were repaired and are listed under *Applied*.
Everything else is listed under *Raised, not taken*.

All four were found by testing the schema rather than assuming it. None would
have surfaced until M5 or M6, by which point the code built on top would have
had to change too.

---

## Applied

### DDL-01 · `pharmacy.medicine_batch` had no `updated_at`

**Found by** `tests/integration/schema-invariants.test.ts`
→ *"BR-40 · refuses dispensing from an expired batch"*, which failed with
`record "new" has no field "updated_at"`.

**The contradiction.** `config.fn_bump_version()` (DATABASE §9.2) assigns
`NEW.updated_at := now()`, and `trg_medicine_batch_version` attaches it to
`pharmacy.medicine_batch`. But the table as defined in §9 has `received_at`
and no `updated_at`. DATABASE §3's own convention says audit columns
including `updated_at` belong on **every mutable table**, and this table is
mutable — `quantity_remaining` changes on every stock movement.

**Impact if unfixed.** *Every* `UPDATE` on a medicine batch raises. That
includes the D1 projection update, so no stock movement of any kind could be
recorded. The whole of M5 was unbuildable.

**Applied.** Added `updated_at timestamptz NOT NULL DEFAULT now()` to
`pharmacy.medicine_batch`, matching the other versioned tables
(`queueing.appointment`, `scheduling.clinic_session`).

---

### DDL-02 · `fn_apply_stock_movement` fought `fn_bump_version` for the version column

**Found by** the same suite → *"D1 · maintains quantity_remaining from the
movement log"*, which failed with
`Concurrent modification of pharmacy.medicine_batch (VR-92). Expected version 2, found 1.`

**The contradiction.** Two triggers both claim `medicine_batch.version`:

- `fn_apply_stock_movement()` (D1) explicitly sets `version = version + 1`.
- `fn_bump_version()` (P7/VR-92) fires `BEFORE UPDATE` on the same table and
  treats *any* `NEW.version` differing from `OLD.version` as a stale write,
  raising `serialization_failure`.

So D1's own update tripped VR-92's guard. The optimistic-concurrency check
cannot distinguish "a client sent a stale version" from "another trigger
already incremented it".

**Impact if unfixed.** Identical to DDL-01: no stock movement could be
recorded at all.

**Applied.** Removed the manual `version = version + 1` from
`fn_apply_stock_movement()`. `fn_bump_version()` owns that column and
increments it — one writer per column, which is the reason that trigger
exists.

---

### DDL-03 · no table for the password-reset token (M1)

**Found by** implementing FR-AUTH-08 / API §1.8 ("a single-use, time-limited
reset link"). `DATABASE.md`'s identity schema defines `user_account`,
`local_credential`, `role`, `user_role`, `user_session`, `login_attempt`,
`student_profile` and `booking_suspension` — no table for a reset token.

**Not a contradiction like DDL-01/02** — nothing in the DDL disagrees with
itself. It is an omission: a requirement the document states elsewhere
(single-use, time-limited, consumed on success — API §1.8) has no storage
defined for it anywhere in the approved schema.

**Impact if unfixed.** No way to issue or validate a reset token at all;
FR-AUTH-08 is unbuildable.

**Applied**, in `006_iam_extensions.sql`: added `identity.password_reset_token`
(`user_account_id`, `token_hash` — only the hash is stored, matching
`local_credential.password_hash`'s reasoning — `expires_at`, `consumed_at`).
Also seeded `identity.role`'s six rows (SRS §3.5.1) and two
`notification.notification_template` rows the M1 outbox writes reference —
both are reference/seed data no earlier migration populated, not schema
changes.

---

### DDL-04 · no column for `isClinicalStaff` (M1)

**Found by** implementing API §1.3 `POST /api/v1/users` / `PATCH /api/v1/users/{id}`.
VR-04 requires the `CNP` role to be grantable only to an account "marked as
clinical staff", and the request/response bodies both carry `isClinicalStaff`
as a persisted flag an Administrator sets once and a later role grant reads —
but `identity.user_account` (DATABASE §8) has no such column, and no other
table is a plausible home for a flag about the account itself.

**Not a contradiction** — an omission, the same shape as DDL-03: a rule the
document states (VR-04) has no storage defined for the fact it depends on.

**Impact if unfixed.** VR-04 could not be enforced at account-creation or
role-grant time at all — any account could receive `CNP`, defeating the rule
NFR-SEC-06 exists to protect (the vault's own clinical roster is the second,
independent authority; core-api's side of that split needs this flag to be
real).

**Applied**, in `007_account_admin_extensions.sql`: added
`identity.user_account.is_clinical_staff boolean NOT NULL DEFAULT false`.

---

### DDL-05 · no storage for the two-step leave flow's preview token, and no seeded location (M2)

**Found by** implementing API §3.21/§3.22 (FR-SCH-07, the doctor-unavailability
impact-preview-then-confirm flow) and, separately, by every scheduling table
carrying `location_id NOT NULL`.

Two independent gaps, bundled into one migration because both are pure
additions with no interaction:

1. FR-SCH-07 requires confirm to detect "the affected bookings changed since
   you looked" — API §3.22 documents this exactly as `IMPACT_CHANGED`,
   comparing the *current* affected set against what preview showed. That
   requires the preview call's result to be retrievable at confirm time, but
   DATABASE.md defines no table for it — the same shape of omission DDL-03
   resolved for the password-reset token.
2. `scheduling.doctor.location_id`, `scheduling.clinic_session.location_id`
   and `config.service_calendar.location_id` are all `NOT NULL REFERENCES
   config.location(id)`, but `config.location` has been empty since M0.5 —
   nothing before M2 ever needed a location to exist (M1's account creation
   treats `locationId` as optional). SRS's own `OI-04`/`DB-3` open item
   records multi-location as unconfirmed and explicitly out of Phase 1
   scope, so seeding exactly one row is the correct Phase-1-scoped action,
   not a stand-in for a real location catalogue that doesn't exist yet.

**Applied**, in `008_scheduling_extensions.sql`: one seeded `config.location`
row (`MAIN` / "DIU Medical Centre"); new table
`scheduling.unavailability_preview` (id, doctor_id, start_date, end_date,
reason, affected_appointment_ids uuid[], created_at, expires_at) — no hash,
since unlike a credential, a leaked preview id reveals nothing an MCS/ADM
session couldn't already read through the API; one seeded notification
template (`doctor_unavailability_cancelled`) for the confirm handler's
outbox row.

---

## Raised, not taken

### RST-01 · `duty_roster` overlap is an application check, not a constraint

**Found by** implementing API §3.2's `ROSTER_OVERLAP` (VR-19's sibling rule
for rosters, not itself a numbered VR). `scheduling.clinic_session` gets a
GiST `EXCLUDE` constraint (`ex_session_no_overlap`) specifically because a
check-then-insert race is real under concurrent booking-adjacent writes.
`scheduling.duty_roster` has no equivalent constraint in DATABASE.md's DDL —
overlap here can only be enforced by an application-level query
(same doctor + weekday + overlapping local time range + overlapping
effective-date range among active rows) before the insert.

**Not taken** because duty rosters are low-frequency staff data entry (one
Medical Center Staff member editing one doctor's weekly template), not a
high-concurrency path the way session creation is during a booking rush —
which is exactly the distinction DATABASE.md's own DDL already draws by
giving one table a GiST constraint and not the other. **Must be revisited**
if duty-roster editing ever becomes a bulk or concurrent operation (e.g. an
import tool provisioning many doctors' rosters at once).

---

### UQ-01 · `uq_user_role` blocks re-granting a revoked role

### UQ-01 · `uq_user_role` blocks re-granting a revoked role

**Found by** implementing API §1.4 `POST /users/{id}/roles`. DATABASE §8
defines `identity.user_role`'s uniqueness as
`CONSTRAINT uq_user_role UNIQUE (user_account_id, role_id)` — a plain
constraint over the pair, not scoped to active rows. P4 ("revoke, never
delete" — `revoked_at`, the row stays) implies an account should be able to
hold a role, lose it, and receive it again later (someone leaves MCS
reception and rejoins six months on); API §1.4's own `ROLE_ALREADY_HELD`
condition is explicitly "**active** grant exists," implying a revoked one
should not block a fresh grant.

As written, it does: a second `INSERT` for the same `(user_account_id,
role_id)` pair violates `uq_user_role` regardless of whether the earlier
row is revoked, because the constraint has no `WHERE revoked_at IS NULL`
clause to scope it to active rows only.

**Not taken** because no endpoint built in M1 exercises a regrant —
`grantRole` only needs to run once per pair here — and the fix (a partial
unique index) is a schema change with no way to verify it doesn't affect
some later milestone's assumption about this table without that milestone's
own context. `KyselyAccountAdminRepository.grantRole` catches the
`unique_violation` this would raise and reports `ROLE_ALREADY_HELD` rather
than a raw 500, which is honest about the *symptom* (this exact grant can't
be created) even though the *reason* differs from the documented condition
in the revoked-row case. **Must be resolved before any milestone needs
regrant to work** — replace the constraint with
`CREATE UNIQUE INDEX ... ON identity.user_role (user_account_id, role_id) WHERE revoked_at IS NULL`.

---

### API-01 · `isClinicalStaff` is a write-only field on the account wire shape

**Found by** building A-04 (FRONTEND §10.6, `RoleAssignmentDialog`). API §1.3's
own worked example for `GET /users/{id}` lists exactly nine fields and does
not include `isClinicalStaff`, even though `PATCH /users/{id}` accepts it as
a write. Followed exactly as documented in
`account-admin.routes.ts`'s `accountDetailDto` — the domain object still
carries it (VR-04's grant check needs the real value), only the wire DTO
omits it.

The consequence lands on A-04's own stated behaviour: *"`CNP` is disabled
unless the account is flagged clinical staff."* A web client has no field to
read that flag from, so it cannot compute the disabled state the spec
describes.

**Not taken** because adding the field to the response is an API.md change,
not a frontend workaround, and doing it silently would mean the shipped
client and the documented contract disagree without a record of why. The
Administrator console instead lets every assignable-role checkbox stay
enabled once a reason is entered, and a `CNP` grant on a non-clinical-staff
account is refused by the server's existing VR-04 check — the same
rejection A-04 always needed to handle for the race case, just handling the
common case too. **Should be resolved by adding `isClinicalStaff` to
`accountDetailDto`** so the checkbox can be genuinely pre-disabled rather
than only rejected after the attempt.

---

### RLS-01 · the request policy blocks student intake

**Where** `apps/counseling-api/migrations/003_grants_rls.sql`, applied
verbatim with the finding recorded inline.

`p_request_counselor_only` applies `FOR ALL` to the single application role
and requires an active clinical-roster member. A student submitting a request
(FR-CNS-07) connects as that same role with no `app.current_counselor` set,
so the `EXISTS` is false and the `INSERT` is refused — a student could not
create or read their own request.

**Not taken** because both candidate resolutions are DATABASE.md amendments
rather than implementation choices:

- **(a)** add a second policy admitting the owning student when
  `app.current_student` matches `counseling_request.student_ref_id` —
  preserves the defence-in-depth intent for intake;
- **(b)** drop RLS from `counseling_request`, keeping it on
  `counseling_case` and `case_note` where every reader is by definition a
  counsellor — simpler, and loses nothing the Clinical PEP does not already
  enforce.

**Must be resolved before M6 builds intake.** Nothing in M0.5 touches it, so
the schema is applied as approved in the meantime.

---

### DOC-01 · table counts in §5.1 and §5.2 are understated

The entity catalogue headings read "Core database — 31 tables" and
"Counseling database — 11 tables". The catalogues themselves list **35** and
**12** rows respectively, and the DDL creates exactly those numbers —
verified after migration.

The counseling figure appears to count only the `counseling` schema, omitting
`clinical_audit.counseling_access_log`. Cosmetic: the DDL is complete and
authoritative, and no code depends on the headings. Worth correcting in a
future revision of DATABASE.md so a reader auditing coverage is not misled.

---

## A note on method

DDL-01 and DDL-02 are the reason `ROADMAP.md` schedules integration testing
against real PostgreSQL from M0.5 rather than at M9. Neither is visible by
reading the DDL — both need the engine to execute a trigger chain. An
in-memory substitute or a mocked repository would have passed.
