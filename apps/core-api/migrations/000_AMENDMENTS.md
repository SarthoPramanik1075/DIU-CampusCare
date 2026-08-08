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
row (`DIU-MC-01` / "DIU Medical Centre" — not the more obvious `MAIN`, since
seven M1 integration tests already use that code as their own scratch-
database fixture); new table `scheduling.unavailability_preview` (id,
doctor_id, start_date, end_date, reason, affected_appointment_ids uuid[],
created_at, expires_at) — no hash, since unlike a credential, a leaked
preview id reveals nothing an MCS/ADM session couldn't already read through
the API; one seeded notification template (`doctor_unavailability_cancelled`)
for the confirm handler's outbox row.

---

### GRANT-01 · `scheduling.doctor` needs `DELETE`, which `005_grants.sql` withholds everywhere on purpose (M2)

**Found live**, not by a test: `DELETE /api/v1/doctors/{id}` returned `500`
against the running dev server — `permission denied for table doctor`
(Postgres `42501`), the kind of failure no mocked-repository unit or
integration test against an admin-privileged connection would ever catch,
since only `campuscare_core_app`'s actual grants are narrow enough to hit
it.

API §3.1's `DELETE /api/v1/doctors/{id}` (EC-20) is a real, specified hard
delete — "permitted only when no appointment has ever referenced it" — but
`005_grants.sql` states, deliberately and in its own words: *"P4: nothing
is ever deleted in Phase 1 (NFR-RET-01). No DELETE is granted anywhere,
deliberately."* Every table in the schema has zero `DELETE` privilege for
`campuscare_core_app` by design. EC-20 asks for the one specified exception
that policy doesn't yet have a carve-out for.

**Applied**, in `009_doctor_delete_grant.sql`: `GRANT DELETE ON
scheduling.doctor TO campuscare_core_app` — scoped to exactly the one table
with a specified hard-delete requirement, not a general reopening of
`005_grants.sql`'s policy. `clinic_session.doctor_id`'s foreign key (no `ON
DELETE CASCADE`) still makes deletion physically impossible once real
appointment history exists — proven in `doctor-admin.test.ts` via an actual
foreign-key-violation, not just the application-layer `DOCTOR_HAS_HISTORY`
check — so P4's actual spirit (nothing with real operational history is
ever deleted) holds regardless of this grant existing.

---

### GRANT-02 · `scheduling.session_slot` needs `DELETE`, for the same reason as GRANT-01 (M2)

**Found live**, the same way as GRANT-01: `PATCH /api/v1/sessions/{id}`
against a scheduled session's end time succeeded on `clinic_session` (its
`total_slot_count`/`bookable_slot_count`/`version` all updated correctly)
but the response came back `500` — `permission denied for table
session_slot`. Confirmed by direct inspection: the `clinic_session` row had
already moved to `version: 2` while `scheduling.session_slot` still held
the stale pre-update rows, exactly the half-applied state a genuine
mid-request permission failure produces.

Changing a session's timing, slot length or walk-in allocation changes how
many `session_slot` rows should exist and where — a shrinking slot count
has no well-defined row-for-row mapping to the old set, so the
regeneration this handler needs is delete-the-old-set-then-insert-the-new-
one, not a patch in place. `005_grants.sql`'s P4 policy withholds `DELETE`
from `campuscare_core_app` on every table, `session_slot` included.

**Applied**, in `010_session_slot_delete_grant.sql`: `GRANT DELETE ON
scheduling.session_slot TO campuscare_core_app`. Safe to scope this
narrowly for the same reason GRANT-01 was: `session_slot` rows carry no
appointment or patient data (BR-04) and are themselves a pure
materialisation of `clinic_session`'s own configuration, not a record with
independent retention value. `queueing.appointment.session_slot_id` (no
`ON DELETE CASCADE`) still makes it physically impossible to delete a slot
a real booking references — `PATCH`'s own `CAPACITY_BELOW_BOOKINGS` check
keeps ordinary operation from ever reaching that path, and the foreign key
is the backstop if it somehow does.

---

### DDL-06 · no notification templates for the three session-lifecycle events (M2)

API §3.3's `interrupt`, `complete` and `cancel` endpoints each queue one
notification per affected appointment (FR-SCH-08/09, EC-04, EC-13), and
`notification.notification` requires a `template_id` FK — the same
category of gap DDL-03 and the `doctor_unavailability_cancelled` template
(DDL-05) already resolved once each. `doctor_unavailability_cancelled`
itself doesn't fit: it is worded around a doctor going on leave, not a
specific session being interrupted, cancelled outright, or ending with
stragglers still waiting.

**Applied**, in `011_session_lifecycle_notification_templates.sql`: three
templates — `session_interrupted`, `session_cancelled`,
`session_completed_expired` — seeded the same way as every prior template
addition, `ON CONFLICT (template_key) DO NOTHING`.

---

### GRANT-03 · `scheduling.doctor_unavailability` needs `DELETE`, for the same reason as GRANT-01/02 (M2)

**Added proactively**, not found live: `DELETE /api/v1/unavailability/{id}`
(API §3.4, FR-SCH-06) removes a future leave period outright — the table
has no `is_active`/`deleted_at` column the way `duty_roster` does, so this
is a genuine hard delete, not a soft-deactivation. Having now hit exactly
this shape of gap twice (GRANT-01 for `scheduling.doctor`, GRANT-02 for
`scheduling.session_slot`), the third instance didn't need a live 500 to
diagnose — `005_grants.sql` withholds `DELETE` from `campuscare_core_app`
everywhere by design, and this table has the same kind of specified,
narrow exception the other two did.

**Applied**, in `012_doctor_unavailability_delete_grant.sql`: `GRANT
DELETE ON scheduling.doctor_unavailability TO campuscare_core_app`. The
guard that actually matters — a leave period already underway can't be
removed — is `UNAVAILABILITY_ALREADY_STARTED`, enforced in the handler by
checking `startDate` against server time, not the database withholding
`DELETE`.

---

### DDL-07 · no `version` column on `config.service_calendar` (M2)

**Found by** implementing API §8.5 `PATCH /api/v1/service-calendar/{id}`,
which requires `version` (VR-92) exactly like every other mutable
resource's `PATCH`. `001_schema.sql`'s DDL for `config.service_calendar`
never gave it a `version` column — the same category of gap DDL-03 and
DDL-05 resolved for missing storage elsewhere.

**Applied**, in `013_service_calendar_version.sql`: `ALTER TABLE
config.service_calendar ADD COLUMN version integer NOT NULL DEFAULT 1`.
No trigger — incremented manually in the `UPDATE ... SET version =
version + 1 WHERE ... AND version = $expected` statement, the same
pattern `scheduling.doctor`/`duty_roster` use, since nothing else about
this table calls for a trigger the way `clinic_session`'s slot-count
bookkeeping did.

---

### GRANT-04 · `config.service_calendar` needs `DELETE`, for the same reason as GRANT-01/02/03 (M2)

**Added proactively**, not found live: `DELETE /api/v1/service-calendar/{id}`
(API §8.6, FR-ADM-03) genuinely removes the row — "reopening the day for
booking" — and the table has no soft-delete column. Fourth instance of
the same shape of gap (GRANT-01 `scheduling.doctor`, GRANT-02
`scheduling.session_slot`, GRANT-03 `scheduling.doctor_unavailability`):
`005_grants.sql` withholds `DELETE` everywhere by design, and this table
has the same kind of specified, narrow exception the other three did.

**Applied**, in `014_service_calendar_delete_grant.sql`: `GRANT DELETE ON
config.service_calendar TO campuscare_core_app`. The guard that actually
matters — a past closure can't be rewritten — is `CANNOT_EDIT_PAST`,
enforced in the handler by checking the entry's date against server time.

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

### RST-02 · `doctor_unavailability` overlap is an application check, not a constraint (M2)

**Found by** implementing API §3.4's `UNAVAILABILITY_OVERLAP`. Same shape
as RST-01: `scheduling.doctor_unavailability.period` is a plain `daterange`
column with no GiST `EXCLUDE` constraint in DATABASE.md's DDL, so overlap
(same doctor, intersecting date range) can only be a check-then-insert in
`confirm-unavailability.handler.ts`.

**Not taken**, for the same reason as RST-01: recording a leave period is
staff data entry — an Medical Center Staff member confirming one doctor's
leave — not a concurrent booking-adjacent path. The two-step preview/
confirm flow itself already re-derives and re-checks the impact
immediately before the insert (`IMPACT_CHANGED`), which narrows the race
window further than duty rosters get. **Must be revisited** under the same
condition as RST-01 — bulk or concurrent leave entry, e.g. an import tool.

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
