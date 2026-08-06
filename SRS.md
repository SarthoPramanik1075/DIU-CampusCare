# Software Requirements Specification
## DIU CampusCare — Smart Medical & Counseling Management System

**Document ID:** DIU-CC-SRS-001
**Version:** 1.0
**Date:** 3 August 2026
**Release specified:** Phase 1 (MVP) only
**Standard:** IEEE 830-1998 / ISO-IEC-IEEE 29148:2018 structure
**Status:** Draft for review
**Source of truth:** `PROJECT_PLANNING.md` v1.0 (approved)

**Scope note:** This document specifies *what* the system must do. It contains no database design, no API design, no architecture, no user-interface design. Where a requirement constrains an interface, it does so at the level of observable behaviour, not implementation.

---

# Table of Contents

**1. Introduction** — Purpose, Scope, Definitions, References, ID conventions
**2. Overall Description** — Product perspective, functions, user classes, environment, **Constraints (§2.5)**, **Assumptions (§2.6)**
**3. Specific Requirements** — External interfaces, **Functional Requirements (§3.2)**, **Business Rules (§3.3)**, **Validation Rules (§3.4)**, **System Permissions (§3.5)**, **Edge Cases (§3.6)**, **Non-Functional Requirements (§3.7)**
**4. User Stories & Acceptance Criteria**
**5. Requirement Traceability**
**6. Open Items Register**
**Appendix A** — Deferred requirements (Phase 2/3)
**Appendix B** — Deviations from the planning document

---

# 1. Introduction

## 1.1 Purpose

This SRS defines the complete, verifiable requirements for **Phase 1 (MVP)** of DIU CampusCare, a role-based web platform unifying student access to Daffodil International University's Medical Center, its medicine store, and its counseling/psychiatric service.

**Intended audience:**

| Audience | Use of this document |
|---|---|
| Development team | Basis for design, implementation, and unit/integration testing |
| QA | Basis for test case derivation; every AC in §4 is a test |
| Medical Center, Store, Counseling service | Verification that requirements reflect real operations |
| DIU IT | Identity, security, hosting, and support obligations |
| Project sponsor / academic supervisor | Scope agreement and acceptance basis |

**This document is the acceptance baseline.** Phase 1 is complete when every requirement marked **C** or **H** is implemented and every acceptance criterion in §4 passes.

## 1.2 Scope

### 1.2.1 Product identification

**DIU CampusCare** — a responsive web application (PWA) providing:

1. **Medical Service** — doctor availability, remote appointment booking with digital serial, live queue position, unified booked-and-walk-in queue management, consultation fee status.
2. **Medicine Service** — student-facing medicine availability lookup, store open/closed status, and operator-side batch inventory management.
3. **Counseling Service** — counseling request intake with a mandatory crisis-safety layer, counselor-controlled triage and prioritisation, session scheduling, and confidential case records.

### 1.2.2 In scope for Phase 1

All items listed in `PROJECT_PLANNING.md` §22.2 "In the MVP".

### 1.2.3 Out of scope for Phase 1

Online payment; digital prescriptions and prescription-linked dispensing; reserve-for-pickup; alternatives suggestion; expiry alerting/quarantine/write-off *workflow* (data capture is in scope — see Appendix B, D-2); doctor self-service console; clinical notes; counseling follow-up chains and case reassignment; SMS; web push; reporting dashboards (manual export only); native apps; telemedicine; two-factor authentication; anonymous enquiry; Bangla localisation.

Permanently out of scope (all phases): full EMR, clinical decision support, symptom triage, ambulance dispatch, insurance/claims, guardian access.

### 1.2.4 Benefits

Per `PROJECT_PLANNING.md` §6: ≥60% of consultations originating online, ≥40% reduction in median wait, ≥50% increase in store utilisation, 100% counseling request acknowledgement, zero confidentiality incidents.

## 1.3 Definitions, Acronyms and Abbreviations

| Term | Definition |
|---|---|
| **Appointment** | A student's reserved place in a doctor's session, identified by an Appointment ID and a Serial Number |
| **Serial Number** | The ordinal position of a patient within a single doctor session; the authoritative ordering mechanism |
| **Session** | A continuous block of duty time for one doctor on one date (e.g. Dr. A, 10 Aug, 09:00–13:00) |
| **Slot** | A bookable subdivision of a session, of configured length |
| **Estimated Time** | A continuously recalculated, non-binding prediction of when a patient will be seen |
| **Queue Position** | The number of patients ahead of a given patient in the live queue |
| **Walk-in** | A patient who arrives without a prior booking and is inserted into the live queue by staff |
| **Walk-in Allocation** | The configured percentage of session capacity reserved for walk-ins and emergencies, not bookable online |
| **Check-in** | Staff confirmation that a booked student has physically arrived |
| **No-show** | A booked student who did not check in within the grace period |
| **Expired (appointment)** | A booking that lapsed because the session never ran; distinct from No-show |
| **Status Band** | The student-visible medicine availability value: Available / Low Stock / Out of Stock |
| **Freshness Stamp** | The "as of HH:MM" timestamp accompanying every availability display |
| **Batch** | A quantity of one medicine sharing a single expiry date |
| **FEFO** | First-Expiry-First-Out; the rule that the earliest-expiring batch is dispensed first |
| **OTC** | Over-the-counter; a medicine dispensable without a prescription |
| **Triage** | Counselor review of a request to determine final priority |
| **Counseling Professional** | A user holding the designated counselor/psychiatrist role; the only role permitted to read counseling case content |
| **Crisis Layer** | The mandatory set of safety features: crisis banner, non-monitoring notice, high-urgency interstitial |
| **Break-glass** | Emergency administrator access to restricted data, requiring justification, logging, and notification |
| **Discreet Content** | Notification wording that omits service name, diagnosis, and provider specialisation |
| **Working Day** | Sunday–Thursday, excluding DIU-declared holidays *(see OI-11)* |
| **Service Hours** | 08:00–18:00 Bangladesh Standard Time (UTC+06), Sunday–Thursday |
| **PWA** | Progressive Web Application |
| **SSO** | Single Sign-On |
| **SLA** | Service Level Agreement |
| **BST** | Bangladesh Standard Time (UTC+06) |

## 1.4 References

| Ref | Document |
|---|---|
| [R1] | `PROJECT_PLANNING.md` v1.0 — DIU CampusCare Project Planning Document (approved 3 Aug 2026) |
| [R2] | Project Story document — DIU CampusCare (product owner, original source) |
| [R3] | **DIU-CP-01** — DIU Counseling Service Crisis & Escalation Protocol — **DOES NOT YET EXIST; hard dependency, see OI-01** |
| [R4] | **DIU-DR-01** — DIU Health Data Retention & Disposal Policy — **DOES NOT YET EXIST; see OI-02** |
| [R5] | WCAG 2.1 Level AA |
| [R6] | IEEE 830-1998 / ISO-IEC-IEEE 29148:2018 |

## 1.5 Overview

§2 gives the overall product context, user classes, and the constraints and assumptions under which requirements were written. §3 contains the specific requirements: functional, business rules, validation, permissions, edge cases, and non-functional. §4 expresses the requirements as user stories with testable acceptance criteria. §5 provides traceability. §6 registers every assumed value awaiting DIU confirmation.

## 1.6 Requirement Identification & Priority Conventions

### 1.6.1 Identifier scheme

| Prefix | Meaning | Example |
|---|---|---|
| `FR-<MOD>-nn` | Functional requirement | FR-APT-13 |
| `NFR-<CAT>-nn` | Non-functional requirement | NFR-PERF-03 |
| `BR-nn` | Business rule — **numbers are inherited from [R1] §14 unchanged**; new rules start at BR-65 | BR-49 |
| `VR-nn` | Validation rule | VR-12 |
| `EC-nn` | Edge case / exception requirement | EC-07 |
| `PRM-nn` | Permission requirement | PRM-04 |
| `US-nn` | User story | US-21 |
| `AC-nn.n` | Acceptance criterion | AC-21.3 |
| `OI-nn` | Open item awaiting DIU decision | OI-01 |

Modules: **AUTH**, **DASH**, **SCH** (schedules), **APT** (appointments/queue), **PAY** (fees), **MED** (medicine), **CNS** (counseling intake), **CSE** (counseling case), **NTF** (notifications), **ADM** (admin), **AUD** (audit).

### 1.6.2 Priority scheme

| Code | Meaning | Consequence of omission |
|---|---|---|
| **C** | **Critical** — safety, legal, privacy, or data-integrity requirement | Must not ship. Ethical or institutional exposure |
| **H** | **High** — MVP core function | Phase 1 objectives not met |
| **M** | **Medium** — MVP, but the system degrades gracefully without it | Reduced quality; acceptable as a short-term gap |

### 1.6.3 Assumption tagging

Requirements derived from a value the planning document recommended but DIU has not yet confirmed carry the marker **【A】** and a cross-reference to §6. Example: *"…default 30% 【A: OI-06】"*.

**All 【A】 values are implemented as configuration, not as constants**, so that a DIU decision changes a setting rather than the code. This is a requirement in itself — see FR-ADM-01.

---

# 2. Overall Description

## 2.1 Product Perspective

DIU CampusCare is a **new, self-contained system**. It replaces three independent manual processes:

| Replaced process | Current mechanism | Replaced by |
|---|---|---|
| Serial issuance at the Medical Center counter | Paper register | Digital appointment + serial + unified queue |
| Medicine stock knowledge | Operator memory + manual register | Batch inventory with student-visible status bands |
| Counseling request handling | Email threads | Structured intake, triage, and confidential case records |

**External dependencies:**

| Dependency | Nature | Criticality |
|---|---|---|
| DIU institutional identity (SSO) | Student and staff authentication | **Blocking** — see OI-03 |
| DIU email infrastructure | Notification delivery | High |
| DIU network at Medical Center counter and store | Operator access | High — see NFR-REL-04 |
| DIU-CP-01 Crisis Protocol [R3] | Counseling escalation content | **Blocking for counseling module** — OI-01 |

**System interfaces in Phase 1:** identity provider and outbound email only. No payment gateway, no SIS integration beyond identity, no SMS gateway.

## 2.2 Product Functions (summary)

| # | Function | Requirements |
|---|---|---|
| PF-1 | Authenticate users and enforce role-based, service-isolated access | FR-AUTH-* , §3.5 |
| PF-2 | Present each student a unified dashboard across three services | FR-DASH-* |
| PF-3 | Publish authoritative doctor schedules, handle overrides, holidays and leave | FR-SCH-* |
| PF-4 | Accept remote appointment bookings and issue digital serials | FR-APT-01…08 |
| PF-5 | Maintain a single live queue of booked and walk-in patients with dynamic estimates | FR-APT-09…30 |
| PF-6 | Record consultation fee status and produce daily collection summaries | FR-PAY-* |
| PF-7 | Maintain a medicine catalogue and batch-level inventory | FR-MED-10…24 |
| PF-8 | Expose medicine availability as status bands with freshness stamps | FR-MED-01…09 |
| PF-9 | Accept counseling requests behind a mandatory crisis-safety layer | FR-CNS-* |
| PF-10 | Support counselor-controlled triage, scheduling and confidential case records | FR-CSE-* |
| PF-11 | Deliver in-app and email notifications under a discreet content policy | FR-NTF-* |
| PF-12 | Provide administrative configuration and account management | FR-ADM-* |
| PF-13 | Record an append-only audit trail of all state changes and sensitive-data access | FR-AUD-* |

## 2.3 User Classes and Characteristics

| Class | Population | Frequency | Technical skill | Key characteristics | Persona [R1] §9 |
|---|---|---|---|---|---|
| **Anonymous visitor** | Unbounded | Occasional | Any | Can view public availability only; no personal data | — |
| **Student** | ~all enrolled DIU students | Occasional (a few times/semester) to weekly | Low–medium | Mid-range Android, mobile data, often weak signal. Will not install a native app. Abandons slow pages | Rahim, Nusrat, Tanvir |
| **Medical Center Staff** | 1–3 | Continuous during service hours | Low | **Highest operational influence.** Desktop at counter. Under time pressure during rush. Will revert to paper if slower | Shirin |
| **Doctor** | 3–8 | Per session | Low, low tolerance for software | **Phase 1 requires no doctor login.** May consult a read-only display | Dr. Ahsan |
| **Store Operator** | 1 | Continuous during store hours | Low–medium | Sole custodian of inventory accuracy. High data-entry load | Karim |
| **Counseling Professional** | 1–4 | Daily | Medium | Ethically bound to confidentiality; holds professional veto over the module | Dr. Farhana |
| **System Administrator** | 1–2 | Weekly | High | DIU IT, part-time. **Explicitly denied counseling content access** | Sabbir |

**Critical characteristic (drives NFR-USE-01 and NFR-PERF-04):** Medical Center Staff operate under time pressure with a physical queue in front of them. Any interaction slower than the paper equivalent causes abandonment of the system. This is recorded in [R1] as risk R3 (probability High, impact Critical).

## 2.4 Operating Environment

| Aspect | Requirement |
|---|---|
| Client — students | Mobile web browsers on Android 8+ / iOS 13+; Chrome, Firefox, Safari, Edge — current and previous major version |
| Client — staff/operator/counselor | Desktop browsers, minimum viewport 1280×720; same browser support |
| Client — public display | Browser in full-screen kiosk mode, minimum 1280×720 |
| Network — students | Mobile data, 3G baseline (see NFR-PERF-02) |
| Network — staff | Campus LAN/Wi-Fi, subject to intermittent loss (see NFR-REL-04) |
| Delivery model | Responsive PWA; single codebase; no native application |
| Timezone | All times displayed and stored relative to Bangladesh Standard Time (UTC+06). No multi-timezone support |
| Locale | English (Phase 1). Bangla deferred — see OI-13 |
| Deployment | DIU-managed hosting; single logical deployment; single Medical Center 【A: OI-04】 |

## 2.5 Design and Implementation Constraints

Constraints are inherited from [R1] §15. Each is restated as a binding constraint on Phase 1, with the requirement(s) that respond to it.

| ID | Constraint | Responding requirements |
|---|---|---|
| **CON-01** | **Organisational readiness.** Staff must change daily working habits. Adoption, not technology, is the primary risk | NFR-USE-01, NFR-USE-02, FR-APT-13, §4 US-24…US-30 |
| **CON-02** | **Doctors will not accept added administrative burden.** No Phase 1 function may depend on a doctor logging in | FR-SCH-02 (staff-maintained), FR-APT-15, FR-APT-30 |
| **CON-03** | **Inventory accuracy depends entirely on one operator.** Stale data makes the student feature actively harmful | FR-MED-04, FR-MED-14, NFR-USE-03 |
| **CON-04** | **Counseling confidentiality is an ethical and possibly regulatory obligation.** It constrains the permission model and all reporting | §3.5, BR-49…BR-55, FR-AUD-04, NFR-SEC-06 |
| **CON-05** | **Identity depends on DIU IT.** SSO availability is not guaranteed | FR-AUTH-01, FR-AUTH-02, OI-03 |
| **CON-06** | **Student devices are mid-to-low-end on mobile data.** Tight performance budget | NFR-PERF-01…04, NFR-COMP-01 |
| **CON-07** | **Campus connectivity at the counter can drop.** The queue must survive a network loss | NFR-REL-04, FR-APT-29, EC-18 |
| **CON-08** | **Budget is minimal.** No paid SMS at volume, no licensed components, no paid third-party services in Phase 1 | FR-NTF-02 (email only), §1.2.3 |
| **CON-09** | **No baseline data exists.** Success cannot otherwise be evidenced | FR-ADM-08 (export), and a non-software prerequisite in [R1] §24 M0 |
| **CON-10** | **Fixed delivery timeline** (academic calendar). Scope must fit the calendar | Phase 1 boundary in §1.2 is contractual |
| **CON-11** | **Small, part-time team.** Sequential module delivery | Milestone sequence in [R1] §24 |
| **CON-12** | **Evolving Bangladesh personal data protection regime.** Compliance target may shift | NFR-SEC-*, NFR-PRIV-*, designed to least-privilege + audit + consent + retention baseline |
| **CON-13** | **Single Medical Center assumed.** Multi-center would materially change scheduling, inventory and queue scoping | OI-04 — must be confirmed before FR-SCH-* is built |
| **CON-14** | **Cash-based fee collection.** Reconciliation remains manual in Phase 1 | FR-PAY-03, FR-PAY-05, BR-34 |
| **CON-15** | **The system must never present itself as an emergency service.** Positioning constraint on all counseling and medical copy | FR-CNS-03…06, BR-47, BR-48, NFR-PRIV-05 |

## 2.6 Assumptions and Dependencies

Inherited from [R1] §16, with the consequence of falsification stated. Assumptions marked **⚠ Blocking** must be resolved before the affected module is built.

| ID | Assumption | If false | Blocking? |
|---|---|---|---|
| **ASM-01** | DIU operates one Medical Center relevant to this system | Multi-center scheduling and per-center inventory enter Phase 1 scope | ⚠ Blocking for FR-SCH-*, FR-MED-* |
| **ASM-02** | The counseling service is organisationally separate from the Medical Center but serves the same students | Permission model and reporting lines change | No |
| **ASM-03** | Students have a university-issued identity usable for authentication | Account provisioning becomes a separate workstream; FR-AUTH-01 changes | ⚠ Blocking for FR-AUTH-* |
| **ASM-04** | Only students are in scope; faculty and staff use other arrangements | Eligibility rules and possibly fee rules expand | No |
| **ASM-05** | The consultation fee is a flat 50 BDT per visit | FR-PAY-01 must support tiers, specialisation-based fees | No — configuration absorbs it |
| **ASM-06** | Medicines are dispensed free or at nominal cost to students | A pricing and billing layer enters the medicine module | No — but re-plan |
| **ASM-07** | Doctor duty schedules are broadly stable week to week | The schedule engine must become substantially more dynamic | No |
| **ASM-08** | An existing medicine list can seed the catalogue | Initial catalogue entry becomes a major manual data-migration task | No — but see [R1] risk R17 |
| **ASM-09** | The counseling service has or will author a documented crisis/escalation protocol [R3] | **The counseling module cannot safely launch** | ⚠ **Blocking for FR-CNS-*, FR-CSE-*** |
| **ASM-10** | Counselors are willing to move casework into a shared system | The counseling module has no users; re-plan to intake-only | ⚠ Blocking for FR-CSE-* |
| **ASM-11** | Reliable internet exists at the counter and the store | Offline capability moves from mitigation to full requirement | No — NFR-REL-04 partially covers |
| **ASM-12** | Email reaches students reliably and is checked | Notification strategy must shift to SMS; CON-08 conflicts | No |
| **ASM-13** | Doctor-hours are broadly sufficient for demand | Pure slot booking is the wrong model; hybrid/lottery required | ⚠ Blocking — must be measured before FR-APT-01 design |
| **ASM-14** | DIU will nominate a service owner responsible post-launch | System decays after handover | No (organisational) |
| **ASM-15** | An English-only interface is acceptable in Phase 1 | Bangla localisation enters Phase 1, affecting every screen | No — OI-13 |
| **ASM-16** | This is a university-internal system, not a commercial product | Licensing, SLA and support obligations change | No |
| **ASM-17** | Students carry a verifiable student ID card presentable at check-in | Identity verification at the counter (BR-65) is unenforceable | No |
| **ASM-18** | The Medical Center will retain a paper fallback during the pilot | A network outage halts service entirely | No (organisational; see [R1] SI-13) |

---

# 3. Specific Requirements

## 3.1 External Interface Requirements

*Stated at requirement level only. No interface design is specified.*

### 3.1.1 User interfaces

| ID | Requirement | Pri |
|---|---|---|
| FR-UI-01 | The system shall present a responsive web interface functional at viewport widths from 320 px upward without horizontal scrolling | H |
| FR-UI-02 | The system shall present a distinct interface context per role, exposing only the functions permitted to that role (§3.5) | C |
| FR-UI-03 | The system shall present all dates in `DD MMM YYYY` and all times in 12-hour format with meridiem, in BST | M |
| FR-UI-04 | The system shall provide a read-only, login-free public queue display view suitable for a wall-mounted screen, showing the current serial being seen per doctor and no patient identities | H |
| FR-UI-05 | The system shall render all student-facing availability information without requiring authentication (FR-DASH-07) | H |

### 3.1.2 Hardware interfaces
None. The system requires no dedicated hardware beyond standard client devices and an optional display screen.

### 3.1.3 Software interfaces

| ID | Requirement | Pri |
|---|---|---|
| FR-SI-01 | The system shall authenticate users against the DIU institutional identity provider where available 【A: OI-03】 | C |
| FR-SI-02 | The system shall dispatch outbound email through DIU-provided email infrastructure | H |
| FR-SI-03 | The system shall function with no other external service dependency in Phase 1 | H |

### 3.1.4 Communications interfaces

| ID | Requirement | Pri |
|---|---|---|
| FR-CI-01 | All client–server communication shall occur over HTTPS with TLS 1.2 or higher | C |
| FR-CI-02 | The system shall support live queue updates with a maximum data staleness of 30 seconds (NFR-PERF-05) | H |

---

## 3.2 Functional Requirements

### 3.2.1 Module AUTH — Authentication, Identity & Role Management

| ID | Requirement | Pri | Source |
|---|---|---|---|
| FR-AUTH-01 | The system shall authenticate students using DIU institutional identity (SSO). Where SSO is unavailable, the system shall authenticate using a verified university email address and password 【A: OI-03】 | C | F-AUTH-01 |
| FR-AUTH-02 | The system shall authenticate provider and administrator accounts using credentials issued by a System Administrator. Self-registration shall not be available for any non-student role | C | F-AUTH-02, BR-05 |
| FR-AUTH-03 | The system shall support the assignment of one or more roles to a single user account | H | F-AUTH-03, BR-03 |
| FR-AUTH-04 | The system shall compute an authenticated user's effective permissions as the union of their assigned roles, **except** that access to counseling case content shall require the explicit Counseling Professional designation and shall never be granted by union with another role | C | F-AUTH-03, BR-03 |
| FR-AUTH-05 | The system shall enforce the permission matrix of §3.5 on every operation, at the point of execution, independently of what the interface presents | C | F-AUTH-04 |
| FR-AUTH-06 | The system shall terminate an inactive session after 30 minutes for students and 15 minutes for Counseling Professionals and Administrators 【A: OI-14】 | C | F-AUTH-05 |
| FR-AUTH-07 | The system shall provide an explicit logout function that terminates the session immediately on all roles | H | F-AUTH-05 |
| FR-AUTH-08 | The system shall provide a password reset mechanism for password-authenticated accounts, delivering a single-use, time-limited reset link to the account's registered university email | H | F-AUTH-06 |
| FR-AUTH-09 | The system shall permit login only to accounts in `Active` status | C | F-AUTH-07, BR-01 |
| FR-AUTH-10 | The system shall support account lifecycle states `Pending`, `Active`, `Suspended`, `Deactivated`, and shall allow an Administrator to transition between them | H | F-AUTH-07, BR-06 |
| FR-AUTH-11 | The system shall retain all historical records belonging to a Deactivated account and shall render them inaccessible to that account | C | BR-06 |
| FR-AUTH-12 | The system shall provide an Administrator console for creating, viewing, editing, suspending and deactivating user accounts and for assigning roles | H | F-AUTH-08 |
| FR-AUTH-13 | The system shall record every login attempt (success and failure) with account identifier, outcome, timestamp and source address | C | NFR-SEC-05 |
| FR-AUTH-14 | The system shall lock an account for 15 minutes after 5 consecutive failed authentication attempts and shall notify the account holder by email 【A: OI-14】 | C | NFR-SEC-04 |
| FR-AUTH-15 | The system shall prevent a user from performing any action on behalf of another user. No proxy or delegated booking shall be available in Phase 1 | C | BR-02 |

### 3.2.2 Module DASH — Student Health Dashboard

| ID | Requirement | Pri | Source |
|---|---|---|---|
| FR-DASH-01 | The system shall present authenticated students a dashboard containing three service entry points: Medical, Medicine, Counseling | H | F-DASH-01 |
| FR-DASH-02 | The dashboard shall display the student's upcoming appointments with current status, serial number and current estimated time | H | F-DASH-02 |
| FR-DASH-03 | The dashboard shall display, for the current date: doctors on duty with their duty times, medicine store open/closed status, and the status of the student's own counseling requests | H | F-DASH-05 |
| FR-DASH-04 | The dashboard shall display a notification centre showing the student's unread and recent notifications | H | F-DASH-04 |
| FR-DASH-05 | The system shall display the student's counseling request status **only to that student**, and shall not display counseling information on any shared or public view | C | BR-50, BR-63 |
| FR-DASH-06 | The system shall provide a public, unauthenticated view showing, for the current and next 7 days: doctors on duty, their duty times and current availability state, and medicine store open/closed status with hours | H | F-DASH-07 |
| FR-DASH-07 | The public view shall not expose any patient identity, any appointment detail, any counseling information, or any exact medicine quantity | C | BR-04, BR-35, BR-50 |
| FR-DASH-08 | The dashboard shall display any active system announcement published by an Administrator | M | F-ADM-03 |

### 3.2.3 Module SCH — Doctor & Schedule Management

| ID | Requirement | Pri | Source |
|---|---|---|---|
| FR-SCH-01 | The system shall allow Medical Center Staff to create and maintain doctor profiles comprising name, designation, specialisation and optional photograph | H | F-SCH-01 |
| FR-SCH-02 | The system shall allow Medical Center Staff to define a recurring weekly duty roster per doctor, specifying weekday, start time and end time | H | F-SCH-02 |
| FR-SCH-03 | The system shall allow Medical Center Staff to create date-specific overrides that add, remove or modify a session on a given date, taking precedence over the recurring roster | H | F-SCH-03 |
| FR-SCH-04 | The system shall allow configuration, per session, of: slot length in minutes (default 10 【A: OI-05】), maximum session capacity, and walk-in allocation percentage (default 30% 【A: OI-06】) | H | F-SCH-04, BR-16 |
| FR-SCH-05 | The system shall derive bookable slots from a session's start time, end time and slot length, and shall make bookable only that number of slots corresponding to (100% − walk-in allocation) of session capacity | H | F-SCH-04, BR-16 |
| FR-SCH-06 | The system shall allow Medical Center Staff to mark a doctor unavailable for a date range, with a reason | H | F-SCH-05 |
| FR-SCH-07 | On submission of an unavailability that affects existing bookings, the system shall present a list of every affected booking before committing, and shall require explicit confirmation | C | F-SCH-06, BR-26 |
| FR-SCH-08 | On confirmation of FR-SCH-07, the system shall cancel every affected booking with reason `Doctor Unavailable`, notify every affected student, and present each student with remaining alternative availability | C | F-SCH-06, BR-26, BR-27 |
| FR-SCH-09 | The system shall dispatch the notifications required by FR-SCH-08 within 5 minutes of confirmation, through every channel the student has enabled | C | BR-27 |
| FR-SCH-10 | The system shall allow an Administrator to maintain a calendar of non-service days, including weekly holidays, public holidays, and university closure periods | H | F-SCH-07, F-ADM-02 |
| FR-SCH-11 | The system shall block all booking on a non-service day and shall display the reason for the closure | H | F-SCH-07, BR-28 |
| FR-SCH-12 | The system shall allow configuration of a schedule publication window controlling how far ahead students may view and book; default 7 days 【A: OI-07】 | H | F-SCH-08, BR-10 |
| FR-SCH-13 | The system shall treat the published schedule as the sole source of truth; no appointment shall be creatable outside a published session | C | BR-25 |
| FR-SCH-14 | The system shall require a stated reason for any schedule change taking effect within 24 hours, and shall record it in the audit trail | H | BR-29 |
| FR-SCH-15 | The system shall record every schedule creation, modification and deletion in an append-only audit log with actor, timestamp, previous value and new value | C | F-SCH-10, BR-60 |
| FR-SCH-16 | The system shall not permit two sessions for the same doctor to overlap in time | H | VR-19 |

### 3.2.4 Module APT — Appointment & Queue Management

#### Booking

| ID | Requirement | Pri | Source |
|---|---|---|---|
| FR-APT-01 | The system shall allow an authenticated student to browse doctors, dates and available slots within the publication window | H | F-APT-01 |
| FR-APT-02 | For each session the system shall display the number of slots already booked and the number remaining, without revealing any patient identity | H | F-APT-01, BR-04 |
| FR-APT-03 | The system shall allow a student to book one available slot, generating a unique Appointment ID and a Serial Number | H | F-APT-02 |
| FR-APT-04 | The Appointment ID shall be human-readable and unique across the system, of the form `MED-<YYYY>-<sequence>` | M | [R2] §2 |
| FR-APT-05 | The Serial Number shall be unique within a session and shall be assigned in ascending order of queue position, commencing at 1 | H | BR-18, EC-09 |
| FR-APT-06 | The system shall allow a student to record an optional structured reason-for-visit from a configurable category list at time of booking | M | F-APT-17, [R1] SI-15 |
| FR-APT-07 | On successful booking, the system shall display and notify: Appointment ID, Serial Number, doctor, date, estimated time, and an explicit statement that the time is an estimate and not a guarantee | C | F-APT-03, BR-19 |
| FR-APT-08 | The system shall not present, in any interface or notification, a booked time as a guaranteed or confirmed appointment time. The words used shall convey estimation | C | BR-19, [R1] §5.2 |
| FR-APT-09 | The system shall prevent a student from holding more than 2 active bookings simultaneously 【A: OI-08】 | H | F-APT-16, BR-11 |
| FR-APT-10 | The system shall prevent a student from holding more than 1 active booking with the same doctor on the same date | H | BR-11 |
| FR-APT-11 | The system shall close booking for a slot at the configured cutoff before the session start; default: at session start 【A: OI-09】 | H | BR-10 |
| FR-APT-12 | The system shall suspend a student's online booking capability for 14 days after 3 No-show records within a rolling 30-day period 【A: OI-10】 | H | F-APT-16, BR-15 |
| FR-APT-13 | A booking suspension under FR-APT-12 shall never prevent the student from being registered as a walk-in or receiving care | C | BR-15 |
| FR-APT-14 | The system shall notify a student when a booking suspension is applied, stating the reason, the duration and that walk-in access remains available | H | BR-15 |

#### Cancellation

| ID | Requirement | Pri | Source |
|---|---|---|---|
| FR-APT-15 | The system shall allow a student to cancel an active booking at any time before its estimated time | H | F-APT-04 |
| FR-APT-16 | The system shall classify a cancellation made 2 or more hours before the estimated time as `Cancelled` and one made later as `Late Cancellation` 【A: OI-09】 | M | BR-12 |
| FR-APT-17 | The system shall release a cancelled slot for rebooking immediately upon cancellation | H | BR-21 |
| FR-APT-18 | The system shall not apply the No-show penalty of FR-APT-12 to any cancellation | H | BR-12, BR-15 |

#### Live queue and estimation

| ID | Requirement | Pri | Source |
|---|---|---|---|
| FR-APT-19 | The system shall maintain, per session, a single ordered live queue containing both booked and walk-in patients | C | F-APT-09, F-APT-13, BR-18 |
| FR-APT-20 | The system shall display to each student with an active booking or check-in: their serial number, their current queue position expressed as the number of patients ahead, and a current estimated time | H | F-APT-06 |
| FR-APT-21 | The system shall recalculate the estimated time for every waiting patient whenever any of the following occurs: a consultation completes, a walk-in is inserted, an emergency is inserted, a patient is marked No-show, or a booking is cancelled | H | F-APT-06, [R1] §19 Q1 |
| FR-APT-22 | The estimate shall be computed from the rolling mean consultation duration of the current session; where fewer than 3 consultations have completed, the system shall use the doctor's trailing 30-day mean; where neither is available, the configured slot length. The result shall not be less than the configured slot length 【A: OI-05】 | H | [R1] §19 Q1 |
| FR-APT-23 | The system shall notify a student when the number of patients ahead of them reaches 2, with an estimate of the remaining wait | H | F-APT-07 |
| FR-APT-24 | The system shall notify a student when their estimated time moves later by more than 30 minutes relative to the estimate given at booking, and again on each subsequent 30-minute cumulative slip 【A: OI-09】 | H | F-APT-08, BR-20 |
| FR-APT-25 | The system shall record actual consultation start and end times for every completed consultation, for use by FR-APT-22 and NFR-ACC-01 | H | [R1] SI-19 |

#### Staff queue console

| ID | Requirement | Pri | Source |
|---|---|---|---|
| FR-APT-26 | The system shall provide Medical Center Staff a console displaying, on one screen, every session for the current date across all doctors, each with its ordered live queue | C | F-APT-09 |
| FR-APT-27 | The console shall allow staff to check in an arriving booked student, transitioning the appointment from `Booked` to `Checked In` | C | F-APT-10 |
| FR-APT-28 | The system shall support the appointment status lifecycle: `Booked` → `Checked In` → `Waiting` → `In Consultation` → `Completed`, and the terminal exception states `Cancelled`, `Late Cancellation`, `No-show`, `Expired` | C | F-APT-11, F-APT-12 |
| FR-APT-29 | The console shall allow staff to advance a patient's status with a single interaction per transition | H | NFR-USE-01 |
| FR-APT-30 | The system shall display, per session, the serial currently `In Consultation` and shall expose this on the public queue display (FR-UI-04) | H | F-APT-15 |
| FR-APT-31 | The console shall allow staff to mark a booked patient `No-show` after the configured grace period of 20 minutes from the moment they were called 【A: OI-10】 | H | F-APT-12, BR-14 |
| FR-APT-32 | Marking No-show shall be a staff decision; the system shall never mark a patient No-show automatically | H | BR-14 |
| FR-APT-33 | The system shall automatically transition to `Expired` any booking in a session that ended without the session having been started by staff | H | BR-22, EC-13 |
| FR-APT-34 | The system shall permit staff to reverse an incorrect status transition within the same session, recording the reversal and its reason in the audit trail | M | EC-16, BR-60 |

#### Walk-ins and emergencies

| ID | Requirement | Pri | Source |
|---|---|---|---|
| FR-APT-35 | The system shall allow Medical Center Staff to register a walk-in patient by student identifier and optional reason, and to insert them into a session's live queue | C | F-APT-13 |
| FR-APT-36 | Walk-in registration shall be completable in a single form with no more than 3 mandatory fields | C | NFR-USE-01, CON-01 |
| FR-APT-37 | The system shall assign a walk-in a serial number continuing the session's sequence, and shall place them at the end of the current queue unless marked Emergency | H | BR-18 |
| FR-APT-38 | The system shall allow staff to register a walk-in whose booking capability is suspended under FR-APT-12 | C | BR-15 |
| FR-APT-39 | The system shall allow staff to mark any queue entry as `Emergency`, which shall place it at the head of the queue ahead of all waiting patients | C | F-APT-14, BR-17 |
| FR-APT-40 | On an emergency insertion, the system shall notify every waiting patient in that session that an emergency case has been prioritised and their estimate has changed, stating the revised estimate | H | F-APT-14, BR-17 |
| FR-APT-41 | The system shall require a reason for every Emergency designation and shall record it in the audit trail | H | BR-60 |
| FR-APT-42 | The system shall permit a walk-in to be registered even when the session's walk-in allocation is exhausted, recording that the allocation was exceeded | H | EC-12 |

### 3.2.5 Module PAY — Consultation Fee Management

| ID | Requirement | Pri | Source |
|---|---|---|---|
| FR-PAY-01 | The system shall allow an Administrator to configure the consultation fee amount, default 50 BDT 【A: OI-15】 | H | F-PAY-01, BR-30 |
| FR-PAY-02 | The system shall maintain a payment status per appointment, one of: `Unpaid`, `Paid`, `Waived` | H | F-PAY-02 |
| FR-PAY-03 | The system shall allow Medical Center Staff to record a counter payment against an appointment, capturing amount and receipt number, and setting status to `Paid` | H | F-PAY-03 |
| FR-PAY-04 | The system shall confirm a booking irrespective of payment status; payment shall not be a precondition of booking | H | BR-31 |
| FR-PAY-05 | The system shall prevent transition of an appointment to `In Consultation` while its payment status is `Unpaid`, unless a staff member records an override with a reason | H | BR-31, EC-21 |
| FR-PAY-06 | The system shall allow Medical Center Staff to set payment status to `Waived`, requiring selection of a waiver reason and recording the authorising user | H | F-PAY-05, BR-33 |
| FR-PAY-07 | The system shall automatically set payment status to `Waived` with reason `Follow-up within 7 days` where the student has a `Completed` appointment with the same reason-for-visit category within the preceding 7 days 【A: OI-16】 | M | BR-32 |
| FR-PAY-08 | The system shall produce a daily collection summary listing every payment recorded on a given date, with total, count, and breakdown by staff member | H | F-PAY-04, BR-34 |
| FR-PAY-09 | The system shall allow staff to record a reconciliation entry against a daily collection summary, capturing counted cash and any discrepancy with a reason | H | BR-34 |
| FR-PAY-10 | The system shall never overwrite or delete a recorded payment. Corrections shall be recorded as adjusting entries that reference the original | C | BR-34, BR-61 |
| FR-PAY-11 | The system shall not accept, process or store any online payment instrument in Phase 1 | C | §1.2.3 |

### 3.2.6 Module MED — Medicine Inventory & Store

#### Student-facing

| ID | Requirement | Pri | Source |
|---|---|---|---|
| FR-MED-01 | The system shall allow any user, including unauthenticated visitors, to search the medicine catalogue by brand name or generic name | H | F-MED-02, F-DASH-07 |
| FR-MED-02 | The search shall return partial and approximate matches, and shall match a brand-name query to items catalogued under the corresponding generic name and vice versa | H | F-MED-02 |
| FR-MED-03 | The system shall display for each result: name, strength, dosage form, availability Status Band, OTC/Prescription indicator, and a freshness stamp | H | F-MED-03, BR-35 |
| FR-MED-04 | The system shall display, adjacent to every Status Band, the text "as of HH:MM" reflecting the time of the most recent stock movement or verification, together with a statement that stock is not reserved | C | F-MED-04, BR-37 |
| FR-MED-05 | The system shall never display exact stock quantities to any user other than the Store Operator and the System Administrator | C | F-MED-03, BR-35 |
| FR-MED-06 | The system shall derive the Status Band as: `Out of Stock` when dispensable quantity is 0; `Low Stock` when dispensable quantity is at or below the item's configured threshold; otherwise `Available` | H | BR-36 |
| FR-MED-07 | For an item classified Prescription-only, the system shall display "Requires a doctor's prescription" and shall not present any wording implying direct collection | C | BR-38, [R1] §5.3 |
| FR-MED-08 | The system shall display the medicine store's current open/closed state, today's opening hours, and today's closing time | H | F-MED-06 |
| FR-MED-09 | The system shall present all medicine information as informational only, and shall not permit any student to reserve, hold or request any item in Phase 1 | C | §1.2.3, BR-37 |

#### Operator-facing

| ID | Requirement | Pri | Source |
|---|---|---|---|
| FR-MED-10 | The system shall allow the Store Operator to create and maintain catalogue items comprising generic name, brand name, strength, dosage form, and OTC/Prescription-only classification | H | F-MED-01 |
| FR-MED-11 | The system shall require every catalogue item to carry an OTC or Prescription-only classification; no item shall exist unclassified | C | BR-38 |
| FR-MED-12 | The system shall allow the Store Operator to record a stock receipt, capturing item, quantity, batch identifier and expiry date | H | F-MED-08 |
| FR-MED-13 | The system shall maintain stock at batch level, each batch carrying its own quantity and expiry date | H | F-MED-08 |
| FR-MED-14 | The system shall allow the Store Operator to record a dispensing event, decrementing stock from the appropriate batch | H | F-MED-09 |
| FR-MED-15 | The system shall propose the earliest-expiring non-expired batch when recording a dispensing event (FEFO), and shall require a reason if the operator selects another batch | H | BR-39 |
| FR-MED-16 | The system shall exclude from dispensable quantity any batch whose expiry date is on or before the current date | C | BR-40 |
| FR-MED-17 | The system shall recalculate every item's Status Band at 00:01 BST daily to reflect batches that have expired | C | BR-40, EC-27 |
| FR-MED-18 | The system shall prevent recording a dispensing event against an expired batch | C | BR-40 |
| FR-MED-19 | The system shall allow the Store Operator to record a stock adjustment, requiring selection of a reason from `Damage`, `Loss`, `Correction`, `Expiry Removal`, and free-text detail | H | F-MED-14, BR-41 |
| FR-MED-20 | The system shall record every stock movement — receipt, dispensing, adjustment — with actor, item, batch, quantity, direction, reason and timestamp, in an append-only log | C | F-MED-15, BR-41, BR-60 |
| FR-MED-21 | The system shall never permit deletion or modification of a recorded stock movement. Corrections shall be recorded as new adjusting movements | C | BR-41, BR-61 |
| FR-MED-22 | The system shall allow the Store Operator to configure a Low Stock threshold per catalogue item | H | F-MED-10 |
| FR-MED-23 | The system shall notify the Store Operator when an item's dispensable quantity falls to or below its Low Stock threshold, at most once per item per day | H | F-MED-10, F-NTF-06 |
| FR-MED-24 | The system shall limit the quantity dispensable to a single student for a single item within 24 hours to a configurable maximum, default 10 units 【A: OI-17】, overridable by the operator with a reason | M | [R1] §19 Q14 |
| FR-MED-25 | The system shall allow the Store Operator to define scheduled store opening hours per weekday | H | F-MED-07 |
| FR-MED-26 | The system shall derive the store's open/closed state from the scheduled hours by default | H | BR-42 |
| FR-MED-27 | The system shall allow the Store Operator to apply a manual override to the store state, requiring a reason, and shall expire that override automatically at 23:59 BST on the day it was applied | H | BR-42 |
| FR-MED-28 | The system shall not record the identity of the student receiving a dispensed medicine in Phase 1 【A: OI-18 — see §6, this is a deliberate privacy/accountability trade-off requiring DIU decision】 | H | [R1] §19 Q15 |

### 3.2.7 Module CNS — Counseling Intake & Crisis Safety

> **All requirements in §3.2.7 and §3.2.8 are subject to sign-off by DIU counseling professionals before implementation (ASM-09, OI-01). Requirements specify the mechanism; the clinical content of crisis messaging and escalation is supplied by [R3], not by the development team.**

| ID | Requirement | Pri | Source |
|---|---|---|---|
| FR-CNS-01 | The system shall allow Medical Center Staff or an Administrator to maintain counselor profiles and published availability windows | H | F-CNS-01 |
| FR-CNS-02 | The system shall display counselor availability to students as windows of availability, not as individually bookable slots | H | F-CNS-01, [R1] §13.7 |
| FR-CNS-03 | The system shall display a crisis-resources banner on every counseling screen, including to unauthenticated visitors, containing the contact details specified in [R3] | **C** | F-CNS-03, BR-47 |
| FR-CNS-04 | The crisis-resources banner shall be visible without scrolling on the initial view of every counseling screen at all supported viewport widths | **C** | BR-47, CON-15 |
| FR-CNS-05 | The system shall display, at the point of request submission and before submission is possible, a notice stating that the service is not an emergency service, that requests are reviewed during stated office hours only, and what to do if help is needed immediately | **C** | F-CNS-04, BR-48 |
| FR-CNS-06 | Where a student selects the highest urgency level, the system shall present an interstitial containing the crisis resources from [R3] and offering two explicit paths — contact immediately, or continue with the request — before the request is accepted | **C** | F-CNS-05, [R1] §5.2 |
| FR-CNS-07 | The system shall allow an authenticated student to submit a counseling request comprising: a category selected from a configurable list, a self-reported urgency level, an optional free-text note, one or more preferred time windows, and an optional counselor gender preference | H | F-CNS-02, [R1] SI-7 |
| FR-CNS-08 | The system shall require no more than the fields in FR-CNS-07, and shall make only category and urgency mandatory | H | [R1] §9 Persona 3 |
| FR-CNS-09 | The system shall treat the student's self-reported urgency as an input to triage only, and shall never use it to set final priority | **C** | BR-45 |
| FR-CNS-10 | The system shall dispatch an automatic acknowledgement to the student within 1 minute of request submission, restating the triage SLA and the crisis resources | **C** | F-CNS-06, BR-46 |
| FR-CNS-11 | The system shall allow a student to view the current status of each of their own counseling requests | H | F-CNS-07, BR-63 |
| FR-CNS-12 | The system shall never expose counseling notes, triage reasoning, or counselor commentary to the student | C | BR-49 |
| FR-CNS-13 | The system shall allow a student to withdraw a request at any time before it reaches `Scheduled` status | H | BR-56 |
| FR-CNS-14 | The system shall allow a Counseling Professional to schedule a session against a request, specifying date, time, duration and location/mode | H | F-CNS-08 |
| FR-CNS-15 | The system shall notify the student when a session is scheduled, using discreet content per BR-53 | C | F-CNS-08, BR-53 |
| FR-CNS-16 | The system shall allow the student to confirm or decline a scheduled session | H | F-CNS-08 |
| FR-CNS-17 | The system shall not apply any no-show penalty, booking restriction, or negative consequence to a student who misses a counseling session | **C** | [R1] §19 Q23 |

### 3.2.8 Module CSE — Counseling Triage & Case Management

| ID | Requirement | Pri | Source |
|---|---|---|---|
| FR-CSE-01 | The system shall present Counseling Professionals a triage queue of all requests, sorted by priority descending then by waiting time descending | H | F-CSE-01 |
| FR-CSE-02 | The triage queue shall visually distinguish requests whose triage SLA has been breached | H | F-CSE-01, BR-46 |
| FR-CSE-03 | The system shall support the priority values `Normal`, `Priority`, `Urgent` | H | F-CSE-02 |
| FR-CSE-04 | The system shall set an initial priority from the student's self-reported urgency, and shall mark it as provisional until a Counseling Professional confirms or changes it | H | F-CSE-02, BR-45 |
| FR-CSE-05 | The system shall allow only a Counseling Professional to set the final priority of a request | **C** | F-CSE-02, BR-45 |
| FR-CSE-06 | The system shall require a reason when a Counseling Professional changes a priority, and shall record it in the audit trail | H | F-CSE-03 |
| FR-CSE-07 | The system shall apply and track a triage SLA per priority: `Urgent` — same working day; `Priority` — 2 working days; `Normal` — 5 working days 【A: OI-12】 | H | [R1] §19 Q20 |
| FR-CSE-08 | The system shall notify all Counseling Professionals within 1 minute of the submission of a request carrying the highest self-reported urgency | **C** | F-NTF-07 |
| FR-CSE-09 | The system shall notify Counseling Professionals daily of any request whose triage SLA is breached or due to breach within one working day | H | F-NTF-07 |
| FR-CSE-10 | The system shall support the case status lifecycle: `Requested` → `Under Review` → `Scheduled` → `Session Completed` → `Follow-up Required` → `Closed`, and the terminal states `Withdrawn` and `Declined` | H | F-CSE-04 |
| FR-CSE-11 | The system shall present a chronological timeline per case showing every status change with actor and timestamp | H | F-CSE-05 |
| FR-CSE-12 | The system shall allow a Counseling Professional to record confidential session notes against a case | H | F-CSE-06 |
| FR-CSE-13 | Counseling session notes shall be readable only by users holding the Counseling Professional role. No other role, including System Administrator, shall be able to read them by any means other than break-glass (FR-AUTH-16 / PRM-14) | **C** | BR-49, BR-52 |
| FR-CSE-14 | The system shall ensure that no interface, list, count, export, notification or search result available to a non-Counseling-Professional role reveals that a given student has submitted a counseling request or holds a counseling case | **C** | BR-50 |
| FR-CSE-15 | The system shall record every read access to counseling case data — including request content, notes, and case timelines — with the accessing user, the case identifier, and the timestamp | **C** | F-CSE-11, BR-51 |
| FR-CSE-16 | The access log required by FR-CSE-15 shall itself be readable only by Counseling Professionals and by a designated counseling service head | **C** | BR-51 |
| FR-CSE-17 | The system shall present each Counseling Professional a caseload summary showing counts of open cases, requests pending triage, and cases with overdue follow-up | H | F-CSE-08 |
| FR-CSE-18 | The system shall provide a mechanism for a Counseling Professional to invoke the escalation workflow defined in [R3], recording that it was invoked, by whom, and when | **C** | F-CSE-10, BR-57 |
| FR-CSE-19 | The system shall not encode, infer or automate any clinical judgement. Escalation shall be invoked by a human Counseling Professional only | **C** | CON-15, §1.2.3 |
| FR-CSE-20 | The system shall allow a Counseling Professional to close a case with a closure reason | H | F-CSE-04 |
| FR-CSE-21 | The system shall automatically transition a case with no activity for 90 days to `Closed` with reason `Inactive`, and shall notify the assigned Counseling Professional but not the student 【A: OI-19】 | M | [R1] §19 Q24 |
| FR-CSE-22 | The system shall assign each new request to a shared pool visible to all Counseling Professionals, rather than to an individual, in Phase 1 【A: OI-20】 | H | [R1] §19 Q19 |
| FR-CSE-23 | The system shall honour a student's counselor gender preference where recorded, as a visible attribute on the triage queue, without enforcing it | M | [R1] SI-7 |

### 3.2.9 Module NTF — Notifications

| ID | Requirement | Pri | Source |
|---|---|---|---|
| FR-NTF-01 | The system shall provide an in-app notification centre per user, showing unread and historical notifications | H | F-NTF-01 |
| FR-NTF-02 | The system shall deliver notifications by email to the user's registered university email address | H | F-NTF-02 |
| FR-NTF-03 | The system shall not use SMS, push, or any paid channel in Phase 1 | H | CON-08 |
| FR-NTF-04 | The system shall generate notifications for the following events: booking confirmed; booking cancelled by student; booking cancelled due to doctor unavailability; queue position reaches 2; estimate slip exceeding 30 minutes; emergency insertion affecting the queue; booking suspension applied; counseling request acknowledged; counseling session scheduled; counseling session reminder; account locked; low stock (operator); urgent counseling request (counselor); SLA breach (counselor) | H | F-NTF-04 |
| FR-NTF-05 | All notifications relating to the counseling service shall use discreet content: the subject line, preview text and body shall omit the words identifying the counseling or psychiatric service, any category, any urgency, any clinical term, and any counselor specialisation | **C** | F-NTF-03, BR-53 |
| FR-NTF-06 | Counseling notifications shall convey only that an update is available and shall require the student to log in to view it | **C** | BR-53 |
| FR-NTF-07 | The system shall record every notification generated, its channel, its recipient, and its delivery outcome | H | F-NTF-10 |
| FR-NTF-08 | Failure of email delivery shall not prevent the corresponding in-app notification from being available | H | F-NTF-10 |
| FR-NTF-09 | The system shall not include any personal health information, diagnosis, reason-for-visit, or medicine name in any email body | **C** | NFR-PRIV-03 |

### 3.2.10 Module ADM — Administration & Configuration

| ID | Requirement | Pri | Source |
|---|---|---|---|
| FR-ADM-01 | The system shall expose as runtime configuration, editable by an Administrator without redeployment, every value marked 【A】 in this document, together with: slot length, walk-in allocation, publication window, booking cutoff, maximum active bookings, no-show threshold and suspension period, grace period, estimate slip threshold, consultation fee, low-stock thresholds, dispensing limit, triage SLAs, session timeouts, and case inactivity period | **C** | §1.6.3, F-ADM-01 |
| FR-ADM-02 | The system shall record every configuration change with actor, previous value, new value and timestamp | C | BR-60 |
| FR-ADM-03 | The system shall allow an Administrator to maintain the service calendar of non-service days (FR-SCH-10) | H | F-ADM-02 |
| FR-ADM-04 | The system shall allow an Administrator to publish a dated announcement banner visible to students and on the public view | M | F-ADM-03 |
| FR-ADM-05 | The system shall provide an Administrator an audit log viewer with filtering by actor, date range, entity type and action | H | F-ADM-04 |
| FR-ADM-06 | The audit log viewer shall exclude all counseling case content and shall show counseling entries only as non-identifying activity records (e.g. "counseling case accessed") without case or student identifiers | **C** | BR-50, BR-52 |
| FR-ADM-07 | The system shall allow an Administrator to view system health indicators: failed login count, failed notification count, and outstanding data-entry backlogs | M | NFR-MNT-02 |
| FR-ADM-08 | The system shall allow an Administrator to export appointment, queue, fee and inventory data for a specified date range in a machine-readable format, for baseline and reporting purposes | H | F-ADM-08, CON-09 |
| FR-ADM-09 | The export of FR-ADM-08 shall exclude all counseling data | **C** | BR-55 |

### 3.2.11 Module AUD — Audit & Logging (cross-cutting)

| ID | Requirement | Pri | Source |
|---|---|---|---|
| FR-AUD-01 | The system shall record every state transition of every appointment, case, stock item and account, capturing actor, timestamp, previous state and new state | C | BR-60 |
| FR-AUD-02 | The audit log shall be append-only. No role, including System Administrator, shall be able to modify or delete an audit entry | **C** | BR-61 |
| FR-AUD-03 | The system shall record every access to a student's personal data by a non-owning user, with accessor, subject, data category and timestamp | C | NFR-SEC-05 |
| FR-AUD-04 | The system shall maintain the counseling access log of FR-CSE-15 separately from the general audit log, under counseling-only permissions | **C** | BR-51, BR-52 |
| FR-AUD-05 | The system shall support break-glass administrator access to restricted data, requiring a free-text justification of not fewer than 20 characters before access is granted | **C** | F-AUTH-09, BR-52 |
| FR-AUD-06 | Every break-glass invocation shall be recorded and shall trigger an immediate notification to the designated counseling service head | **C** | BR-52 |
| FR-AUD-07 | Break-glass access shall be time-limited to 60 minutes and shall not be renewable without a new justification 【A: OI-14】 | C | BR-52 |

---

## 3.3 Business Rules

Rules retain their identifiers from [R1] §14. Rules **BR-65 onward are new in this SRS**. Rules governing Phase 2/3 functionality are marked *(deferred)* and are not implemented in Phase 1.

### Identity & access

| ID | Rule | Enforced by |
|---|---|---|
| BR-01 | Only currently enrolled students may book services. Account status follows enrolment status | FR-AUTH-09 |
| BR-02 | A student may act only on their own behalf. No proxy booking in Phase 1 | FR-AUTH-15 |
| BR-03 | A user may hold multiple roles; permissions are the union, except counseling access which requires explicit Counseling Professional designation | FR-AUTH-03, FR-AUTH-04 |
| BR-04 | Students never see other students' identities anywhere in the system — only anonymous queue counts | FR-APT-02, FR-DASH-07 |
| BR-05 | Provider accounts are created only by an Administrator; no staff self-registration | FR-AUTH-02 |
| BR-06 | Deactivated accounts retain historical records but cannot log in | FR-AUTH-09, FR-AUTH-11 |

### Appointments & queue

| ID | Rule | Enforced by |
|---|---|---|
| BR-10 | Bookings open 7 days ahead 【A: OI-07】 and close at the configured cutoff, default session start 【A: OI-09】 | FR-SCH-12, FR-APT-11 |
| BR-11 | A student may hold at most 2 active medical bookings, and at most 1 per doctor per day 【A: OI-08】 | FR-APT-09, FR-APT-10 |
| BR-12 | Cancellation is free up to 2 hours before the estimated time; later cancellations are recorded as Late Cancellation 【A: OI-09】 | FR-APT-16 |
| BR-13 | *(deferred)* Reschedule limited to twice per appointment | Phase 2 |
| BR-14 | A student not checked in within 20 minutes of being called is marked No-show, at staff discretion 【A: OI-10】 | FR-APT-31, FR-APT-32 |
| BR-15 | 3 No-shows within 30 days suspends **online booking** for 14 days. Walk-in access is never blocked 【A: OI-10】 | FR-APT-12, FR-APT-13, FR-APT-38 |
| BR-16 | Each session reserves a walk-in allocation, default 30%, not bookable online 【A: OI-06】 | FR-SCH-04, FR-SCH-05 |
| BR-17 | Emergency cases override queue order; waiting students are notified that an emergency shifted their estimate | FR-APT-39, FR-APT-40 |
| BR-18 | The queue is strictly ordered by serial within a session, except for emergency overrides | FR-APT-05, FR-APT-19, FR-APT-37 |
| BR-19 | Displayed times are estimates, recalculated from actual session pace. The interface must never present them as guaranteed | FR-APT-08, FR-APT-21, FR-APT-22 |
| BR-20 | If the estimate slips by more than 30 minutes, affected students are notified proactively 【A: OI-09】 | FR-APT-24 |
| BR-21 | Unclaimed slots become bookable again immediately on cancellation | FR-APT-17 |
| BR-22 | Appointments not checked in by session end are marked Expired, not No-show, if the doctor never ran the session | FR-APT-33 |

### Schedules & leave

| ID | Rule | Enforced by |
|---|---|---|
| BR-25 | The published schedule is the single source of truth; no booking may exist outside a published session | FR-SCH-13 |
| BR-26 | Marking a doctor unavailable requires resolving every affected booking before the change commits | FR-SCH-07, FR-SCH-08 |
| BR-27 | Affected students must be notified within 5 minutes of a leave-caused cancellation, on all enabled channels | FR-SCH-09 |
| BR-28 | Holidays and closure days block booking entirely and display the reason | FR-SCH-11 |
| BR-29 | Schedule changes within 24 hours of a session require a stated reason, recorded in the audit log | FR-SCH-14 |

### Fees

| ID | Rule | Enforced by |
|---|---|---|
| BR-30 | The consultation fee is configurable, default 50 BDT, payable at the counter in Phase 1 【A: OI-15】 | FR-PAY-01, FR-PAY-03 |
| BR-31 | A booking is confirmed without payment; Unpaid status blocks consultation, not booking | FR-PAY-04, FR-PAY-05 |
| BR-32 | A follow-up for the same complaint within 7 days is fee-exempt 【A: OI-16】 | FR-PAY-07 |
| BR-33 | Fee waivers require staff authorisation and a recorded reason | FR-PAY-06 |
| BR-34 | The daily collection summary must reconcile against counted cash; discrepancies are recorded, not silently corrected | FR-PAY-08, FR-PAY-09, FR-PAY-10 |

### Medicine & inventory

| ID | Rule | Enforced by |
|---|---|---|
| BR-35 | Students see status bands only — never exact quantities | FR-MED-05 |
| BR-36 | Out of Stock = 0; Low Stock = at or below configured threshold; otherwise Available | FR-MED-06 |
| BR-37 | Every status display carries an "as of HH:MM" stamp and states that stock is not reserved | FR-MED-04 |
| BR-38 | Prescription-only items are visible but marked as requiring a prescription; the interface must not imply direct collection | FR-MED-07, FR-MED-11 |
| BR-39 | Dispensing follows FEFO — the earliest-expiring batch is issued first | FR-MED-15 |
| BR-40 | Expired stock is unavailable for dispensing from the expiry date | FR-MED-16, FR-MED-17, FR-MED-18 |
| BR-41 | Every stock change records who, what, how much and why. Manual adjustments require a reason | FR-MED-19, FR-MED-20, FR-MED-21 |
| BR-42 | Store status defaults to the published schedule; a manual override requires a reason and expires automatically at end of day | FR-MED-26, FR-MED-27 |

### Counseling

| ID | Rule | Enforced by |
|---|---|---|
| BR-45 | Self-reported urgency is an input to triage, never the final priority. Only a Counseling Professional sets final priority | FR-CNS-09, FR-CSE-04, FR-CSE-05 |
| BR-46 | Every request receives an automatic acknowledgement within 1 minute and human triage within 1 working day | FR-CNS-10, FR-CSE-07 |
| BR-47 | Crisis resources are displayed on every counseling screen, before login, and again at submission | FR-CNS-03, FR-CNS-04 |
| BR-48 | The system states plainly that it is not monitored outside office hours, at the point of submission | FR-CNS-05 |
| BR-49 | Counseling notes are readable only by designated Counseling Professionals — not by doctors, medical staff, store operators or administrators | FR-CSE-13, §3.5 |
| BR-50 | The existence of a counseling record is itself confidential. Non-counseling roles must not be able to infer that a student has a counseling case | FR-CSE-14, FR-ADM-06, FR-DASH-07 |
| BR-51 | Every read of counseling case data is logged with user, record and timestamp | FR-CSE-15, FR-AUD-04 |
| BR-52 | Administrator access to counseling content requires break-glass: justification, logging, and automatic notification to the counseling service head | FR-AUD-05, FR-AUD-06, FR-AUD-07 |
| BR-53 | Counseling notifications use discreet wording — no service name, diagnosis, or specialisation in subject lines or previews | FR-NTF-05, FR-NTF-06 |
| BR-54 | *(deferred)* Cross-service information sharing requires recorded student consent | Phase 2 |
| BR-55 | Counseling reporting is aggregate-only with a minimum cell size of 10; no report may permit re-identification | FR-ADM-09 (Phase 1: counseling excluded from all export) |
| BR-56 | A student may withdraw a pending request at any time before it is scheduled | FR-CNS-13 |
| BR-57 | Risk disclosure triggers the documented escalation workflow authored by the counseling service | FR-CSE-18 |

### Data & audit

| ID | Rule | Enforced by |
|---|---|---|
| BR-60 | All state transitions are recorded with actor, timestamp, previous and new state | FR-AUD-01 |
| BR-61 | Audit logs are append-only and cannot be edited by any role, including administrators | FR-AUD-02 |
| BR-62 | Records are retained per a DIU-approved policy | **OI-02 — policy does not exist; NFR-RET-01 specifies interim behaviour** |
| BR-63 | Students may view their own appointment history and their own counseling request statuses at any time | FR-CNS-11, FR-DASH-02 |
| BR-64 | Personal data is not shared outside the system without documented consent or legal obligation | NFR-PRIV-01 |

### New rules introduced by this SRS

| ID | Rule | Rationale | Enforced by |
|---|---|---|---|
| **BR-65** | Staff shall verify the student's identity against a presented student ID at check-in before advancing an appointment to Checked In | Booking is remote; without a check-in verification step, impersonation ([R1] risk R15) is unmitigated | FR-APT-27, procedural |
| **BR-66** | A walk-in registration shall never be refused on the basis of system state. If the system cannot register the walk-in, staff shall use the paper fallback and reconcile afterwards | Care must never be gated by software availability | EC-18, NFR-REL-04 |
| **BR-67** | No automated process shall alter a counseling case's priority, status or content. Every counseling case change shall have a human Counseling Professional as its actor | Prevents the system from performing implied clinical judgement | FR-CSE-19, FR-CSE-21 (notification only) |
| **BR-68** | Where a required piece of clinical or safety content ([R3]) is not yet available, the corresponding feature shall not be enabled in production | Prevents shipping a placeholder crisis message | OI-01, deployment gate |
| **BR-69** | Emergency queue insertions shall be visible to waiting students as a cause of delay, but never with any identifying detail of the emergency patient | Transparency without breaching the emergency patient's privacy | FR-APT-40, BR-04 |
| **BR-70** | Any value marked 【A】 shall be implemented as configuration, never as a literal in code | A DIU decision must cost a setting change, not a release | FR-ADM-01 |

---

## 3.4 Validation Rules

Field- and operation-level validation. Every rule is a rejection condition with a required user-facing outcome.

### Identity & account

| ID | Field / operation | Rule | On violation |
|---|---|---|---|
| VR-01 | University email | Must match DIU institutional domain format | Reject; "Use your DIU university email address" |
| VR-02 | Password (fallback auth only) | Minimum 10 characters; must contain at least three of: lowercase, uppercase, digit, symbol | Reject with the unmet criteria listed |
| VR-03 | Student identifier | Must match the DIU student ID format 【A: OI-21】; must be unique | Reject; "Student ID not recognised" |
| VR-04 | Role assignment | Counseling Professional role may be assigned only by an Administrator and only to an account flagged as clinical staff | Reject; log the attempt |
| VR-05 | Account deactivation | Cannot deactivate an account holding active bookings or an open counseling case without explicit confirmation listing them | Warn and require confirmation |

### Schedules

| ID | Field / operation | Rule | On violation |
|---|---|---|---|
| VR-10 | Session start / end time | End must be strictly after start; both within 00:00–23:59 | Reject |
| VR-11 | Session duration | Must be at least one slot length | Reject |
| VR-12 | Slot length | Integer, 5–60 minutes inclusive | Reject |
| VR-13 | Walk-in allocation | Integer 0–100; a value of 100 shall be rejected with an explanation that no slots would be bookable | Reject |
| VR-14 | Publication window | Integer 1–30 days | Reject |
| VR-15 | Date-specific override | Must fall within the publication window or the future | Reject |
| VR-16 | Unavailability range | End date on or after start date; may not be entirely in the past | Reject |
| VR-17 | Session on a non-service day | May not be created unless the non-service day is first removed or explicitly overridden | Reject with the conflicting calendar entry named |
| VR-18 | Schedule change within 24h | Reason field mandatory, minimum 10 characters | Reject |
| VR-19 | Overlapping sessions | Two sessions for the same doctor may not overlap | Reject, naming the conflicting session |

### Appointments & queue

| ID | Field / operation | Rule | On violation |
|---|---|---|---|
| VR-20 | Slot selection | Slot must exist, be in the future, be within the publication window, and be unbooked at the moment of commit | Reject; refresh availability; "That slot was just taken" |
| VR-21 | Booking count | Student's active bookings must be below the configured maximum | Reject, listing the existing bookings |
| VR-22 | Same-doctor same-day | Student must have no other active booking with that doctor that date | Reject |
| VR-23 | Booking suspension | Student must not be under an active booking suspension | Reject; state the end date and that walk-in access remains available |
| VR-24 | Booking cutoff | Current time must be before the session's booking cutoff | Reject |
| VR-25 | Reason-for-visit | If provided, must be from the configured category list; free text limited to 200 characters | Reject or truncate with warning |
| VR-26 | Cancellation | Appointment must be in `Booked` or `Checked In` state | Reject |
| VR-27 | Check-in | Appointment must be in `Booked` state, on the current date, and its session must not have ended | Reject with the reason stated |
| VR-28 | Status transition | Must follow the lifecycle of FR-APT-28; transitions to a non-adjacent state are rejected except staff reversal per FR-APT-34 | Reject, naming the permitted next states |
| VR-29 | Walk-in student identifier | Must resolve to an existing student account, or be recorded as an unregistered walk-in with a mandatory name field | Prompt to create or record as unregistered |
| VR-30 | Emergency designation | Reason mandatory, minimum 10 characters | Reject |
| VR-31 | No-show marking | Only permitted after the configured grace period has elapsed since the patient was called | Reject; state the remaining time |
| VR-32 | Status reversal | Permitted only within the same session and only by the staff role; reason mandatory | Reject |

### Fees

| ID | Field / operation | Rule | On violation |
|---|---|---|---|
| VR-40 | Payment amount | Must be a non-negative number with at most 2 decimal places; must equal the configured fee unless a waiver or override is recorded | Reject or require override reason |
| VR-41 | Receipt number | Mandatory when recording a counter payment; must be unique within the date | Reject; "Receipt number already used today" |
| VR-42 | Waiver | Reason mandatory, selected from the configured list | Reject |
| VR-43 | Reconciliation | Counted cash mandatory; if it differs from the system total, a discrepancy reason of at least 10 characters is mandatory | Reject |
| VR-44 | Payment on a cancelled appointment | Rejected | Reject with explanation |

### Medicine

| ID | Field / operation | Rule | On violation |
|---|---|---|---|
| VR-50 | Catalogue item | Generic name mandatory; strength and dosage form mandatory; OTC/Prescription classification mandatory | Reject |
| VR-51 | Catalogue duplication | The combination of generic name, strength and dosage form must be unique | Reject; offer the existing item |
| VR-52 | Stock receipt quantity | Integer greater than 0 | Reject |
| VR-53 | Expiry date | Mandatory; must be strictly after the current date at time of receipt | Reject; "Cannot receive stock that is already expired" |
| VR-54 | Batch identifier | Mandatory; unique per item | Reject |
| VR-55 | Dispensing quantity | Integer greater than 0 and not exceeding the selected batch's remaining quantity | Reject; state available quantity |
| VR-56 | Dispensing from expired batch | Rejected unconditionally | Reject; no override |
| VR-57 | Non-FEFO batch selection | Permitted only with a reason of at least 10 characters | Reject without reason |
| VR-58 | Per-student dispensing limit | Quantity must not exceed the configured 24-hour maximum unless an operator override reason is recorded | Require override reason |
| VR-59 | Stock adjustment | Reason category mandatory; detail mandatory, minimum 10 characters; quantity non-zero | Reject |
| VR-60 | Low stock threshold | Non-negative integer | Reject |
| VR-61 | Store hours | Closing time must be after opening time; a weekday may have at most one interval in Phase 1 | Reject |
| VR-62 | Store manual override | Reason mandatory, minimum 10 characters | Reject |
| VR-63 | Medicine search query | Minimum 2 characters | No search performed; prompt |

### Counseling

| ID | Field / operation | Rule | On violation |
|---|---|---|---|
| VR-70 | Counseling category | Mandatory; must be from the configured list | Reject |
| VR-71 | Self-reported urgency | Mandatory; must be from the configured scale | Reject |
| VR-72 | Free-text note | Optional; maximum 1000 characters | Truncate with a visible counter; never silently discard |
| VR-73 | Preferred time windows | At least one required; each must be in the future | Reject |
| VR-74 | Duplicate request | A student may hold at most one request in `Requested` or `Under Review` state at a time | Reject; direct the student to their existing request; **do not treat as an error condition — use supportive wording** |
| VR-75 | High-urgency submission | The interstitial of FR-CNS-06 must have been presented and acknowledged before the request is accepted | Reject at the server; not enforceable by the interface alone |
| VR-76 | Priority change | Reason mandatory, minimum 10 characters | Reject |
| VR-77 | Session scheduling | Date and time must be in the future; must fall within a published counselor availability window unless overridden with a reason | Reject or require reason |
| VR-78 | Case closure | Closure reason mandatory | Reject |
| VR-79 | Session notes | Maximum 5000 characters; may not be submitted by a non-Counseling-Professional under any circumstance | Reject; log the attempt as a security event |
| VR-80 | Withdrawal | Permitted only while status is `Requested` or `Under Review` | Reject with explanation |

### Cross-cutting

| ID | Field / operation | Rule | On violation |
|---|---|---|---|
| VR-90 | All free text | Must be stored and re-rendered without interpretation as markup or executable content | Sanitise on output; never on input storage |
| VR-91 | All dates and times | Interpreted in BST; no other timezone accepted | Normalise |
| VR-92 | Concurrent modification | Any write against a stale version of a record must be rejected, not merged | Reject; re-present current state |
| VR-93 | Mandatory reason fields | Minimum 10 characters, whitespace-only rejected | Reject |
| VR-94 | Configuration values | Must fall within the stated range for that setting; out-of-range values rejected at save, not at use | Reject at save |

---

## 3.5 System Permissions

### 3.5.1 Roles

| Role | Code | Description |
|---|---|---|
| Anonymous | `ANON` | Unauthenticated visitor |
| Student | `STU` | Enrolled DIU student |
| Doctor | `DOC` | Consulting doctor. **No Phase 1 function depends on this role logging in** (CON-02) |
| Medical Center Staff | `MCS` | Reception and operations |
| Store Operator | `STO` | Medicine store custodian |
| Counseling Professional | `CNP` | Counselor / psychiatrist |
| System Administrator | `ADM` | DIU IT |

### 3.5.2 Permission matrix

**Legend:** `C` create · `R` read · `U` update · `D` delete · `—` no access · `own` own records only · `BG` break-glass only (FR-AUD-05)

| Resource | ANON | STU | DOC | MCS | STO | CNP | ADM |
|---|---|---|---|---|---|---|---|
| Public availability view | R | R | R | R | R | R | R |
| Own profile | — | R U | R U | R U | R U | R U | R U |
| User accounts & roles | — | — | — | — | — | — | C R U D |
| Doctor profiles | R | R | R own | C R U D | — | — | R |
| Doctor schedules & sessions | R | R | R | C R U D | — | — | R |
| Non-service calendar | R | R | R | R | R | R | C R U D |
| Appointment (own) | — | C R U(cancel) own | — | — | — | — | — |
| Appointment (any) | — | — | R own-session | C R U | — | — | R (metadata only) |
| Live queue | R (serial only) | R own position | R own session | R U | — | — | R |
| Walk-in registration | — | — | — | C | — | — | — |
| Emergency designation | — | — | — | C | — | — | — |
| Reason-for-visit | — | C own | R own-session | R | — | — | — |
| Payment record | — | R own | — | C R U | — | — | R |
| Daily collection summary | — | — | — | R | — | — | R |
| Medicine catalogue | R (band only) | R (band only) | R (band only) | R (band only) | C R U D | R (band only) | R |
| Medicine stock quantities | — | — | — | — | R U | — | R |
| Stock movements | — | — | — | — | C R | — | R |
| Store hours & status | R | R | R | R | C R U | R | R |
| Counseling availability | R | R | — | R U | — | R | R U |
| **Counseling request (own)** | — | **C R U(withdraw) own** | — | — | — | — | — |
| **Counseling request (any)** | — | — | **—** | **—** | **—** | **R U** | **BG** |
| **Counseling case & notes** | — | **—** | **—** | **—** | **—** | **C R U** | **BG** |
| **Counseling case existence** | — | own only | **—** | **—** | **—** | R | **BG** |
| **Counseling access log** | — | — | — | — | — | R | **—** |
| Notifications (own) | — | R U | R U | R U | R U | R U | R U |
| Notification templates | — | — | — | — | — | — | R U |
| System configuration | — | — | — | — | — | — | R U |
| Announcements | R | R | R | R | R | R | C R U D |
| General audit log | — | — | — | — | — | — | R |
| Data export | — | — | — | — | — | — | C |

### 3.5.3 Permission requirements

| ID | Requirement | Pri |
|---|---|---|
| PRM-01 | The system shall enforce §3.5.2 at the point of every operation, server-side, independently of interface state | C |
| PRM-02 | The system shall deny by default: any resource or operation not explicitly granted in §3.5.2 is denied | C |
| PRM-03 | A student shall be able to read, modify or cancel only their own records | C |
| PRM-04 | The system shall never return another student's identity in any response available to a Student or Anonymous role | C |
| PRM-05 | The Medical Center Staff role shall have no read access of any kind to counseling requests, cases, notes, or the fact of their existence | **C** |
| PRM-06 | The Store Operator role shall have no read access to appointments, counseling data, or student personal data beyond that required to record a dispensing event | **C** |
| PRM-07 | The Doctor role shall have read access only to the queue of sessions assigned to that doctor, and to no counseling data | C |
| PRM-08 | The System Administrator role shall have no read access to counseling request content, case content, or session notes, other than by break-glass | **C** |
| PRM-09 | The System Administrator role shall not be able to determine, through any interface, export, log, count or search, whether a given student has a counseling record | **C** |
| PRM-10 | The Counseling Professional role shall have no access to medicine stock quantities, payment records, or appointment queue management functions | C |
| PRM-11 | The Anonymous role shall have read access only to public availability, medicine status bands, store status, announcements, and the public queue display | C |
| PRM-12 | The system shall log every denied authorisation attempt with actor, resource and timestamp | C |
| PRM-13 | A role may not grant itself or another role additional permissions; only the System Administrator may assign roles, and role assignment shall be audited | C |
| PRM-14 | Break-glass access shall be available only to the System Administrator role, shall require justification (FR-AUD-05), shall notify the counseling service head (FR-AUD-06), and shall expire after 60 minutes (FR-AUD-07) | **C** |
| PRM-15 | Permission changes shall take effect on the affected user's next request, without requiring that user to re-authenticate for a *reduction* in permissions | C |

---

## 3.6 Edge Cases and Exception Handling

Each edge case states the condition and the required system behaviour. Every entry is testable.

### Booking and queue

| ID | Condition | Required behaviour |
|---|---|---|
| EC-01 | Two students commit to the last remaining slot simultaneously | Exactly one booking succeeds. The other receives a clear "that slot was just taken" message and a refreshed slot list. No partial booking is created |
| EC-02 | A doctor starts a session late | Estimates for all waiting patients shift by the elapsed delay. Patients exceeding the 30-minute slip threshold are notified (FR-APT-24) |
| EC-03 | A doctor finishes consultations faster than estimated | Estimates compress. Students are notified that their estimate has moved earlier but are **never** required to arrive sooner, and are not penalised for arriving at the original estimate |
| EC-04 | A doctor is called away mid-session | Staff mark the session `Interrupted`. All remaining patients are notified of the interruption. Bookings are not auto-cancelled; staff decide whether to resume, reassign or cancel |
| EC-05 | Two doctors hold overlapping sessions | Each session maintains an independent queue and independent serial sequence. A student may book only one (BR-11) |
| EC-06 | A student books, then their account is deactivated | Existing bookings are cancelled with reason `Account Inactive` and the student is notified at their last known address |
| EC-07 | A student is called but is not present | Staff may skip to the next patient. The skipped patient retains their serial and is re-called once; No-show may be marked only after the grace period (VR-31) |
| EC-08 | A student arrives after being marked No-show | Staff may register them as a walk-in. The No-show record stands but staff may record a reversal reason (FR-APT-34) |
| EC-09 | Serial numbers with mixed booked and walk-in patients | Serials are allocated from a single per-session sequence in order of entry into the queue, regardless of origin |
| EC-10 | The session's walk-in allocation is exhausted and another walk-in arrives | The walk-in is registered; the system records that the allocation was exceeded and surfaces this on the staff console (FR-APT-42). Care is never refused |
| EC-11 | An emergency arrives when the queue is empty | The emergency is placed at the head; no delay notifications are sent as no patients are affected |
| EC-12 | Multiple emergencies are inserted consecutively | Each is placed at the head in order of insertion. Waiting students receive at most one delay notification per 15-minute window to avoid notification flooding |
| EC-13 | A session's end time passes with the session never started | All its bookings transition to `Expired`, not `No-show`. Students are notified with an apology and offered rebooking. No penalty is applied (BR-22) |
| EC-14 | The estimate calculation has no historical data (first ever session for a new doctor) | The configured slot length is used (FR-APT-22) |
| EC-15 | Consultation duration data is anomalous (e.g. a session left open overnight) | Durations exceeding 4× the slot length are excluded from the rolling mean and flagged to staff |
| EC-16 | Staff advance a status by mistake | Reversal is permitted within the same session with a mandatory reason, recorded in the audit trail (FR-APT-34, VR-32) |
| EC-17 | A student cancels while already checked in | Cancellation is rejected; the student is directed to speak to staff, who record the departure as a status change with a reason |
| EC-18 | The network drops at the counter mid-session | Staff continue on the documented paper fallback (BR-66, ASM-18). On reconnection, staff enter the interim events; the system accepts back-dated entries within the same day with an `Entered retrospectively` marker |
| EC-19 | Two staff members act on the same appointment simultaneously | The second write is rejected (VR-92) and the current state is re-presented. No silent overwrite |
| EC-20 | A booking exists for a doctor whose profile is subsequently deleted | Doctor profiles with any historical appointment may not be deleted, only deactivated. Deletion is rejected with the count of affected records |

### Fees

| ID | Condition | Required behaviour |
|---|---|---|
| EC-21 | A consultation is completed while payment status is `Unpaid` | Prevented by FR-PAY-05 unless staff record an override with reason. The override appears on the daily collection summary as an outstanding item |
| EC-22 | Counted cash does not match the system total | The discrepancy is recorded with a mandatory reason (VR-43). The system total is never adjusted to match the count |
| EC-23 | A payment is recorded against the wrong appointment | An adjusting entry is recorded referencing the original; the original is never deleted (FR-PAY-10) |
| EC-24 | A student pays, then the doctor becomes unavailable before consultation | The appointment is cancelled per FR-SCH-08. The payment is flagged for manual refund on the collection summary. **Phase 1 has no automated refund** |
| EC-25 | The follow-up exemption (FR-PAY-07) applies but the student disputes it | Staff may override the waiver and record a payment with a reason |

### Medicine

| ID | Condition | Required behaviour |
|---|---|---|
| EC-26 | A student views `Available`, travels, and the item is dispensed to another student meanwhile | Accepted risk, mitigated by the freshness stamp and the explicit "not reserved" statement (FR-MED-04). No reservation exists in Phase 1 |
| EC-27 | A batch expires overnight while its item shows `Available` | The daily recalculation at 00:01 BST (FR-MED-17) updates the Status Band before the store opens |
| EC-28 | All batches of an item are expired but quantity is non-zero | Dispensable quantity is 0; the Status Band is `Out of Stock`; the operator is alerted that expired stock requires removal |
| EC-29 | The operator dispenses more than the per-student 24-hour limit | Permitted with an override reason (VR-58); the override is recorded |
| EC-30 | Stock is received with a data-entry error in quantity | Corrected by an adjustment movement with reason `Correction` (FR-MED-19); the original receipt is never edited |
| EC-31 | The store closes unexpectedly during opening hours | The operator applies a manual override with a reason (FR-MED-27), which expires at end of day |
| EC-32 | The operator forgets to apply a closure override | Accepted limitation of Phase 1. Mitigated by the scheduled-hours default (BR-42) and the freshness stamp |
| EC-33 | A search returns no results | The system states that the item is not in the DIU catalogue, and explicitly distinguishes "not stocked here" from "out of stock" |
| EC-34 | A prescription-only item is searched by a student | Availability is shown, with FR-MED-07 wording. No collection path is offered |
| EC-35 | An item is deleted from the catalogue while stock movements reference it | Catalogue items with any stock movement may not be deleted, only deactivated |

### Counseling

| ID | Condition | Required behaviour |
|---|---|---|
| EC-36 | A student submits a request outside office hours | The request is accepted and acknowledged (FR-CNS-10). The acknowledgement restates the office-hours limitation and the crisis resources. **No implication of monitoring is created** |
| EC-37 | A student selects the highest urgency | The interstitial of FR-CNS-06 is presented before acceptance. Server-side enforcement per VR-75 |
| EC-38 | A student abandons the request form partway | No partial request is stored. The crisis banner remains visible throughout |
| EC-39 | A student submits a second request while one is pending | Rejected per VR-74, with supportive wording directing them to their existing request and its status. **This must not read as a rebuke** |
| EC-40 | A request breaches its triage SLA | Flagged on the triage queue (FR-CSE-02) and notified daily to all Counseling Professionals (FR-CSE-09) |
| EC-41 | No Counseling Professional is available for an extended period | SLA breaches accumulate and are visible. **Phase 1 provides no automatic escalation beyond notification** — this is an organisational gap recorded as OI-22 |
| EC-42 | A student misses a scheduled counseling session | The session is marked `Missed`. **No penalty, no suspension, no restriction** (FR-CNS-17). The counselor may re-schedule |
| EC-43 | A student withdraws a request after a session has been scheduled | Rejected by VR-80. The student is directed to contact the service; the counselor may cancel on their behalf |
| EC-44 | A case is inactive for 90 days | Auto-closed with reason `Inactive`, notifying the counselor only (FR-CSE-21). The student is not notified, to avoid an unsolicited message about a service they disengaged from 【A: OI-19】 |
| EC-45 | An Administrator attempts to view counseling content | Denied. The attempt is logged (PRM-12). Break-glass is the only path, and it notifies the counseling service head (FR-AUD-06) |
| EC-46 | A user holds both Medical Center Staff and Counseling Professional roles | Counseling access is granted only through the Counseling Professional designation (FR-AUTH-04). Counseling data must not appear in any staff-context interface for that user |
| EC-47 | A counseling notification is delivered to a shared or family email account | Mitigated by discreet content (FR-NTF-05, FR-NTF-06). The email reveals only that an update exists |
| EC-48 | [R3] Crisis Protocol is not available at deployment time | The counseling module is not enabled in production (BR-68). Deployment gate |

### Cross-cutting

| ID | Condition | Required behaviour |
|---|---|---|
| EC-49 | A student's session expires mid-booking | On re-authentication, the student returns to the availability list, not to a stale slot. No booking is created from an expired session |
| EC-50 | A configuration value is changed while bookings exist under the old value | Existing bookings retain the terms under which they were made. The new value applies to bookings created after the change |
| EC-51 | Email delivery fails | The in-app notification remains available (FR-NTF-08). The failure is recorded and surfaced to the Administrator (FR-ADM-07) |
| EC-52 | A student has no registered email | In-app notification only. The system warns the student that they will not receive external reminders |
| EC-53 | The system undergoes maintenance during service hours | Prohibited. Maintenance shall occur outside service hours (NFR-AVL-02). If unavoidable, an announcement is published at least 24 hours ahead |
| EC-54 | Clock skew between client and server | All time-sensitive decisions (cutoffs, grace periods, expiry) are evaluated server-side against server time only |
| EC-55 | A student graduates with an open counseling case | The account deactivates but the case remains accessible to Counseling Professionals until closed. **Retention thereafter is governed by OI-02** |

---

## 3.7 Non-Functional Requirements

### 3.7.1 Performance

| ID | Requirement | Pri | Verification |
|---|---|---|---|
| NFR-PERF-01 | The public availability view shall reach first contentful paint within 3.0 s on a simulated 3G connection (1.6 Mbps down, 300 ms RTT) on a mid-range Android device | H | Lighthouse throttled audit |
| NFR-PERF-02 | The initial payload of any student-facing view shall not exceed 500 KB compressed | H | Build budget check |
| NFR-PERF-03 | A booking operation shall complete and confirm within 3.0 s at the 95th percentile under nominal load | H | Load test |
| NFR-PERF-04 | Every staff queue console operation — check-in, status advance, walk-in insertion — shall complete within 1.0 s at the 95th percentile | **C** | Load test; CON-01 |
| NFR-PERF-05 | A student's displayed queue position and estimate shall be no more than 30 s stale | H | Instrumented test |
| NFR-PERF-06 | Medicine search shall return results within 2.0 s at the 95th percentile | H | Load test |
| NFR-PERF-07 | The system shall sustain 500 concurrent authenticated students during a slot-release burst without any request exceeding 5 s 【A: OI-23】 | H | Load test |
| NFR-PERF-08 | The system shall support at least 2,000 distinct authenticated users per day and 20,000 registered accounts | H | Capacity test |

### 3.7.2 Availability & Reliability

| ID | Requirement | Pri |
|---|---|---|
| NFR-AVL-01 | The system shall achieve 99.0% availability during service hours (Sun–Thu 08:00–18:00 BST), measured monthly | H |
| NFR-AVL-02 | Planned maintenance shall occur outside service hours. Any exception requires an announcement published at least 24 hours in advance | H |
| NFR-AVL-03 | The system shall achieve 95.0% availability outside service hours | M |
| NFR-REL-01 | No confirmed booking, payment record, stock movement, or counseling case shall be lost as a result of a system failure | **C** |
| NFR-REL-02 | The system shall take an automated backup of all data at least daily, retained for at least 30 days | **C** |
| NFR-REL-03 | The system shall be restorable from backup within 4 hours, verified by a restore test at least once before go-live | C |
| NFR-REL-04 | Loss of network connectivity at the counter shall not corrupt system state. On reconnection the system shall accept same-day retrospective entries marked as such | **C** |
| NFR-REL-05 | The system shall degrade gracefully: failure of the notification subsystem shall not prevent booking, check-in, dispensing, or counseling intake | H |

### 3.7.3 Accuracy

| ID | Requirement | Pri |
|---|---|---|
| NFR-ACC-01 | The estimated time presented to a student shall be within ±15 minutes of the actual consultation start for at least 75% of appointments, measured weekly | H |
| NFR-ACC-02 | The system shall expose estimate accuracy as an operational metric visible to the Administrator | H |
| NFR-ACC-03 | Medicine Status Bands shall correctly reflect recorded stock at all times; a spot-check against physical stock shall show ≥90% agreement | H |
| NFR-ACC-04 | All monetary values shall be handled without floating-point rounding error | C |

### 3.7.4 Security

| ID | Requirement | Pri |
|---|---|---|
| NFR-SEC-01 | All traffic shall use HTTPS with TLS 1.2 or higher. Plain HTTP shall redirect, not serve | **C** |
| NFR-SEC-02 | Passwords, where used, shall be stored using a current password-hashing function with a per-credential salt. Plaintext or reversible storage is prohibited | **C** |
| NFR-SEC-03 | The system shall be free of the OWASP Top 10 (2021) vulnerability classes, verified before go-live | **C** |
| NFR-SEC-04 | The system shall rate-limit authentication attempts (FR-AUTH-14) and booking submissions to prevent automated abuse | C |
| NFR-SEC-05 | The system shall log all authentication events, authorisation denials, and access to another user's personal data | **C** |
| NFR-SEC-06 | Counseling case data shall be protected by an access control path independent of the general application permission check, such that a defect in the general check cannot expose it | **C** |
| NFR-SEC-07 | The system shall not expose internal identifiers, stack traces, or system detail in any error message shown to a user | C |
| NFR-SEC-08 | Session identifiers shall be regenerated on privilege change and invalidated on logout | C |
| NFR-SEC-09 | A security review shall be completed and passed before the counseling module processes any real student data | **C** |

### 3.7.5 Privacy & Confidentiality

| ID | Requirement | Pri |
|---|---|---|
| NFR-PRIV-01 | Personal data shall not be transmitted outside the system except to the data subject, or as required by DIU policy with recorded consent | **C** |
| NFR-PRIV-02 | The system shall apply data minimisation: no personal data shall be collected for which a Phase 1 requirement exists | C |
| NFR-PRIV-03 | No email shall contain personal health information, diagnosis, reason-for-visit, medicine name, counseling category, or urgency | **C** |
| NFR-PRIV-04 | The existence of a counseling record shall be inferable only by the subject student and Counseling Professionals (BR-50) | **C** |
| NFR-PRIV-05 | All student-facing copy shall be reviewed to ensure the system is never presented as an emergency or monitored service | **C** |
| NFR-PRIV-06 | No counseling data shall appear in any export, backup accessible to administrators in readable form, general audit log, or operational report in Phase 1 | **C** |
| NFR-PRIV-07 | The system shall present a plain-language confidentiality statement, before first counseling request submission, stating exactly who can see what | **C** |

### 3.7.6 Usability

| ID | Requirement | Pri |
|---|---|---|
| NFR-USE-01 | A Medical Center Staff member shall be able to check in an arriving student in a single interaction and within 15 seconds end to end, including identity verification | **C** |
| NFR-USE-02 | A Medical Center Staff member with no prior exposure shall be able to operate the queue console competently after no more than 30 minutes of training | **C** |
| NFR-USE-03 | The Store Operator shall be able to record a dispensing event in no more than 4 interactions | H |
| NFR-USE-04 | A student shall be able to complete a booking from the dashboard in no more than 5 interactions and within 60 seconds | H |
| NFR-USE-05 | A student shall be able to submit a counseling request in no more than 6 interactions, with only 2 mandatory fields | H |
| NFR-USE-06 | Every error message shall state what went wrong and what the user should do next, in plain language, without technical terms | H |
| NFR-USE-07 | All counseling-context copy shall be reviewed by a Counseling Professional for tone before release | **C** |
| NFR-USE-08 | Destructive or irreversible actions shall require explicit confirmation naming the consequence | H |

### 3.7.7 Accessibility

| ID | Requirement | Pri |
|---|---|---|
| NFR-A11Y-01 | All student-facing views shall conform to WCAG 2.1 Level AA [R5] | H |
| NFR-A11Y-02 | All functionality shall be operable by keyboard alone | H |
| NFR-A11Y-03 | Text shall meet a contrast ratio of at least 4.5:1; the crisis banner shall meet at least 7:1 | **C** |
| NFR-A11Y-04 | Status and availability shall never be conveyed by colour alone | H |
| NFR-A11Y-05 | The public queue display shall be legible at 3 metres on a 1280×720 screen | M |

### 3.7.8 Compatibility & Portability

| ID | Requirement | Pri |
|---|---|---|
| NFR-COMP-01 | The system shall function on Chrome, Firefox, Safari and Edge, current and previous major versions | H |
| NFR-COMP-02 | The system shall function on Android 8+ and iOS 13+ mobile browsers | H |
| NFR-COMP-03 | The system shall render without horizontal scrolling from 320 px viewport width upward | H |
| NFR-COMP-04 | No functionality shall require a browser plugin or a native application | H |

### 3.7.9 Auditability

| ID | Requirement | Pri |
|---|---|---|
| NFR-AUD-01 | Every state change shall be attributable to an identified actor. No anonymous state change shall be possible | **C** |
| NFR-AUD-02 | Audit records shall be append-only and immutable to every role (BR-61) | **C** |
| NFR-AUD-03 | Audit records shall be retained for at least 3 years 【A: OI-02】 | C |
| NFR-AUD-04 | The system shall be able to answer, for any counseling case, who accessed it and when, for the full retention period | **C** |

### 3.7.10 Maintainability & Supportability

| ID | Requirement | Pri |
|---|---|---|
| NFR-MNT-01 | All values marked 【A】 and all operational parameters shall be changeable through configuration without redeployment (FR-ADM-01, BR-70) | **C** |
| NFR-MNT-02 | The system shall expose operational health indicators to the Administrator (FR-ADM-07) | M |
| NFR-MNT-03 | The system shall produce structured application logs sufficient to diagnose a failed booking, check-in or dispensing event, without those logs containing counseling content or personal health information | C |
| NFR-MNT-04 | User documentation shall be provided for each role before go-live | H |
| NFR-MNT-05 | A documented support and incident procedure shall exist before go-live, naming the responsible party and response expectation 【A: OI-24】 | H |

### 3.7.11 Data Retention

| ID | Requirement | Pri |
|---|---|---|
| NFR-RET-01 | Pending approval of [R4], the system shall retain all records indefinitely and shall delete nothing. No automated deletion shall be implemented in Phase 1 | **C** |
| NFR-RET-02 | The system shall be capable of enumerating all records relating to a single student, to support a future retention or erasure policy | C |
| NFR-RET-03 | Deactivation of a student account shall not delete any record | C |

### 3.7.12 Localisation

| ID | Requirement | Pri |
|---|---|---|
| NFR-LOC-01 | All user-facing text shall be externalised from application logic to permit later translation without code change | H |
| NFR-LOC-02 | Phase 1 shall ship in English only (ASM-15, OI-13) | H |
| NFR-LOC-03 | The system shall correctly render Bangla text entered by users in free-text fields, including in counseling notes | H |

---

# 4. User Stories and Acceptance Criteria

Acceptance criteria are expressed as Given/When/Then and constitute the Phase 1 test basis.

## 4.1 Student — Medical Service

---
**US-01** — *As a student feeling unwell, I want to see which doctors are on duty right now without logging in, so that I can decide whether it is worth travelling to the Medical Center.*
**Traces:** FR-DASH-06, FR-DASH-07, FR-UI-05, NFR-PERF-01

- **AC-01.1** Given I am not logged in, When I open the public view, Then I see every doctor on duty today with their duty times and current availability state.
- **AC-01.2** Given I am not logged in, When I view the public view, Then I see no patient name, no appointment detail, and no counseling information anywhere.
- **AC-01.3** Given a 3G connection on a mid-range Android device, When I open the public view, Then first contentful paint occurs within 3 seconds.
- **AC-01.4** Given today is a declared non-service day, When I open the public view, Then I see that the Medical Center is closed and the stated reason.

---
**US-02** — *As a student, I want to book a slot with a specific doctor from my phone, so that I do not have to travel just to get a serial.*
**Traces:** FR-APT-01…07, VR-20…VR-25, NFR-USE-04

- **AC-02.1** Given I am logged in and a session has available slots, When I select a slot and confirm, Then I receive an Appointment ID, a Serial Number, the doctor, the date and an estimated time.
- **AC-02.2** Given I complete a booking, When I view the confirmation, Then the time is labelled as an estimate and the interface never uses wording implying a guaranteed time.
- **AC-02.3** Given I am booking, When I view a session, Then I see how many slots are booked and how many remain, and no patient identities.
- **AC-02.4** Given I already hold 2 active bookings, When I attempt a third, Then the booking is rejected and my existing bookings are listed.
- **AC-02.5** Given I already hold a booking with Dr. A on 10 Aug, When I attempt a second booking with Dr. A on 10 Aug, Then it is rejected.
- **AC-02.6** Given the booking cutoff for a session has passed, When I attempt to book it, Then the slot is not offered.
- **AC-02.7** Given I start from the dashboard, When I complete a booking, Then it required no more than 5 interactions.

---
**US-03** — *As a student, I want to see how many patients are ahead of me and how long the wait is likely to be, so that I can leave my hall at the right time.*
**Traces:** FR-APT-19…FR-APT-24, NFR-PERF-05, NFR-ACC-01

- **AC-03.1** Given I hold an active booking in a live session, When I open my appointment, Then I see my serial, the number of patients ahead of me, and a current estimated time.
- **AC-03.2** Given a consultation completes, When I next view my appointment, Then my queue position and estimate have been recalculated, and the displayed data is no more than 30 seconds stale.
- **AC-03.3** Given 2 patients remain ahead of me, When that state is reached, Then I receive a notification stating the approximate remaining wait.
- **AC-03.4** Given my estimate moves later by more than 30 minutes from the estimate at booking, When that occurs, Then I receive a delay notification stating the revised estimate.
- **AC-03.5** Given a walk-in is inserted ahead of me, When that occurs, Then my estimate is recalculated within 30 seconds.

---
**US-04** — *As a student whose plans changed, I want to cancel my booking, so that another student can take the slot.*
**Traces:** FR-APT-15…FR-APT-18, VR-26, EC-17

- **AC-04.1** Given I hold a booking that has not started, When I cancel it, Then the booking is cancelled and I receive confirmation.
- **AC-04.2** Given I cancel, When the cancellation completes, Then the slot becomes immediately available to other students.
- **AC-04.3** Given I cancel less than 2 hours before my estimated time, When it completes, Then it is recorded as a Late Cancellation.
- **AC-04.4** Given I cancel at any time, When it completes, Then no No-show penalty is applied.
- **AC-04.5** Given I have already been checked in, When I attempt to cancel, Then cancellation is rejected and I am directed to speak to staff.

---
**US-05** — *As a student, I want to be told promptly if my doctor becomes unavailable, so that I do not travel for nothing.*
**Traces:** FR-SCH-06…FR-SCH-09, BR-26, BR-27

- **AC-05.1** Given staff mark my doctor unavailable, When they confirm, Then my booking is cancelled with reason `Doctor Unavailable`.
- **AC-05.2** Given my booking is cancelled for this reason, When it occurs, Then I am notified within 5 minutes on every channel I have enabled.
- **AC-05.3** Given I am notified, When I open the notification, Then I am shown the remaining alternative availability.
- **AC-05.4** Given my booking was cancelled for this reason, When my record is examined, Then no No-show or penalty is recorded against me.

---
**US-06** — *As a student who repeatedly missed appointments, I want to understand why I can no longer book, and to know I can still receive care.*
**Traces:** FR-APT-12…FR-APT-14, BR-15

- **AC-06.1** Given I have 3 No-show records within 30 days, When the third is recorded, Then my online booking is suspended for 14 days.
- **AC-06.2** Given my booking is suspended, When I am notified, Then the notification states the reason, the end date, and that I can still attend as a walk-in.
- **AC-06.3** Given I am under suspension, When I attempt to book online, Then it is rejected with the same information.
- **AC-06.4** Given I am under suspension, When I arrive at the Medical Center, Then staff can register me as a walk-in without any restriction.

## 4.2 Student — Medicine Service

---
**US-07** — *As a student, I want to check whether a medicine is in stock before I travel to the store.*
**Traces:** FR-MED-01…FR-MED-08, NFR-PERF-06, EC-33

- **AC-07.1** Given I search a brand name, When results return, Then items catalogued under the corresponding generic name are also returned, and vice versa.
- **AC-07.2** Given a result is displayed, When I read it, Then I see name, strength, form, Status Band, OTC/Prescription indicator, and an "as of HH:MM" stamp.
- **AC-07.3** Given a result is displayed, When I read it, Then no exact quantity appears anywhere.
- **AC-07.4** Given a result is displayed, When I read it, Then a statement that stock is not reserved is visible alongside the status.
- **AC-07.5** Given the item is Prescription-only, When I view it, Then I see "Requires a doctor's prescription" and no wording implying I may simply collect it.
- **AC-07.6** Given my query matches nothing, When results return, Then the system distinguishes "not in the DIU catalogue" from "out of stock".
- **AC-07.7** Given I submit a search, When results return, Then they arrive within 2 seconds at the 95th percentile.

---
**US-08** — *As a student, I want to know whether the store is open and when it closes, so that I can plan around my classes.*
**Traces:** FR-MED-08, FR-MED-25…FR-MED-27, BR-42

- **AC-08.1** Given I view the medicine section, When it loads, Then I see the store's current open/closed state, today's hours and today's closing time.
- **AC-08.2** Given no manual override is active, When I view the state, Then it is derived from the scheduled hours.
- **AC-08.3** Given the operator has applied a manual closure override, When I view the state, Then it shows closed with the operator's stated reason.
- **AC-08.4** Given an override was applied yesterday, When I view the state today, Then the override has expired and scheduled hours apply.

## 4.3 Student — Counseling Service

---
**US-09** — *As a student in distress, I want to see immediately how to get urgent help, before I do anything else.*
**Traces:** FR-CNS-03…FR-CNS-06, NFR-A11Y-03, CON-15 — **Priority C**

- **AC-09.1** Given I open any counseling screen, whether logged in or not, When it loads, Then the crisis-resources banner is visible without scrolling at every supported viewport width.
- **AC-09.2** Given I reach the request submission point, When it loads, Then a notice states that this is not an emergency service, states the office hours during which requests are reviewed, and states what to do if I need help now.
- **AC-09.3** Given I select the highest urgency level, When I attempt to submit, Then an interstitial presents the crisis resources and offers both "contact now" and "continue with request" before the request is accepted.
- **AC-09.4** Given the interstitial was not presented and acknowledged, When a high-urgency request reaches the server, Then it is rejected.
- **AC-09.5** Given the crisis banner is rendered, When contrast is measured, Then it meets at least 7:1.
- **AC-09.6** Given [R3] is not available, When deployment is attempted, Then the counseling module is not enabled.

---
**US-10** — *As a student, I want to request counseling without a long form, and know it was received.*
**Traces:** FR-CNS-07…FR-CNS-11, NFR-USE-05, VR-70…VR-75

- **AC-10.1** Given I submit a request, When I complete it, Then only category and urgency were mandatory.
- **AC-10.2** Given I submit a request, When it is accepted, Then I receive an acknowledgement within 1 minute.
- **AC-10.3** Given I receive the acknowledgement, When I read it, Then it restates the triage SLA and the crisis resources.
- **AC-10.4** Given I submit a request, When I complete it, Then it required no more than 6 interactions.
- **AC-10.5** Given I may state a counselor gender preference, When I submit, Then the preference is recorded but not presented to me as a guarantee.
- **AC-10.6** Given I have a request in `Requested` or `Under Review`, When I submit another, Then it is rejected with supportive wording directing me to my existing request.

---
**US-11** — *As a student, I want to see the status of my request, so that I am not waiting in silence.*
**Traces:** FR-CNS-11, FR-CNS-12, BR-63, FR-DASH-05

- **AC-11.1** Given I have submitted a request, When I open my dashboard, Then I see its current status.
- **AC-11.2** Given a counselor has recorded notes or triage reasoning, When I view my request, Then none of that content is visible to me.
- **AC-11.3** Given I hold a counseling request, When any non-counseling user views any interface, Then nothing reveals that I hold one.

---
**US-12** — *As a student, I want to receive session details without my phone announcing that I am seeing a counselor.*
**Traces:** FR-NTF-05, FR-NTF-06, FR-NTF-09, BR-53 — **Priority C**

- **AC-12.1** Given a counseling session is scheduled for me, When the email arrives, Then neither the subject line nor the preview text contains the words identifying the counseling or psychiatric service.
- **AC-12.2** Given the counseling email arrives, When I read the body, Then it states only that an update is available and directs me to log in.
- **AC-12.3** Given any counseling notification, When examined, Then it contains no category, no urgency, no clinical term, and no counselor specialisation.

---
**US-13** — *As a student who could not attend a counseling session, I want to not be penalised for it.*
**Traces:** FR-CNS-17, EC-42 — **Priority C**

- **AC-13.1** Given I miss a scheduled counseling session, When it is recorded, Then no suspension, restriction or penalty is applied to my account.
- **AC-13.2** Given I miss a session, When I next use the system, Then I can submit a further request without impediment.

## 4.4 Medical Center Staff

---
**US-14** — *As reception staff, I want to see the whole day's queue on one screen, so that I can run the session without a paper register.*
**Traces:** FR-APT-26, FR-APT-28, FR-APT-30, NFR-PERF-04

- **AC-14.1** Given I open the console, When it loads, Then I see every session for today across all doctors, each with its ordered queue.
- **AC-14.2** Given I view a session, When I read it, Then I see which serial is currently In Consultation.
- **AC-14.3** Given I perform any queue operation, When it completes, Then it completed within 1 second at the 95th percentile.

---
**US-15** — *As reception staff, I want to check in an arriving student in one action, so that the queue does not back up.*
**Traces:** FR-APT-27, FR-APT-29, NFR-USE-01, BR-65, VR-27

- **AC-15.1** Given a booked student arrives, When I check them in, Then their status moves from Booked to Checked In in a single interaction.
- **AC-15.2** Given I check in a student, When measured end to end including ID verification, Then it completes within 15 seconds.
- **AC-15.3** Given a student's appointment is not for today, When I attempt check-in, Then it is rejected with the reason stated.
- **AC-15.4** Given the session has already ended, When I attempt check-in, Then it is rejected with the reason stated.

---
**US-16** — *As reception staff, I want to add a walk-in patient to the queue quickly, so that the system reflects who is actually waiting.*
**Traces:** FR-APT-35…FR-APT-38, FR-APT-42, EC-09, EC-10 — **Priority C**

- **AC-16.1** Given a student arrives without a booking, When I register them as a walk-in, Then the form has no more than 3 mandatory fields.
- **AC-16.2** Given I register a walk-in, When it completes, Then they receive a serial continuing the session's sequence and are placed at the end of the queue.
- **AC-16.3** Given I register a walk-in, When it completes, Then every waiting student's estimate is recalculated within 30 seconds.
- **AC-16.4** Given the walk-in allocation is exhausted, When I register another walk-in, Then it succeeds and the console shows that the allocation was exceeded.
- **AC-16.5** Given the student is under a booking suspension, When I register them as a walk-in, Then it succeeds without restriction.

---
**US-17** — *As reception staff, I want to prioritise a genuine emergency, and have waiting students told why they are waiting longer.*
**Traces:** FR-APT-39…FR-APT-41, BR-17, BR-69, EC-11, EC-12

- **AC-17.1** Given an emergency arrives, When I mark the entry Emergency, Then it moves to the head of the queue ahead of all waiting patients.
- **AC-17.2** Given I mark an Emergency, When I submit, Then a reason of at least 10 characters was mandatory.
- **AC-17.3** Given an emergency is inserted, When it completes, Then every waiting patient in that session is notified that an emergency has been prioritised and given a revised estimate.
- **AC-17.4** Given the emergency notification is sent, When a student reads it, Then it contains no identifying detail about the emergency patient.
- **AC-17.5** Given multiple emergencies within 15 minutes, When notifications are generated, Then each waiting student receives at most one delay notification in that window.

---
**US-18** — *As reception staff, I want to record that a booked student did not turn up, but only after a fair grace period.*
**Traces:** FR-APT-31, FR-APT-32, VR-31, EC-07, EC-08

- **AC-18.1** Given a booked student has been called, When fewer than 20 minutes have elapsed, Then I cannot mark them No-show and the remaining time is shown.
- **AC-18.2** Given 20 minutes have elapsed, When I mark them No-show, Then the status is recorded with me as the actor.
- **AC-18.3** Given the system is running, When any appointment reaches its estimated time, Then the system never marks it No-show automatically.
- **AC-18.4** Given a student arrives after being marked No-show, When I register them as a walk-in, Then it succeeds.

---
**US-19** — *As reception staff, I want to take a doctor off duty and have every affected student handled correctly, without me contacting each one.*
**Traces:** FR-SCH-06…FR-SCH-09, BR-26, BR-27

- **AC-19.1** Given I mark a doctor unavailable for a date with existing bookings, When I submit, Then I am shown the full list of affected bookings before anything is committed.
- **AC-19.2** Given I confirm, When it completes, Then every affected booking is cancelled with reason `Doctor Unavailable`.
- **AC-19.3** Given the cancellations occur, When measured, Then every affected student is notified within 5 minutes.
- **AC-19.4** Given I do not confirm, When I abandon the operation, Then no booking is altered and the doctor's availability is unchanged.
- **AC-19.5** Given the change takes effect within 24 hours, When I submit, Then a reason of at least 10 characters was mandatory.

---
**US-20** — *As reception staff, I want to record the consultation fee and reconcile the day's cash.*
**Traces:** FR-PAY-02…FR-PAY-10, VR-40…VR-44, EC-22, EC-23

- **AC-20.1** Given a student pays at the counter, When I record it, Then the appointment's payment status becomes Paid and a receipt number is captured.
- **AC-20.2** Given a receipt number already used today, When I record it again, Then it is rejected.
- **AC-20.3** Given an appointment is Unpaid, When I attempt to advance it to In Consultation, Then it is blocked unless I record an override reason.
- **AC-20.4** Given the day ends, When I open the collection summary, Then I see every payment, the total, the count and the breakdown by staff member.
- **AC-20.5** Given counted cash differs from the system total, When I record the reconciliation, Then a discrepancy reason of at least 10 characters is mandatory and the system total is not altered.
- **AC-20.6** Given a payment was recorded in error, When I correct it, Then an adjusting entry is created and the original remains visible.

---
**US-21** — *As reception staff, I want the system to keep working when the network drops.*
**Traces:** NFR-REL-04, BR-66, EC-18, EC-19

- **AC-21.1** Given the network drops mid-session, When connectivity returns, Then no system state has been corrupted.
- **AC-21.2** Given I recorded events on paper during the outage, When I enter them afterwards, Then same-day retrospective entries are accepted and marked as entered retrospectively.
- **AC-21.3** Given another staff member modified the same appointment while I was offline, When my write is submitted, Then it is rejected and the current state is re-presented rather than silently overwritten.

## 4.5 Store Operator

---
**US-22** — *As the store operator, I want to record new stock with its batch and expiry, so that expired medicine is never dispensed.*
**Traces:** FR-MED-12, FR-MED-13, FR-MED-16…FR-MED-18, VR-52…VR-54

- **AC-22.1** Given I record a stock receipt, When I submit, Then item, quantity, batch identifier and expiry date were all mandatory.
- **AC-22.2** Given I enter an expiry date on or before today, When I submit, Then it is rejected.
- **AC-22.3** Given a batch's expiry date passes, When the daily recalculation runs at 00:01, Then that batch is excluded from dispensable quantity and the Status Band updates.
- **AC-22.4** Given a batch is expired, When I attempt to dispense from it, Then it is rejected with no override available.
- **AC-22.5** Given all batches of an item are expired, When a student searches it, Then the Status Band shows Out of Stock.

---
**US-23** — *As the store operator, I want to dispense the earliest-expiring stock first, and record it quickly.*
**Traces:** FR-MED-14, FR-MED-15, FR-MED-20, FR-MED-24, NFR-USE-03, VR-55…VR-58

- **AC-23.1** Given I record a dispensing event, When the batch selector loads, Then the earliest-expiring non-expired batch is proposed by default.
- **AC-23.2** Given I select a different batch, When I submit, Then a reason of at least 10 characters is mandatory.
- **AC-23.3** Given I record a dispensing event, When measured, Then it took no more than 4 interactions.
- **AC-23.4** Given I dispense more than the configured 24-hour per-student limit, When I submit, Then an override reason is mandatory and is recorded.
- **AC-23.5** Given I dispense more than the batch's remaining quantity, When I submit, Then it is rejected with the available quantity stated.

---
**US-24** — *As the store operator, I want to be told before something runs out.*
**Traces:** FR-MED-22, FR-MED-23, FR-NTF-04

- **AC-24.1** Given an item's dispensable quantity falls to or below its threshold, When that occurs, Then I receive a low-stock notification.
- **AC-24.2** Given an item remains below threshold across a day, When notifications are generated, Then I receive at most one per item per day.
- **AC-24.3** Given I set a threshold, When I submit a negative value, Then it is rejected.

---
**US-25** — *As the store operator, I want to correct a mistake without erasing the record of it.*
**Traces:** FR-MED-19…FR-MED-21, VR-59, EC-30

- **AC-25.1** Given I made a data-entry error, When I correct it, Then an adjustment movement is created with a reason category and detail of at least 10 characters.
- **AC-25.2** Given a stock movement exists, When I attempt to edit or delete it, Then it is rejected for every role including Administrator.
- **AC-25.3** Given any stock movement, When I view the movement log, Then I see who, what item, which batch, how much, in which direction, why, and when.

## 4.6 Counseling Professional

---
**US-26** — *As a counselor, I want to see every waiting request ordered by priority, so that I know my workload and who needs attention first.*
**Traces:** FR-CSE-01, FR-CSE-02, FR-CSE-17, FR-CSE-22

- **AC-26.1** Given requests exist, When I open the triage queue, Then they are ordered by priority descending, then by waiting time descending.
- **AC-26.2** Given a request has breached its triage SLA, When I view the queue, Then it is visually distinguished.
- **AC-26.3** Given I open my caseload summary, When it loads, Then I see counts of open cases, requests pending triage, and cases with overdue follow-up.
- **AC-26.4** Given a new request is submitted, When it enters the system, Then it is visible to every Counseling Professional, not assigned to an individual.

---
**US-27** — *As a counselor, I want to set the final priority myself, because the student's self-assessment is only one input.*
**Traces:** FR-CNS-09, FR-CSE-03…FR-CSE-06, BR-45, VR-76 — **Priority C**

- **AC-27.1** Given a student submitted a self-reported urgency, When the request appears, Then the initial priority is marked provisional.
- **AC-27.2** Given I set the final priority, When I submit, Then a reason of at least 10 characters is mandatory.
- **AC-27.3** Given a non-Counseling-Professional attempts to set a priority, When the request reaches the server, Then it is rejected and logged.
- **AC-27.4** Given a priority is changed, When examined in the audit trail, Then the actor, previous value, new value, reason and timestamp are all present.

---
**US-28** — *As a counselor, I want to be told immediately about a high-urgency request during working hours.*
**Traces:** FR-CSE-08, FR-CSE-09, FR-CNS-10, EC-36, EC-41

- **AC-28.1** Given a request with the highest self-reported urgency is submitted, When it is accepted, Then all Counseling Professionals are notified within 1 minute.
- **AC-28.2** Given a request is submitted outside office hours, When it is accepted, Then the student's acknowledgement restates the office-hours limitation and the crisis resources.
- **AC-28.3** Given a request breaches its triage SLA, When the daily check runs, Then all Counseling Professionals are notified.
- **AC-28.4** Given the system notifies a counselor, When the notification is examined, Then the system has made no clinical judgement and has taken no action on the case itself.

---
**US-29** — *As a counselor, I want my session notes to be readable by nobody but counseling professionals.*
**Traces:** FR-CSE-12…FR-CSE-16, PRM-05…PRM-09, NFR-SEC-06 — **Priority C**

- **AC-29.1** Given I record session notes, When any Medical Center Staff, Store Operator, Doctor or Administrator attempts to read them, Then access is denied and the attempt is logged.
- **AC-29.2** Given a counseling case exists, When an Administrator examines any interface, export, log, count or search, Then nothing reveals that the student holds a counseling case.
- **AC-29.3** Given anyone reads a counseling case, When the access log is examined, Then the accessing user, case identifier and timestamp are recorded.
- **AC-29.4** Given the counseling access log exists, When an Administrator attempts to read it, Then access is denied.
- **AC-29.5** Given a user holds both Medical Center Staff and Counseling Professional roles, When they operate in the staff context, Then no counseling data appears.
- **AC-29.6** Given a general permission check were to fail, When counseling data is requested, Then a second independent access control path still denies it.

---
**US-30** — *As a counselor, I want to schedule a session and track the case through to closure.*
**Traces:** FR-CNS-14…FR-CNS-16, FR-CSE-10, FR-CSE-11, FR-CSE-20, VR-77, VR-78

- **AC-30.1** Given a request under review, When I schedule a session, Then date, time, duration and mode are captured and the student is notified with discreet content.
- **AC-30.2** Given I schedule outside a published availability window, When I submit, Then a reason is mandatory.
- **AC-30.3** Given a case progresses, When I open its timeline, Then every status change is shown with actor and timestamp.
- **AC-30.4** Given I close a case, When I submit, Then a closure reason is mandatory.
- **AC-30.5** Given a case has had no activity for 90 days, When the inactivity check runs, Then it is closed with reason Inactive, I am notified, and the student is not.

---
**US-31** — *As a counselor, I want a way to invoke our escalation protocol and have it recorded.*
**Traces:** FR-CSE-18, FR-CSE-19, BR-57, BR-67 — **Priority C**

- **AC-31.1** Given a case requires escalation, When I invoke the escalation workflow, Then the invocation is recorded with actor, case and timestamp.
- **AC-31.2** Given the system is operating, When any case is evaluated, Then the system never infers risk, never sets priority automatically, and never invokes escalation without a human actor.
- **AC-31.3** Given [R3] defines the escalation steps, When the workflow is invoked, Then the system presents those steps as authored, without modification.

## 4.7 System Administrator

---
**US-32** — *As an administrator, I want to manage accounts and roles without ever being able to read counseling records.*
**Traces:** FR-AUTH-10…FR-AUTH-12, PRM-08, PRM-09, PRM-13, FR-AUD-05…FR-AUD-07 — **Priority C**

- **AC-32.1** Given I am an Administrator, When I manage accounts, Then I can create, suspend, deactivate and assign roles, and every such action is audited.
- **AC-32.2** Given I am an Administrator, When I attempt to read counseling content by any route, Then access is denied and logged.
- **AC-32.3** Given I invoke break-glass, When I submit, Then a justification of at least 20 characters is mandatory.
- **AC-32.4** Given I invoke break-glass, When it is granted, Then the counseling service head is notified immediately.
- **AC-32.5** Given break-glass access is granted, When 60 minutes elapse, Then it expires and cannot be renewed without a new justification.

---
**US-33** — *As an administrator, I want to change operational parameters without a code release.*
**Traces:** FR-ADM-01, FR-ADM-02, BR-70, NFR-MNT-01, EC-50

- **AC-33.1** Given any parameter marked 【A】 in this specification, When I change it in configuration, Then it takes effect without redeployment.
- **AC-33.2** Given I change a parameter, When it is saved, Then the actor, previous value, new value and timestamp are recorded.
- **AC-33.3** Given I enter a value outside the permitted range, When I save, Then it is rejected at save time.
- **AC-33.4** Given bookings exist under the previous value, When the parameter changes, Then those bookings retain the terms under which they were made.

---
**US-34** — *As an administrator, I want an audit trail nobody can alter.*
**Traces:** FR-AUD-01…FR-AUD-04, FR-ADM-05, FR-ADM-06, BR-60, BR-61 — **Priority C**

- **AC-34.1** Given any state change occurs, When the audit log is examined, Then actor, timestamp, previous state and new state are present.
- **AC-34.2** Given an audit entry exists, When any role including Administrator attempts to modify or delete it, Then the operation is rejected.
- **AC-34.3** Given I open the audit log viewer, When counseling entries appear, Then they show only non-identifying activity records without case or student identifiers.
- **AC-34.4** Given I export data, When the export completes, Then it contains no counseling data.

---
**US-35** — *As an administrator, I want to export operational data so the Medical Center Director can see what the service is actually doing.*
**Traces:** FR-ADM-08, FR-ADM-09, CON-09, BG7

- **AC-35.1** Given I select a date range, When I export, Then appointment, queue, fee and inventory data are produced in a machine-readable format.
- **AC-35.2** Given the export completes, When examined, Then no counseling data of any kind is present.
- **AC-35.3** Given the export completes, When examined, Then it contains sufficient detail to compute consultation volume, peak hours, No-show rate, median wait, and medicine consumption.

## 4.8 Doctor

---
**US-36** — *As a doctor, I want to know who is next without logging into anything.*
**Traces:** FR-UI-04, FR-APT-30, CON-02

- **AC-36.1** Given a session is live, When the public queue display is shown, Then it shows the serial currently In Consultation for each doctor.
- **AC-36.2** Given the public queue display is shown, When examined, Then it contains no patient name or identifier.
- **AC-36.3** Given the public queue display is shown on a 1280×720 screen, When viewed from 3 metres, Then it is legible.
- **AC-36.4** Given no doctor ever logs in, When a full session is run, Then every Phase 1 function operates correctly.

---

# 5. Requirement Traceability

## 5.1 Business Goal → Requirements

| Goal [R1] §6 | Measure | Requirements |
|---|---|---|
| BG1 ≥60% consultations from online booking | % online-originated | FR-APT-01…07, FR-DASH-06, NFR-PERF-01, NFR-USE-04 |
| BG2 ↓40% median wait | Median arrival-to-consultation | FR-APT-19…25, FR-APT-26…34, NFR-ACC-01 |
| BG3 ↑50% store utilisation | Dispensing events/month | FR-MED-01…09, FR-MED-14, FR-MED-20 |
| BG4 100% counseling acknowledgement | % within 1 working day | FR-CNS-10, FR-CSE-07…09 |
| BG5 ≤5 days to counseling session | Median request→scheduled | FR-CSE-01…09, FR-CNS-14 |
| BG6 Zero confidentiality incidents | Confirmed incidents | FR-CSE-13…16, PRM-05…14, NFR-SEC-06, NFR-PRIV-01…07 |
| BG7 Monthly report produced | 12/12 months | FR-ADM-08, FR-APT-25, FR-MED-20, FR-PAY-08 |
| BG8 ↓30% expiry write-off | Value written off | FR-MED-12…19 (Phase 1 captures the data; alerting is Phase 2) |
| BG9 ≥25% monthly active students | MAU / enrolled | FR-DASH-01…08, NFR-PERF-01…02, NFR-COMP-01…04 |
| BG10 ≥4.0/5.0 satisfaction | Survey | NFR-USE-01…08, NFR-ACC-01, FR-APT-24 |

## 5.2 Planning feature ID → SRS requirement

| [R1] Feature | SRS requirements | Phase |
|---|---|---|
| F-AUTH-01…08 | FR-AUTH-01…15 | 1 |
| F-AUTH-09 | FR-AUD-05…07, PRM-14 | 1 |
| F-AUTH-10 | — | 2 |
| F-DASH-01, 02, 04, 05, 07 | FR-DASH-01…08 | 1 |
| F-DASH-03, 06 | — | 2 |
| F-SCH-01…08, 10 | FR-SCH-01…16 | 1 |
| F-SCH-09 | — | 2 |
| F-APT-01…04, 06, 09…14, 16, 17 | FR-APT-01…42 | 1 |
| F-APT-15 | FR-UI-04, FR-APT-30 | 1 |
| F-APT-05, 07, 08 | FR-APT-23, FR-APT-24 (07/08 in Phase 1); reschedule (05) → Phase 2 | 1 / 2 |
| F-APT-18, 19 | — | 2 |
| F-PAY-01…05 | FR-PAY-01…10 | 1 |
| F-PAY-06…08 | FR-PAY-11 (explicit exclusion) | 3 |
| F-MED-01…10, 14, 15 | FR-MED-01…28 | 1 |
| F-MED-11, 12 | Data captured (FR-MED-12/13/16/17); alerting & write-off workflow → Phase 2 | 1 / 2 |
| F-MED-13 | FR-MED-15 (FEFO pulled forward — see Appendix B, D-2) | 1 |
| F-MED-16…19 | — | 2 / 3 |
| F-CNS-01…08 | FR-CNS-01…17 | 1 |
| F-CNS-09…12 | FR-CNS-15 (reminder in Phase 1); 10/11/12 → Phase 2 | 1 / 2 |
| F-CSE-01…06, 08, 10, 11 | FR-CSE-01…23 | 1 |
| F-CSE-07, 09, 12, 13 | — | 2 |
| F-NTF-01…04, 06, 07 | FR-NTF-01…09 | 1 |
| F-NTF-05, 08, 09, 10 | FR-NTF-07, 08 (10 partial); 05/08/09 → Phase 2/3 | 1 / 2 |
| F-ADM-01, 02, 04 | FR-ADM-01…06 | 1 |
| F-ADM-03 | FR-ADM-04, FR-DASH-08 | 1 |
| F-ADM-08 | FR-ADM-08, 09 | 1 |
| F-ADM-05, 06, 07, 09, 10 | — | 2 |

## 5.3 Risk → mitigating requirement

| [R1] Risk | Mitigating requirements |
|---|---|
| R1 Crisis request unanswered out of hours | FR-CNS-03…06, FR-CNS-10, FR-CSE-08, BR-68, EC-36, EC-48, US-09 |
| R2 Counseling data exposed | FR-CSE-13…16, PRM-05…14, NFR-SEC-06, NFR-PRIV-04, NFR-PRIV-06, US-29 |
| R3 Staff revert to paper | FR-APT-35…42, NFR-PERF-04, NFR-USE-01, NFR-USE-02, NFR-REL-04, US-15, US-16 |
| R4 Demand exceeds capacity | FR-SCH-04, FR-SCH-05, BR-16, FR-APT-42, ASM-13 |
| R5 Stale inventory data | FR-MED-04, FR-MED-17, NFR-USE-03, NFR-ACC-03 |
| R6 Doctors do not engage | FR-UI-04, FR-SCH-02, CON-02, AC-36.4 |
| R7 Estimates untrusted | FR-APT-08, FR-APT-21, FR-APT-22, FR-APT-24, NFR-ACC-01, NFR-ACC-02 |
| R10 EMR scope creep | §1.2.3, FR-CSE-19, FR-MED-28 |
| R11 SSO stalls | FR-AUTH-01 fallback, OI-03 |
| R12 Speculative booking / no-shows | FR-APT-09…14, BR-11, BR-15 |
| R13 Cash reconciliation dispute | FR-PAY-08…10, VR-43, EC-22 |
| R14 Notification leak | FR-NTF-05, FR-NTF-06, FR-NTF-09, EC-47 |
| R15 Impersonation | BR-65, FR-AUTH-15, FR-AUD-03 |
| R16 Poor low-end performance | NFR-PERF-01, NFR-PERF-02, NFR-COMP-02, NFR-COMP-03 |
| R18 Re-identification in reporting | FR-ADM-09, NFR-PRIV-06 |
| R20 Feedback becomes doctor rating | Feedback deferred to Phase 2; no per-provider rating requirement exists |

## 5.4 Constraint → responding requirements

See §2.5, which states this mapping inline for CON-01 … CON-15.

## 5.5 Coverage summary

| Category | Count | All traced to a source? |
|---|---|---|
| Functional requirements | 178 | Yes — [R1] feature ID or a §19/§20 item |
| Non-functional requirements | 58 | Yes |
| Business rules | 70 (64 inherited + 6 new) | Yes |
| Validation rules | 63 | Yes |
| Permission requirements | 15 | Yes |
| Edge cases | 55 | Yes |
| User stories | 36 | Yes |
| Acceptance criteria | 172 | Yes — each traces to ≥1 FR/NFR |
| Open items | 24 | Registered in §6 |

**Orphan check:** every Phase 1 feature in [R1] §22.2 maps to at least one requirement in §3.2 (see §5.2). Every requirement in §3.2 traces to a [R1] feature ID, a [R1] §19 business-logic gap, or a [R1] §20 improvement. No untraced requirements exist.

---

# 6. Open Items Register

Every value or decision assumed in this SRS. Each is implemented as configuration (BR-70) so that a DIU decision changes a setting, not the code — **except OI-01, OI-02, OI-03, OI-04 and OI-22, which are structural and must be resolved before the affected work begins.**

| ID | Open item | Assumed value in this SRS | Owner | Blocking? | Affects |
|---|---|---|---|---|---|
| **OI-01** | Crisis & escalation protocol content [R3] | **None assumed. Cannot be invented** | Counseling service | ⚠ **Blocks counseling module** | FR-CNS-03…06, FR-CSE-18, BR-68 |
| **OI-02** | Data retention & disposal policy [R4] | Retain indefinitely; delete nothing | DIU Administration | ⚠ Blocks any deletion feature | NFR-RET-01…03, NFR-AUD-03, EC-55 |
| **OI-03** | Identity approach — SSO or standalone credentials | SSO preferred, email+password fallback | DIU IT | ⚠ **Blocks FR-AUTH-\*** | FR-AUTH-01, FR-SI-01 |
| **OI-04** | Single or multiple Medical Centers | Single | Medical Center | ⚠ **Blocks FR-SCH-\*, FR-MED-\*** | CON-13, ASM-01 |
| OI-05 | Slot length | 10 minutes | Medical Center | No | FR-SCH-04, FR-APT-22 |
| OI-06 | Walk-in allocation | 30% of session capacity | Medical Center | No | FR-SCH-04, BR-16 |
| OI-07 | Booking publication window | 7 days | Medical Center | No | FR-SCH-12, BR-10 |
| OI-08 | Maximum active bookings per student | 2; 1 per doctor per day | Medical Center | No | FR-APT-09, FR-APT-10 |
| OI-09 | Cancellation cutoff / slip threshold | 2 hours / 30 minutes | Medical Center | No | FR-APT-16, FR-APT-24 |
| OI-10 | No-show grace, threshold, suspension | 20 min / 3 in 30 days / 14 days | Medical Center | No | FR-APT-12, FR-APT-31 |
| OI-11 | Working days definition | Sunday–Thursday | DIU Administration | No | FR-SCH-10, FR-CSE-07 |
| OI-12 | Counseling triage SLAs | Urgent same day; Priority 2 days; Normal 5 days | Counseling service | No | FR-CSE-07 |
| OI-13 | Language requirement | English only in Phase 1 | Administration | No | NFR-LOC-02, ASM-15 |
| OI-14 | Session timeouts, lockout, break-glass duration | 30/15 min; 5 attempts/15 min; 60 min | DIU IT | No | FR-AUTH-06, 14, FR-AUD-07 |
| OI-15 | Consultation fee amount | 50 BDT flat, per visit | Accounts | No | FR-PAY-01, BR-30 |
| OI-16 | Follow-up fee exemption | Same category within 7 days | Accounts | No | FR-PAY-07, BR-32 |
| OI-17 | Per-student 24-hour dispensing limit | 10 units per item | Store / Medical Center | No | FR-MED-24 |
| **OI-18** | **Is a dispensing event linked to the receiving student?** | **No linkage in Phase 1** | Medical Center + Administration | No, but consequential | FR-MED-28 — **see note below** |
| OI-19 | Counseling case auto-close period | 90 days inactivity; student not notified | Counseling service | No | FR-CSE-21, EC-44 |
| OI-20 | Counseling request assignment model | Shared pool | Counseling service | No | FR-CSE-22 |
| OI-21 | Student ID format | Assumed DIU standard format | DIU IT | No | VR-03 |
| **OI-22** | **What happens when no counselor is available for an extended period** | **No automatic escalation beyond notification** | Counseling service | ⚠ Organisational gap | EC-41, FR-CSE-09 |
| OI-23 | Peak concurrency target | 500 concurrent | Product + IT | No | NFR-PERF-07 |
| OI-24 | Post-launch support and incident process | None defined | DIU IT | No, but see [R1] R8 | NFR-MNT-05 |

### Note on OI-18 — a genuine trade-off, not an oversight

Whether a dispensing event records *which student* received the medicine is a real fork with no safe default:

- **Not linking** (the value assumed here) keeps the medicine module out of personal health data entirely. It is the lighter privacy posture and matches the story's framing. But it means there is no accountability for who took what, no way to enforce the per-student limit of FR-MED-24 reliably, and no consumption analytics by cohort.
- **Linking** enables accountability, enforceable limits, and better analytics — but converts every dispensing record into personal health data, bringing retention, consent, and access-control obligations across the whole medicine module.

This SRS assumes no linkage, which makes FR-MED-24's limit **advisory rather than enforceable** (the operator applies it from the student's ID at the counter, not from system state). **DIU must decide.** If linkage is chosen, FR-MED-24 becomes enforceable, but FR-MED-* inherits the privacy requirements currently applied only to counseling.

---

# Appendix A — Deferred Requirements

Recorded so that Phase 1 decisions do not preclude them. **Not implemented in Phase 1.**

| Phase | Deferred capability | Planning source |
|---|---|---|
| 2 | Appointment reschedule with a two-attempt limit | F-APT-05, BR-13 |
| 2 | Doctor self-service console and today's patient list | F-APT-18, F-SCH-09 |
| 2 | Digital prescriptions (drug, strength, quantity, duration only) | [R1] §23 |
| 2 | Dispensing against a prescription with automatic decrement | F-MED-17 |
| 2 | Reserve-for-pickup on prescription-linked items | F-MED-18 |
| 2 | Expiry alerting at 90/60/30 days; quarantine and write-off workflow | F-MED-11, F-MED-12 |
| 2 | Alternatives suggestion (requires pharmacist sign-off) | F-MED-16 |
| 2 | Counseling follow-up chains and case reassignment | F-CSE-07, F-CSE-09 |
| 2 | Consent-gated cross-service sharing and doctor→counselor referral | F-CSE-12, F-APT-19, BR-54 |
| 2 | Reporting dashboards (medical, medicine, aggregate counseling) | F-ADM-05…07 |
| 2 | SMS notifications | F-NTF-08 |
| 2 | Two-factor authentication for counselor and admin accounts | F-AUTH-10 |
| 2 | Service-level feedback capture (never per-provider ratings) | F-ADM-10, [R1] SI-9 |
| 2 | Bangla localisation | OI-13 |
| 3 | Online payment, refunds, reconciliation with Accounts | F-PAY-06…08 |
| 3 | Multi-center / multi-campus scoping | [R1] §21 |
| 3 | Extended user base (faculty, staff, dependants) | ASM-04 |
| 3 | Tele-counseling | [R1] §23 |
| 3 | Reorder suggestions and supplier tracking | F-MED-19 |
| 3 | Web push and offline-capable PWA | F-NTF-09 |

---

# Appendix B — Deviations from the Planning Document

Every point at which this SRS departs from or extends [R1], with justification.

| ID | Deviation | Justification |
|---|---|---|
| **D-1** | **FEFO (F-MED-13) pulled from Phase 2 into Phase 1** as FR-MED-15 | Once batch-level expiry is captured in the MVP (which [R1] §22.2 requires), proposing the earliest-expiring batch is a small increment. Omitting it means the MVP actively encourages dispensing later-expiring stock first, guaranteeing avoidable expiry loss from day one |
| **D-2** | **BR-40 enforcement (blocking dispensing of expired stock) pulled into Phase 1** as FR-MED-16…18 | Dispensing expired medicine is a patient-safety matter. [R1] §11.1 places F-MED-12 (quarantine *workflow*) in Phase 2, which is correct — but the *prohibition* cannot wait. The workflow is deferred; the block is not |
| **D-3** | New rules **BR-65 … BR-70** introduced | Six gaps with no rule in [R1]: check-in identity verification (mitigates R15), walk-in never refused on system state, no automated clinical judgement, deployment gate on missing safety content, emergency privacy, and configuration-not-constants. Each closes a specific exposure |
| **D-4** | **FR-CNS-17 and EC-42** make counseling no-shows explicitly penalty-free | [R1] §19 Q23 raises this as an open question. Leaving it open risks the medical no-show policy being reused by default, which would actively harm the students the module exists to serve. Specified rather than deferred |
| **D-5** | **FR-MED-24 / OI-18** surfaces the dispensing-linkage trade-off explicitly | [R1] §19 Q15 flags it. This SRS assumes no linkage and states plainly that this makes the per-student limit advisory rather than enforceable, so DIU decides with the consequence visible |
| **D-6** | **NFR-SEC-06** requires counseling access control to be independent of the general permission check | [R1] R2 rates counseling exposure as probability Medium, impact Critical. A single shared permission path means one defect exposes it. Defence in depth is proportionate to the stated impact |
| **D-7** | **FR-APT-42 / EC-10** permit exceeding the walk-in allocation | [R1] BR-16 sets an allocation but does not say what happens when it is exhausted. Refusing care because a configured percentage is used up is unacceptable; the allocation protects *bookable* capacity, it does not cap treatment |
| **D-8** | **FR-CSE-22** assigns requests to a shared pool | [R1] §19 Q19 leaves this open. A shared pool is the simpler Phase 1 model and avoids a request stalling behind one counselor's absence |
| **D-9** | **EC-12** caps delay notifications at one per 15-minute window | Not in [R1]. Consecutive emergencies would otherwise flood every waiting student, causing them to disable notifications — which would defeat FR-APT-23, the feature they most need |
| **D-10** | **FR-CNS-02** presents counselor availability as *windows*, not bookable slots | [R1] §7 shows discrete slots (11:00, 12:00, 15:00) but [R1] §8 requires counselor-controlled triage. Letting students self-book a slot would contradict BR-45 by allowing a student to claim priority through speed of booking. Requests express preference; counselors schedule |
| **D-11** | **NFR-RET-01** mandates retaining everything and deleting nothing in Phase 1 | [R1] BR-62 defers to a policy that does not exist. Building deletion against an unwritten policy risks irreversible loss. Retention is reversible; deletion is not |
| **D-12** | **FR-ADM-09 / NFR-PRIV-06** exclude counseling data from *all* Phase 1 export | [R1] BR-55 permits aggregate counseling reporting with a minimum cell size. Since Phase 1 has no reporting module and only raw export, and raw export cannot enforce cell-size suppression, total exclusion is the only safe Phase 1 position |

---

## Document Control

| Item | Value |
|---|---|
| Version | 1.0 |
| Status | Draft for review |
| Release specified | Phase 1 (MVP) |
| Supersedes | — |
| Depends on | `PROJECT_PLANNING.md` v1.0 |
| Hard external dependencies | [R3] DIU-CP-01 Crisis Protocol; [R4] DIU-DR-01 Retention Policy |
| Approval required from | Medical Center (operations), Counseling Service (§3.2.7, §3.2.8, §3.5), DIU IT (§3.7.4, OI-03), Project Sponsor (scope) |
| Next document | System Design Specification — **not yet commissioned** |

**Sign-off note:** §3.2.7, §3.2.8 and the counseling rows of §3.5 must not be implemented before the DIU counseling service has reviewed and approved them, and before [R3] exists (BR-68, OI-01).

*End of SRS v1.0 — DIU CampusCare, Phase 1.*
