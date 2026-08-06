# DIU CampusCare — Smart Medical & Counseling Management System
## Project Planning Document (v1.0)

**Prepared as:** Senior Product Manager / Software Architect review
**Source of truth:** Project Story document (provided by product owner)
**Date:** 3 August 2026
**Naming note:** The story text uses "DIU MediCare" throughout. The approved product name is **DIU CampusCare**. All references are normalised here; the story document should be updated to match before it circulates further, otherwise two names will leak into the report, the UI, and the domain name.

**Scope of this document:** Product planning only. No code, no database design, no API design, no technical architecture. Where the story made an "architectural" claim (e.g. module separation), it is treated here as a *product and permissions* decision, which is what it actually is.

---

## 1. Executive Summary

Daffodil International University operates three student-facing health services — the Medical Center (doctor consultations), the Medical Center's medicine store, and a separately-run counseling/psychiatric service. All three are digitally invisible to students. A sick student cannot find out whether a doctor is on duty, how long the queue is, whether a needed medicine is in stock, or whether a counseling request sent by email was ever read. Service providers, in turn, run schedules, queues, inventory, and counseling caseloads on paper, memory, and email threads.

**DIU CampusCare** is a single, role-based web platform that makes these three services visible and bookable to students, and manageable to staff. Students get one dashboard: book a doctor and receive a digital serial, check medicine availability before travelling, and submit a counseling request that can actually be tracked. Providers get three separate, permission-isolated back-offices: a medical queue console, an inventory console, and a confidential counseling case console.

The proposal is sound and the pain is real. Three things in the story, however, will decide whether this succeeds or quietly dies after launch, and none of them are solved in the current narrative:

1. **The system promises time precision that a walk-in clinic cannot deliver.** "Serial 08, 3:20 PM, Confirmed" is a promise. Real consultations overrun. Two broken promises and students stop trusting the app.
2. **Walk-in patients are not modelled at all.** If the physical queue and the digital queue disagree, front-desk staff will abandon the system within a week and go back to the paper register.
3. **The counseling module has a safety gap.** A student can flag "Urgent" into a dashboard that nobody is watching at 2 AM. Presenting a queue as if it were monitored support is a real-world harm, not a UX detail.

This document keeps the vision intact, resolves these three issues at the product level, adds the workflows the story omits (walk-ins, doctor leave with bulk rescheduling, prescription-linked dispensing, no-show policy, payment reconciliation, crisis routing, audit), and proposes a three-phase roadmap with a deliberately narrow MVP that can be piloted with **one doctor and one counselor** before campus-wide rollout.

**Recommended MVP:** Medical appointments + live digital queue + walk-in support + doctor schedules + medicine availability lookup + inventory management + counseling request-and-triage + crisis safety layer + role-based access. **Deferred:** online payment, prescriptions, clinical notes, mobile app, analytics, follow-up chains.

---

## 2. Project Vision

> **To transform DIU's manually operated healthcare and counseling services into a centralized, secure and student-friendly digital platform where students can check service availability, schedule appointments, access medicine availability information and request counseling support remotely — while enabling doctors, counselors and staff to efficiently manage schedules, queues, inventory and service requests.**

*(Retained verbatim from the story, with the product name normalised.)*

### Vision commentary

The vision statement is well-formed but describes **visibility and scheduling**, not health outcomes. That is the right level of ambition for v1 and should be defended against scope creep toward a full electronic medical record.

Two clarifications the vision should carry explicitly, because the story leaves them ambiguous:

- **CampusCare is an access and coordination layer, not a clinical records system.** It tells students when and where to go, and tells providers who is coming. It does not become the authoritative medical record in v1.
- **"Centralized" refers to the student's experience, not the data.** The three services share one front door and one identity, but their operational data is deliberately partitioned. Centralised access with decentralised confidentiality is the design principle.

### Vision statement (product-facing, shorter)

> *One front door for student health at DIU — know before you go.*

---

## 3. Problem Statement

### 3.1 Canonical problem statement (from the story, tightened)

DIU provides medical consultation, medicine dispensing, and counseling services to students, but the absence of an integrated digital management system means students cannot discover service availability, doctor and counselor schedules, appointment status, medicine stock, or the status of a counseling request. Simultaneously, service providers have no centralised mechanism for managing schedules, queues, inventory, requests, priorities, and follow-ups. The result is wasted student travel, unpredictable queues, underused university medicine supply, and counseling requests lost inside email threads.

### 3.2 Problem decomposition

| # | Problem | Who feels it | Current cost | Severity |
|---|---------|--------------|--------------|----------|
| P1 | No visibility into doctor availability before travelling | Student | Wasted trips from hall/hostel/home; lost class time | High |
| P2 | No visibility into queue length or expected wait | Student | Long unproductive waits at the center | High |
| P3 | Serial issuance requires physical presence | Student | Must travel just to hold a place | High |
| P4 | No schedule publication mechanism | Medical Center staff | Repeated verbal enquiries; rumour-driven expectations | Medium |
| P5 | Schedule changes (leave, emergency) cannot be communicated | Staff + Student | Students arrive for an absent doctor | High |
| P6 | Medicine stock is invisible to students | Student | Students default to outside pharmacies; university stock underused | High |
| P7 | Store open/closed status is unknown | Student | Wasted trips to a closed store | Medium |
| P8 | Inventory tracked manually | Store Operator | Stock errors, silent stock-outs, expiry losses | High |
| P9 | Counseling requests arrive by email | Student + Counselor | No acknowledgement, no status, no SLA | High |
| P10 | No triage or priority mechanism for counseling | Counselor | Urgent cases queue behind routine ones | Critical |
| P11 | No case continuity or follow-up tracking | Counselor | Cases silently drop; no view of caseload | High |
| P12 | No confidentiality boundary between services | Student | Sensitive counseling context handled in ordinary email/staff channels | Critical |
| P13 | No operational data on any service | Medical Center leadership | Cannot justify staffing, budget, or formulary decisions | Medium |

### 3.3 Challenge — two problem premises are unvalidated

The story asserts two causal claims that the whole project leans on. Both need a short validation exercise **before** development, because if either is wrong, part of the build is wasted effort.

**Claim A — "Students avoid the medicine store mainly due to lack of information."**
Plausible, but at least four rival explanations exist: a thin formulary (the store simply doesn't stock what students need), perceived quality, inconvenient opening hours, or embarrassment about certain medicines. If the real driver is formulary depth, a beautiful availability search will not move usage at all — it will just make the gaps visible. **Action: interview 15–20 students and pull one month of store dispensing records + refusal reasons before Phase 1 sign-off.**

**Claim B — "The queue problem is a coordination problem."**
A booking system redistributes demand across time; it does not create capacity. If daily demand substantially exceeds doctor-hours, online slots will be consumed within seconds of opening, and students who previously could at least walk in and wait will now find *zero slots available* and be angrier than before. **Action: measure daily patient volume against available doctor-hours for two weeks.** If demand exceeds supply, the product must ship with a hybrid model (a reserved proportion of walk-in capacity) rather than pure slot booking — this is a design fork, not a tuning parameter.

---

## 4. Existing System Analysis

### 4.1 Medical Center — as-is

| Aspect | Current state | Weakness |
|--------|---------------|----------|
| Availability discovery | Word of mouth, physical visit | No single source of truth |
| Appointment/serial | Issued in person at the counter | Requires travel; no remote hold |
| Consultation fee | Paid in cash at counter (~50 BDT) | No digital record; reconciliation is manual |
| Queue management | Paper register / verbal | No wait estimate; disputes over order |
| Doctor schedule | Internal knowledge, possibly a notice board | Changes do not propagate to students |
| Doctor leave | Communicated ad hoc | Students arrive for an absent doctor |
| Consultation output | Paper prescription / verbal advice | Not linked to the store; no history |

### 4.2 Medicine Store — as-is

| Aspect | Current state | Weakness |
|--------|---------------|----------|
| Stock knowledge | Operator's memory + manual register | No stock-out prediction |
| Student visibility | None | Students go elsewhere |
| Opening hours | Informal | Wasted trips |
| Dispensing | Over the counter, likely against a paper prescription or on request | No audit trail of who received what |
| Expiry control | Manual inspection | Financial loss; safety risk |
| Reordering | Reactive, on noticing a shortage | Stock-outs of common items |

### 4.3 Counseling / Psychiatric Service — as-is

| Aspect | Current state | Weakness |
|--------|---------------|----------|
| Request channel | Email | No acknowledgement, no SLA, no tracking |
| Triage | Implicit, in the counselor's inbox | Urgency invisible; ordering by inbox recency |
| Scheduling | Email negotiation | Slow round-trips; student uncertainty |
| Caseload view | None | Counselor cannot see total demand |
| Follow-up | Memory / personal notes | Cases drop silently |
| Confidentiality | Depends on individual email hygiene | Sensitive content in a general-purpose channel |
| Crisis handling | Not defined in the story | **Unknown and unaddressed — highest risk area** |

### 4.4 Cross-cutting as-is findings

- **The three services do not know each other exists.** A doctor cannot refer a student to counseling in any traceable way; a counselor cannot see that a student is under medical care. This is a genuine integration opportunity — but it is also the sharpest privacy hazard, and must be consent-gated rather than automatic.
- **No operational data exists anywhere.** Nobody can currently answer "how many students used the Medical Center last month?" This makes CampusCare valuable to leadership independent of its student-facing value, and that is a useful political asset for securing sponsorship.
- **No identity verification.** Serials are issued to whoever is standing at the counter. Introducing a digital identity is an improvement, but it also introduces a new abuse surface (booking under another student's ID) that the story does not consider.

---

## 5. Proposed Solution

### 5.1 Solution summary

A mobile-first, role-based web platform (responsive PWA) with a single university-authenticated login and three service modules behind one student dashboard.

**Student-facing:**
- 🩺 **Medical** — see today's doctors and duty times → pick a slot → get a digital serial → track live queue position → arrive near your turn.
- 💊 **Medicine** — search a medicine → see *Available / Low Stock / Out of Stock* → see store open/closed and closing time → go collect.
- 🧠 **Counseling** — see counselor availability → submit a request with a category and self-reported urgency → get an acknowledgement with an SLA → receive a scheduled session → attend → optional follow-up.

**Provider-facing (three separate consoles, three separate permission domains):**
- **Medical Queue Console** (staff) — today's queue, check-in, walk-in insertion, status progression, fee marking, schedule publication, leave handling.
- **Inventory Console** (store operator) — medicine catalogue, batches, stock in/out, expiry, low-stock alerts, store open/close.
- **Counseling Case Console** (counselors only) — request triage, priority override, scheduling, session outcome, follow-up, confidential notes.

Plus an **Admin Console** for accounts, roles, service configuration, and operational reporting — deliberately *without* access to counseling case content.

### 5.2 The three corrections this solution makes to the story

These are the substantive product changes recommended on top of the story's vision. Everything else in the story is preserved.

---

**Correction 1 — Replace the "precise appointment time" promise with a "live queue position" promise.**

*The story's model:* the student books 3:20 PM and is told the appointment is Confirmed at 3:20 PM.

*Why it breaks:* consultations do not take a fixed time. One 20-minute case at 2:15 PM pushes every subsequent slot. By 4 PM the app's times are fiction and the student who arrived at 3:15 PM is still waiting at 4:10 PM. The app will be blamed for a delay it merely reported.

*The fix:* keep slot booking as the *reservation* mechanism (it is intuitive and it is what students asked for), but change the *displayed commitment*:
- Booking confirms a **serial number and an ordered position**, not a guaranteed clock time.
- The displayed time is labelled **"Estimated: ~3:20 PM"** and is recalculated continuously from the doctor's actual consultation pace today.
- Students see **"You are 3 patients away · est. 25 min"** once the session is live, and receive a "you're next in ~15 minutes" notification.
- If the estimate slips beyond a configured threshold (e.g. 30 minutes), the student is notified proactively.

This turns the system's biggest credibility liability into its single most-loved feature. A student who can watch the queue move from their hall room is the entire value proposition, delivered honestly.

---

**Correction 2 — Model walk-ins as first-class citizens.**

*The story's gap:* walk-in patients are never mentioned. Yet they are the current default behaviour and will remain a large share of traffic for months, plus emergencies will always be walk-ins.

*Why it matters:* if a walk-in consumes 15 minutes of doctor time invisibly, every digital estimate is wrong and the queue console no longer reflects reality. Staff will notice this within days and revert to paper. **This single omission is the most likely cause of project failure after launch.**

*The fix:*
- The queue is a single unified queue containing both booked and walk-in patients.
- Staff can insert a walk-in into the queue in a few seconds (student ID + reason), which immediately updates every waiting student's estimate.
- A configurable **capacity split** per session (e.g. 70% bookable online, 30% held for walk-ins and emergencies) protects both populations, and directly de-risks the demand-exceeds-supply scenario in §3.3.
- Staff can mark a patient as **Emergency**, which jumps the queue and openly informs waiting students ("An emergency case is being seen — your estimate has moved by ~15 min"). Transparency here prevents anger far more effectively than silence.

---

**Correction 3 — Make the counseling module safe before making it convenient.**

*The story's gap:* it correctly notes that the interface should "direct students toward the university's designated urgent-support process," then leaves it at one sentence. It also proposes an "Urgent" self-selected flag feeding a dashboard.

*Why it matters:* a student in distress at 2 AM who selects "Urgent" and submits a form has a reasonable expectation that someone is watching. Nobody is. The product would be creating a false impression of monitored care. This is the one area of the project where a design shortcut can cause real harm.

*The fix (all of it belongs in the MVP — it is cheap to build and non-negotiable):*
- **Persistent crisis banner** on every counseling screen, with the national emergency number, any DIU-designated urgent contact, and campus security — visible without logging in and before any form is submitted.
- **Explicit non-monitoring notice**, stated plainly at the point of submission: *"This is not an emergency service. Requests are reviewed during office hours (Sun–Thu, 9 AM – 5 PM). If you need help now, call [X]."*
- **Interstitial on high-urgency selection** — if the student selects the highest urgency, show the crisis resources *before* accepting the request, and offer both paths (submit request **and** contact now).
- **A published triage SLA** — every request is acknowledged automatically on submission and human-triaged within one working day. The acknowledgement restates the crisis resources.
- **Escalation and duty-of-care path** — a defined workflow for the counselor when a request or session discloses risk of harm, including who is contacted and what is recorded. This must be authored by DIU's counseling professionals, not by the development team; the product only implements it.

---

### 5.3 Two additional solution decisions the story left open

**Prescription-linked dispensing (Phase 2, but design the MVP for it).**
The story's medicine flow is *search → see available → visit store → collect*. For over-the-counter items this is fine. For anything prescription-only, dispensing on the basis of a student having searched for it is clinically and legally wrong, and the story does not distinguish the two. Recommendation:
- Classify every catalogue item as **OTC** or **Prescription-only** from day one.
- MVP: students see availability for both, but prescription-only items display *"Requires a doctor's prescription"* instead of implying collection.
- Phase 2: doctors issue a digital prescription at the end of a consultation; the store operator dispenses against it; stock decrements automatically and traceably. This simultaneously fixes the story's manual-stock-deduction weakness (§14, BR-33) and creates the first genuine cross-module integration.

**"Available" is information, not a reservation.**
If a student sees "Available", travels 20 minutes, and finds the last strip was dispensed 5 minutes earlier, the app has made things worse. Recommendation:
- Always timestamp the status: *"Available — as of 2:14 PM. Stock is not reserved."*
- Phase 2: allow a **hold until end of day** for prescription-linked items only (not for open search, which would be trivially abusable).

---

## 6. Business Goals

Goals are the university's, expressed in outcomes rather than features. Each carries a target that can actually be measured after launch.

| ID | Business goal | Success measure | Target (12 months post-launch) |
|----|---------------|-----------------|-------------------------------|
| BG1 | Reduce wasted student trips and lost class time | % of consultations that began as an online booking | ≥ 60% |
| BG2 | Reduce perceived and actual waiting time | Median wait from arrival to consultation | ↓ 40% vs. baseline |
| BG3 | Increase utilisation of the university medicine store | Dispensing events per month | ↑ 50% vs. baseline |
| BG4 | Eliminate untracked counseling requests | % of requests acknowledged within 1 working day | 100% |
| BG5 | Reduce time-to-first-counseling-session | Median days from request to scheduled session | ≤ 5 working days |
| BG6 | Protect sensitive health data | Confirmed unauthorised-access incidents | 0 |
| BG7 | Give leadership operational visibility | Monthly service report produced from the system | 12 of 12 months |
| BG8 | Reduce medicine wastage | Value of stock written off due to expiry | ↓ 30% |
| BG9 | Establish DIU CampusCare as the default health channel | Monthly active student users | ≥ 25% of enrolled students |
| BG10 | Improve student trust in campus health services | Post-consultation satisfaction score | ≥ 4.0 / 5.0 |

**Note on baselines:** BG1, BG2, BG3, BG5, and BG8 all require a **pre-launch baseline measurement**, which does not currently exist (§4.4). Two weeks of manual measurement before Phase 1 development is a prerequisite for being able to claim success later. This is a small task that is almost always skipped and almost always regretted.

---

## 7. Project Objectives

Project objectives are the delivery team's commitments — specific, time-bound, and verifiable.

**Product objectives**
- **O1** — Deliver a role-based platform serving six actor types with strict permission isolation between the medical, medicine, and counseling domains.
- **O2** — Enable remote booking of a medical consultation with a digital serial, in under 60 seconds, on a mobile device.
- **O3** — Provide a live, continuously-recalculated queue position and wait estimate to every booked and checked-in student.
- **O4** — Publish authoritative doctor duty schedules and propagate any change (including leave) to affected students automatically.
- **O5** — Provide a student-facing medicine availability search returning a status band (Available / Low Stock / Out of Stock) without exposing exact quantities.
- **O6** — Provide the store operator with batch-level inventory, expiry tracking, and low-stock alerting.
- **O7** — Provide a structured counseling request → triage → schedule → session → follow-up workflow with counselor-controlled prioritisation.
- **O8** — Guarantee that counseling case content is readable only by authorised counseling professionals, including by system administrators.
- **O9** — Ship the crisis-safety layer (§5.2, Correction 3) as part of the first release, not as a later addition.
- **O10** — Record every state change and every access to sensitive records in a tamper-evident audit trail.

**Delivery objectives**
- **O11** — Complete discovery, baseline measurement, and written sign-off from the Medical Center, the counseling service, and DIU IT before development begins.
- **O12** — Pilot the medical module with **one doctor for two weeks** before extending to all doctors.
- **O13** — Pass an internal security and privacy review before the counseling module handles any real student data.
- **O14** — Deliver a usable staff console that a receptionist can operate with under 30 minutes of training.
- **O15** — Achieve functional parity with the paper process such that the paper register can be retired at the pilot site by end of Phase 1.

---

## 8. Stakeholders

### 8.1 Stakeholder register

| Stakeholder | Interest | Influence | Engagement strategy |
|-------------|----------|-----------|--------------------|
| **Students** (~primary users) | Fast, private, predictable access to health services | Low individually, high collectively | Usability testing, pilot cohort, in-app feedback |
| **Medical Center doctors** | Manageable patient flow; minimal admin burden | High — can veto by non-adoption | Zero-mandatory-data-entry design in Phase 1; involve one champion doctor early |
| **Medical Center staff / receptionist** | Tool must be faster than paper | **Highest operational influence** | Co-design the queue console with them; they decide whether this lives or dies |
| **Medicine Store Operator** | Accurate stock without extra work | High | Design for speed of entry; accept that data quality depends entirely on them |
| **Counselors / Psychiatrists** | Confidentiality, professional autonomy, manageable caseload | High — and hold ethical veto | Involve from day one; they author the triage and escalation rules, not the dev team |
| **Medical Center Director / Head** | Service quality, staffing justification, budget | High — likely project sponsor | Monthly reporting is their payoff; secure sponsorship here |
| **DIU Student Affairs / Administration** | Student welfare, institutional reputation | High | Governance sign-off, policy alignment |
| **DIU IT Department** | Identity integration, hosting, security, maintainability | High — controls SSO and infrastructure | Engage before any auth decision is made |
| **DIU Accounts / Finance** | Fee collection integrity and reconciliation | Medium, rising sharply if online payment is added | Define the reconciliation process with them in Phase 1 |
| **Academic supervisor / evaluation committee** *(if this is a capstone project)* | Academic rigour, documentation, defensible scope | High over the delivery timeline | Align milestones to the academic calendar |
| **Parents / guardians** | Student wellbeing | Low, indirect | **Explicitly no access.** Must be stated as policy, not left ambiguous |
| **Payment gateway provider** (Phase 3) | Compliance, settlement | External | Deferred; do not design around it yet |

### 8.2 Stakeholder observations

- **The receptionist is the real gatekeeper.** Students adopt what works; staff adopt what is *faster than what they already do*. If check-in takes longer than writing a name on paper, the project fails regardless of how good the student app is. Budget disproportionate design effort here.
- **Counselors hold an ethical veto.** If the counseling professionals are not comfortable with the confidentiality model, they will not use it, and they will be right not to. They must be co-authors of §14's counseling rules.
- **The story does not name a project sponsor.** Without an owner inside DIU who wants the monthly report, this becomes a student project that nobody operationalises. **Identify the sponsor before Phase 1.**
- **Parents are a deliberate exclusion.** The story never raises it; it will be raised eventually. Stating "no guardian access, ever" up front is far easier than retracting access later.

---

## 9. User Personas

### Persona 1 — Rahim, the Hall Resident *(primary, ~60% of volume)*
- **Profile:** 2nd-year undergraduate, lives in a hall 15 minutes from the Medical Center. Android mid-range phone, mobile data, often on a weak connection.
- **Goal:** Find out whether it's worth walking over, and if so, when.
- **Frustrations:** Walking over to find the doctor gone; sitting for 45 minutes; missing a class for a 6-minute consultation.
- **Behaviour:** Will check the app from bed. Will not install a native app for one occasional use. Will abandon a page that takes more than a few seconds on 3G.
- **Design implications:** Mobile-first, PWA not native, tiny payload, availability visible **before login** if possible, one-thumb booking.

### Persona 2 — Nusrat, the Day Scholar *(~30% of volume)*
- **Profile:** 3rd-year, commutes 1 hour, on campus only on class days.
- **Goal:** Compress everything into the window between two classes.
- **Frustrations:** Cannot afford an unpredictable wait; often needs medicine same-day or not at all.
- **Design implications:** Slot booking matters more to her than live queue; needs medicine availability *and* store closing time; a "will the store still be open when my class ends?" answer is her core need.

### Persona 3 — Tanvir, the Student in Distress *(low volume, highest stakes)*
- **Profile:** Final-year, under academic and family pressure, has been considering reaching out for weeks.
- **Goal:** Ask for help without having to explain himself repeatedly, and know that someone received it.
- **Frustrations:** Sending an email into silence. Fear of being seen entering the counseling office. Fear that a staff member he knows will see his record.
- **Behaviour:** May start the form three times before submitting. Extremely sensitive to any hint that his request is visible to non-counselors. Will abandon if asked for lengthy details up front.
- **Design implications:** Minimal-friction request (category + optional free text + preferred times — nothing more). Immediate acknowledgement with a named SLA. Explicit, plain-language confidentiality statement. Discreet notification content. Crisis resources always visible. **Every design decision in the counseling module should be sanity-checked against Tanvir.**

### Persona 4 — Dr. Ahsan, the Consulting Doctor
- **Profile:** Sees 25–40 students per duty session. Values clinical time; has low tolerance for software.
- **Goal:** Know who is next; not be interrupted by administration.
- **Frustrations:** Any system that adds clicks between patients. Being asked to maintain his own schedule.
- **Behaviour:** In Phase 1, will likely not log in at all. Will read a wall-mounted queue display.
- **Design implications:** **Phase 1 must work with zero doctor interaction** — staff maintain schedules and progress statuses on the doctor's behalf. Doctor self-service is a Phase 2 *option*, never a dependency. A read-only queue display for the consultation room is worth more to him than a login.

### Persona 5 — Shirin, the Medical Center Receptionist *(the operational make-or-break user)*
- **Profile:** Handles arrivals, serials, cash, phone enquiries, and walk-ins simultaneously. Desktop at the counter. Not a technology enthusiast.
- **Goal:** Get through the rush without the queue collapsing.
- **Frustrations:** Anything requiring more than two clicks during a rush. Systems that disagree with the physical reality in front of her.
- **Behaviour:** Will keep a paper backup until the system proves itself. Will abandon it instantly if it is slower.
- **Design implications:** One screen showing the whole day's queue. Check-in in one click. Walk-in insertion in under 15 seconds. Keyboard-first. Must remain usable if the internet drops (§15, C7).

### Persona 6 — Karim, the Medicine Store Operator
- **Profile:** Runs the store alone; also handles receiving and expiry checks.
- **Goal:** Never be caught out by a stock-out or an expired strip.
- **Frustrations:** Duplicate record-keeping (system *and* register). Data entry for 200+ SKUs.
- **Design implications:** Fast bulk stock entry. Low-stock and expiry alerts pushed to him, not buried in a report. If the system doubles his workload, his data goes stale and every student-facing status becomes a lie — **inventory data quality is entirely dependent on his experience being good.**

### Persona 7 — Dr. Farhana, the Counselor / Psychiatrist
- **Profile:** Manages a caseload across many students; ethically bound to confidentiality.
- **Goal:** See total demand, triage correctly, never lose a case, never have notes seen by non-clinicians.
- **Frustrations:** Email as a case system. Being unable to tell how many students are waiting. Having no record of what was agreed last session.
- **Design implications:** Caseload dashboard sorted by priority and age. Counselor-controlled priority override. Notes visible only to counseling professionals — **including invisible to the system administrator**. Clear follow-up scheduling.

### Persona 8 — Sabbir, the System Administrator
- **Profile:** DIU IT staff, maintains many systems, part-time on this one.
- **Goal:** Manage accounts and roles; keep it running; never be the cause of a privacy incident.
- **Design implications:** Full control over identity, roles, and configuration; **zero access to counseling case content and clinical notes**. Any emergency access must be a logged, justified, notified break-glass action. This deliberately contradicts the story's "System Admin: manage overall system" framing — see §14, BR-52.

---

## 10. Complete Feature Breakdown

Feature IDs are used in §11 for prioritisation and §23 for roadmap placement.

### M1 — Authentication, Identity & Role Management
| ID | Feature |
|----|---------|
| F-AUTH-01 | Student login via DIU institutional identity (SSO preferred; fallback: verified university email + password) |
| F-AUTH-02 | Staff/provider login with role assignment |
| F-AUTH-03 | Role model supporting multiple roles per user (e.g. a doctor who is also a counselor) |
| F-AUTH-04 | Permission enforcement isolating Medical / Medicine / Counseling domains |
| F-AUTH-05 | Session management, timeout, forced logout on shared devices |
| F-AUTH-06 | Password reset / account recovery |
| F-AUTH-07 | Account lifecycle: activation on enrolment, deactivation on graduation or withdrawal |
| F-AUTH-08 | Admin user & role management console |
| F-AUTH-09 | Break-glass emergency access with mandatory justification, logging, and notification |
| F-AUTH-10 | Two-factor authentication for counselor and admin accounts *(Phase 2)* |

### M2 — Student Health Dashboard
| ID | Feature |
|----|---------|
| F-DASH-01 | Unified dashboard with three service entry points |
| F-DASH-02 | "My upcoming appointments" with live status |
| F-DASH-03 | "My activity history" — past visits, requests (counseling entries shown to the student only) |
| F-DASH-04 | Notification centre (in-app) |
| F-DASH-05 | Today-at-a-glance: doctors on duty, store open/closed, counseling status |
| F-DASH-06 | Profile & contact preferences |
| F-DASH-07 | Public (pre-login) availability view — see who's on duty without logging in |

### M3 — Doctor & Schedule Management
| ID | Feature |
|----|---------|
| F-SCH-01 | Doctor profile: name, designation, specialisation, photo |
| F-SCH-02 | Recurring weekly duty roster definition |
| F-SCH-03 | Date-specific schedule overrides |
| F-SCH-04 | Slot configuration: slot length, session capacity, online/walk-in split |
| F-SCH-05 | Leave / unavailability marking |
| F-SCH-06 | **Bulk handling of affected appointments on leave** — auto-cancel, notify, offer rebooking |
| F-SCH-07 | Holiday & academic calendar exceptions (weekly holidays, public holidays, Ramadan hours, semester breaks) |
| F-SCH-08 | Schedule publication window (how far ahead students can see and book) |
| F-SCH-09 | Doctor self-service schedule view/edit *(Phase 2, optional)* |
| F-SCH-10 | Schedule change audit log |

### M4 — Medical Appointment & Digital Serial Management
| ID | Feature |
|----|---------|
| F-APT-01 | Browse doctors and available slots by date |
| F-APT-02 | Book a slot → generate appointment ID + serial number |
| F-APT-03 | Booking confirmation with estimated time and explicit "estimate, not guarantee" framing |
| F-APT-04 | Cancel an appointment (within policy window) |
| F-APT-05 | Reschedule an appointment (within policy limits) |
| F-APT-06 | **Live queue position and dynamic wait estimate** |
| F-APT-07 | "You're next in ~15 minutes" proactive notification |
| F-APT-08 | Delay notification when the estimate slips past threshold |
| F-APT-09 | Staff queue console — the day's unified queue for all doctors |
| F-APT-10 | Check-in (student arrival confirmation) |
| F-APT-11 | Status progression: Booked → Checked In → Waiting → In Consultation → Completed |
| F-APT-12 | Exception statuses: Cancelled, No-show, Rescheduled, Expired |
| F-APT-13 | **Walk-in registration and insertion into the live queue** |
| F-APT-14 | **Emergency case insertion with priority override and transparent notification to waiting students** |
| F-APT-15 | Consultation-room queue display (read-only, large format, no login) |
| F-APT-16 | Booking limits and abuse prevention (max active bookings, no-show throttling) |
| F-APT-17 | Reason-for-visit capture (short, optional, structured) |
| F-APT-18 | Doctor-side today's-patient list *(Phase 2)* |
| F-APT-19 | Referral from doctor to counseling service, consent-gated *(Phase 2)* |

### M5 — Consultation Fee Management
| ID | Feature |
|----|---------|
| F-PAY-01 | Fee configuration (amount, exemptions, follow-up rules) |
| F-PAY-02 | Payment status on each appointment: Unpaid / Paid at counter / Waived |
| F-PAY-03 | Counter payment recording with receipt number |
| F-PAY-04 | Daily collection summary for reconciliation with cash |
| F-PAY-05 | Fee exemption / waiver workflow with authorisation |
| F-PAY-06 | Online payment via gateway *(Phase 3)* |
| F-PAY-07 | Refund handling for cancellations and doctor-side cancellations *(Phase 3)* |
| F-PAY-08 | Payment reconciliation report for Accounts *(Phase 3)* |

### M6 — Medicine Inventory & Store Management
| ID | Feature |
|----|---------|
| F-MED-01 | Medicine catalogue: generic name, brand, strength, form, OTC vs prescription-only |
| F-MED-02 | Student-facing search with fuzzy/partial matching and generic↔brand cross-reference |
| F-MED-03 | Status band display: Available / Low Stock / Out of Stock (quantities hidden) |
| F-MED-04 | "As of HH:MM · not reserved" freshness stamp on every status |
| F-MED-05 | Prescription-only indicator with "requires a doctor's prescription" messaging |
| F-MED-06 | Store open/closed status and today's hours, including closing time |
| F-MED-07 | Scheduled store hours as the default source of truth, with manual override that auto-expires |
| F-MED-08 | Operator: stock receipt entry, batch and expiry capture |
| F-MED-09 | Operator: dispensing entry with stock decrement |
| F-MED-10 | Low-stock threshold configuration per item, with alerts |
| F-MED-11 | Expiry alerts at configurable horizons (e.g. 90/60/30 days) |
| F-MED-12 | Expired-stock quarantine and write-off workflow |
| F-MED-13 | FEFO (first-expiry-first-out) dispensing guidance |
| F-MED-14 | Stock adjustment with mandatory reason (damage, loss, correction) |
| F-MED-15 | Full stock movement audit trail |
| F-MED-16 | Alternatives suggestion when an item is out of stock *(Phase 2 — clinical sign-off required)* |
| F-MED-17 | Dispensing against a digital prescription, with automatic decrement *(Phase 2)* |
| F-MED-18 | Reserve-for-pickup hold on prescription-linked items *(Phase 2)* |
| F-MED-19 | Reorder suggestions from consumption history *(Phase 3)* |

### M7 — Counseling Appointment Management
| ID | Feature |
|----|---------|
| F-CNS-01 | Counselor profiles and published availability |
| F-CNS-02 | Counseling request submission: category, self-reported urgency, optional note, preferred times |
| F-CNS-03 | **Crisis-resources banner on all counseling screens, visible pre-login** |
| F-CNS-04 | **Non-monitoring notice and office-hours statement at point of submission** |
| F-CNS-05 | **High-urgency interstitial offering immediate contact routes before submission** |
| F-CNS-06 | Automatic acknowledgement with a stated triage SLA |
| F-CNS-07 | Student-side request status tracking |
| F-CNS-08 | Session scheduling by counselor; student confirmation |
| F-CNS-09 | Session reminder notification with discreet content |
| F-CNS-10 | Student-initiated cancellation / reschedule request |
| F-CNS-11 | Mode selection: in-person / online *(Phase 2)* |
| F-CNS-12 | Anonymous or low-disclosure initial enquiry *(Phase 2 — see §18, MR-14)* |

### M8 — Counseling Priority & Case Tracking
| ID | Feature |
|----|---------|
| F-CSE-01 | Counselor triage queue sorted by priority and waiting time |
| F-CSE-02 | Priority levels: Normal / Priority / Urgent, **set finally by the counselor** |
| F-CSE-03 | Priority override with reason |
| F-CSE-04 | Case status lifecycle: Requested → Under Review → Scheduled → Session Completed → Follow-up Required → Closed |
| F-CSE-05 | Case timeline view |
| F-CSE-06 | Confidential session notes, counselor-only |
| F-CSE-07 | Follow-up scheduling from within a case |
| F-CSE-08 | Caseload summary per counselor (open cases, pending triage, overdue follow-ups) |
| F-CSE-09 | Case reassignment between counselors, with logging |
| F-CSE-10 | **Risk-escalation workflow** per DIU counseling policy |
| F-CSE-11 | **Access audit log — every read of counseling data is recorded** |
| F-CSE-12 | Consent capture for any cross-service information sharing |
| F-CSE-13 | Aggregate-only reporting with minimum cell-size suppression |

### M9 — Notification System
| ID | Feature |
|----|---------|
| F-NTF-01 | In-app notification centre |
| F-NTF-02 | Email notifications |
| F-NTF-03 | Notification templates with **discreet content policy** (no diagnosis, no service name in counseling subject lines) |
| F-NTF-04 | Event triggers: booking confirmed, reminder, you're-next, delay, cancellation, schedule change, request acknowledged, session scheduled |
| F-NTF-05 | Student notification preferences |
| F-NTF-06 | Operator alerts: low stock, expiry |
| F-NTF-07 | Counselor alerts: new urgent request, overdue triage |
| F-NTF-08 | SMS channel for critical confirmations *(Phase 2 — cost-dependent)* |
| F-NTF-09 | Web push *(Phase 3)* |
| F-NTF-10 | Delivery failure handling and retry |

### M10 — Admin, Reporting & Governance
| ID | Feature |
|----|---------|
| F-ADM-01 | Service configuration (slot lengths, fees, thresholds, SLAs, hours) |
| F-ADM-02 | Holiday and academic calendar management |
| F-ADM-03 | Announcement / notice banner (e.g. "Center closed 14 Aug") |
| F-ADM-04 | System-wide audit log viewer |
| F-ADM-05 | Medical service report: volume, peak hours, no-show rate, average wait, per-doctor load |
| F-ADM-06 | Medicine report: consumption, stock-outs, expiry write-off value, top items |
| F-ADM-07 | Counseling report: **aggregate only** — request volume, triage SLA compliance, time-to-session, caseload |
| F-ADM-08 | Data export for the Director's monthly review |
| F-ADM-09 | Data retention and archival policy enforcement |
| F-ADM-10 | Student feedback capture (service-level, **not** individual-provider ratings — see §20, SI-9) |

---

## 11. Feature Prioritization

### 11.1 MoSCoW classification

**MUST HAVE (MVP — without these the product does not function or is unsafe)**
F-AUTH-01…05, 07, 08 · F-DASH-01, 02, 04, 05, 07 · F-SCH-01…08, 10 · F-APT-01…04, 06, 09…14, 16 · F-PAY-01…04 · F-MED-01…10, 14, 15 · F-CNS-01…08 · F-CSE-01…06, 08, 10, 11 · F-NTF-01…04, 06, 07 · F-ADM-01, 02, 04

**SHOULD HAVE (high value, first post-MVP wave)**
F-AUTH-06, 10 · F-DASH-03, 06 · F-APT-05, 07, 08, 15, 17, 18 · F-PAY-05 · F-MED-11, 12, 13, 17 · F-CNS-09, 10, 11 · F-CSE-07, 09, 12 · F-NTF-05, 08, 10 · F-ADM-03, 05, 06, 07, 08

**COULD HAVE (valuable, not urgent)**
F-AUTH-09 · F-SCH-09 · F-APT-19 · F-MED-16, 18 · F-CNS-12 · F-CSE-13 · F-NTF-09 · F-ADM-09, 10

**WON'T HAVE (this release — explicitly out, see §12.2)**
F-PAY-06, 07, 08 · F-MED-19 · Telemedicine · Native mobile apps · Lab/diagnostics · Full EMR

### 11.2 Value / effort / risk grid for the contested items

| Feature | Student value | Provider value | Effort | Risk if omitted | Verdict |
|---------|--------------|----------------|--------|-----------------|---------|
| F-APT-06 Live queue position | **Very High** | Medium | Medium | Product loses its core differentiator; slot times become lies | **MVP** |
| F-APT-13 Walk-in insertion | Indirect but high | **Very High** | Low | Staff abandon the system; data diverges from reality | **MVP — non-negotiable** |
| F-CNS-03/04/05 Crisis safety layer | High | High | **Low** | Real-world harm; institutional liability | **MVP — non-negotiable** |
| F-CSE-11 Counseling access audit | Low (invisible) | High | Low | Cannot demonstrate confidentiality; counselors may refuse to adopt | **MVP** |
| F-SCH-06 Bulk reschedule on leave | High | High | Medium | Students travel to see an absent doctor — the exact problem being solved | **MVP** |
| F-PAY-06 Online payment | Medium | Low | **High** | Adds refunds, reconciliation, compliance, PCI-adjacent concerns | **Phase 3** |
| F-MED-17 Prescription dispensing | Medium | High | High | Continues manual stock deduction; but MVP still works | **Phase 2** |
| F-APT-18 Doctor console | Low | Medium | Medium | None — staff can operate on the doctor's behalf | **Phase 2** |
| F-MED-16 Alternatives suggestion | High | Low | Medium | **Clinical safety risk if built without pharmacist sign-off** | **Phase 2, gated** |
| F-ADM-05/06 Reporting | None | **Very High** | Medium | Sponsor loses interest; project loses institutional support | **Early Phase 2** |

### 11.3 Prioritisation rationale

Three principles drove the calls above:

1. **Operational truth beats student polish.** Any feature that keeps the digital queue synchronised with the physical queue (walk-ins, emergency insertion, check-in speed) outranks any student-facing enhancement. A pretty app on top of stale data is worse than no app.
2. **Safety features are never "later."** The crisis layer is cheap to build and expensive to omit. It ships in v1.
3. **Money is the last thing to digitise.** Online payment triples the operational surface (refunds, disputes, settlement, reconciliation) for a marginal gain over paying 50 BDT at a counter the student is already standing at. Defer it to Phase 3 and revisit only if no-show rates prove that pre-payment is the fix.

---

## 12. Scope

### 12.1 In Scope

**Services**
- DIU Medical Center doctor consultation booking and queue management
- DIU Medical Center medicine store availability and inventory
- DIU counseling / psychiatric service request, triage, scheduling, and case tracking

**Users**
- Currently enrolled DIU students (all programmes)
- Medical Center doctors, staff, and store operator
- University counselors and psychiatrists
- System administrators

**Capabilities**
- Role-based authentication with strict inter-service permission isolation
- Doctor schedule publication, override, leave, and holiday handling
- Remote appointment booking with digital serial and live queue position
- Unified queue covering both booked and walk-in patients
- Consultation fee status tracking and counter payment recording
- Medicine catalogue, availability status bands, and batch/expiry inventory
- Counseling request intake, counselor-controlled triage, scheduling, case lifecycle, confidential notes
- Crisis-resource surfacing and escalation workflow
- In-app and email notifications
- Audit logging of state changes and sensitive-data access
- Operational reporting for service leadership

**Platform**
- Responsive, mobile-first web application (PWA)
- Bangla and English interface *(recommended addition — see §18, MR-16)*

### 12.2 Out of Scope (this release)

| Item | Rationale |
|------|-----------|
| **Online payment / gateway integration** | Deferred to Phase 3; adds refunds, disputes, settlement, and compliance burden for marginal benefit |
| **Full electronic medical record (EMR)** | CampusCare is an access layer, not a clinical record system. Crossing this line changes regulatory posture, retention obligations, and effort by an order of magnitude |
| **Telemedicine / video consultation** | Different problem, different compliance surface |
| **Online counseling sessions (video)** | Phase 3 candidate; requires separate privacy and platform review |
| **Lab tests, diagnostics, imaging** | Not part of the described service |
| **Ambulance dispatch or emergency response** | **Explicitly out.** CampusCare must never position itself as emergency response |
| **Health insurance or claims** | Not a DIU service |
| **Native iOS/Android applications** | PWA meets the need; native adds distribution and maintenance cost |
| **Faculty, staff, alumni, and dependants as users** | Student-only in v1; expansion is a Phase 3 decision (see §16, A4) |
| **Parent / guardian access** | Deliberately excluded on privacy grounds, permanently |
| **Multi-campus / multi-center operation** | Single center in v1; multi-center is a Phase 3 architecture decision (see §21) |
| **Integration with the university's academic/SIS system beyond identity** | Identity only |
| **Automated clinical decision support or symptom triage** | Out of scope and out of competence; would create clinical liability |
| **Public health surveillance / outbreak reporting** | Phase 3 candidate |

### 12.3 Scope boundary risks to watch

- **"Just add prescription notes" creep.** The moment doctors start typing clinical observations, this becomes an EMR with medical-record retention obligations. Phase 2's digital prescription must be deliberately narrow: *drug, strength, quantity, duration* — nothing resembling a clinical narrative.
- **"Can we see the student's medical history in counseling?" creep.** Cross-service data sharing is a consent-gated feature (F-CSE-12), never an ambient one.
- **"Can admin just check one thing?" creep.** Every exception to counseling isolation erodes the confidentiality promise. Break-glass with logging and notification is the only acceptable form.

---

## 13. Functional Overview

Narrative flows only — no screens, no data structures, no endpoints.

### 13.1 Student — medical consultation
1. Student opens CampusCare; sees today's on-duty doctors (available before login).
2. Logs in with the university identity.
3. Selects a doctor and date; sees remaining bookable slots and current booking load.
4. Selects a slot; optionally records a short reason for visit.
5. System issues an **Appointment ID + serial number**, with an estimated time and a plain statement that the time is an estimate.
6. Student receives confirmation (in-app + email).
7. On the day, the student watches live queue position and receives a "you're next in ~15 min" alert.
8. Student arrives; staff check them in; status becomes Checked In → Waiting.
9. Student pays the consultation fee at the counter; staff mark it Paid with a receipt number.
10. Doctor sees the student; staff progress the status to In Consultation → Completed.
11. Post-visit, the student may be shown a short service feedback prompt.

**Exception paths:** cancel before the cutoff (slot released); miss the appointment (No-show recorded, counts toward the throttle); doctor takes leave (appointment auto-cancelled, student notified with rebooking options); student arrives late (staff decision — re-queue or forfeit); estimate slips badly (delay notification sent).

### 13.2 Student — walk-in (the path the story omitted)
1. Student arrives without a booking.
2. Staff search for the student by ID and insert them into the live queue using the walk-in allocation.
3. The system issues a serial and recalculates every waiting student's estimate.
4. From this point the flow is identical to §13.1 step 8 onward.

### 13.3 Staff — running a session
1. Staff open the queue console at the start of the day and see all doctors' sessions.
2. They check students in as they arrive, mark fees paid, and insert walk-ins.
3. They progress the current patient through In Consultation → Completed, which advances the queue and refreshes all estimates.
4. They mark no-shows after the configured grace period.
5. They handle emergencies by inserting a priority case, which openly shifts the queue.
6. At end of day they review the collection summary and reconcile it against cash.

### 13.4 Staff — schedule and leave
1. Staff define each doctor's recurring weekly roster and slot configuration.
2. They apply date-specific overrides and mark holidays.
3. When a doctor takes leave, they mark the unavailability; the system lists all affected booked appointments and, on confirmation, cancels them, notifies every affected student, and offers rebooking against remaining availability.
4. All schedule changes are logged with who changed what and when.

### 13.5 Student — medicine
1. Student searches by brand or generic name.
2. Results show status band, OTC/prescription indicator, and a freshness timestamp.
3. Store status shows Open/Closed with today's hours and closing time.
4. Prescription-only items display "requires a doctor's prescription" rather than implying collection.
5. Student travels and collects; the operator records the dispensing, decrementing stock.

### 13.6 Store Operator — inventory
1. Operator receives new stock and records quantity, batch, and expiry.
2. Throughout the day, dispensing events decrement stock.
3. Low-stock thresholds trigger alerts; expiry horizons trigger alerts.
4. Expired stock is quarantined and written off with a reason.
5. Any manual adjustment requires a reason and is recorded in the movement audit trail.
6. Store hours follow a schedule; a manual override (unplanned closure) is possible and expires automatically.

### 13.7 Student — counseling
1. Student opens the Counseling section; crisis resources are visible immediately.
2. Student sees counselor availability windows (not necessarily individual bookable slots — see §14, BR-40).
3. Student submits a request: category, self-reported urgency, optional note, preferred times.
4. If the highest urgency is selected, an interstitial surfaces immediate-contact options before the request is accepted.
5. The request is acknowledged immediately, restating the triage SLA and the office-hours limitation.
6. The counselor triages, may adjust priority, and schedules a session.
7. The student is notified with **discreet content** (see §14, BR-46) and confirms.
8. Student attends; the counselor records the outcome and, if needed, schedules a follow-up.
9. The case is eventually closed. The student sees status only — never counselor notes.

### 13.8 Counselor — caseload
1. Counselor opens the triage queue, sorted by priority then waiting time, with SLA breaches highlighted.
2. They review each new request, set the final priority, and either schedule or request more information.
3. They manage their session calendar and record outcomes.
4. They track follow-ups and overdue cases.
5. Where risk is disclosed, they invoke the documented escalation workflow.
6. Every access to case content is recorded in the access audit log.

### 13.9 Administrator
1. Manages accounts, roles, and account lifecycle.
2. Configures service parameters, calendars, and SLAs.
3. Publishes announcements.
4. Reviews audit logs and generates operational reports.
5. **Cannot read counseling case content.** Emergency access is a logged, justified, notified break-glass action.

---

## 14. Business Rules

Rules the story implied, plus the ones it omitted. These are product policy; DIU must ratify them, particularly the counseling set.

### Identity & access
- **BR-01** Only currently enrolled students may book services. Account status follows enrolment status.
- **BR-02** A student may act only on their own behalf. No proxy booking in v1.
- **BR-03** A user may hold multiple roles; permissions are the union of their roles, except counseling access, which requires an explicit counseling-professional designation.
- **BR-04** Students never see other students' identities anywhere in the system — only anonymous queue counts.
- **BR-05** Provider accounts are created only by an administrator; there is no self-registration for staff.
- **BR-06** Deactivated accounts retain their historical records but cannot log in.

### Appointments & queue
- **BR-10** Bookings open **N days ahead** (default 7) and close at a configurable cutoff before the slot (default: at slot start).
- **BR-11** A student may hold at most **2 active medical bookings** at any time, and at most **1 per doctor per day**.
- **BR-12** Cancellation is free up to **2 hours** before the estimated time; after that it is recorded as a late cancellation.
- **BR-13** A student may reschedule an appointment at most **twice**; beyond that they must cancel and rebook.
- **BR-14** A student not checked in within **20 minutes** of being called is marked **No-show**, at staff discretion.
- **BR-15** **3 no-shows within 30 days** suspends online booking for 14 days. Walk-in access is never blocked — the penalty restricts convenience, never care.
- **BR-16** Each session reserves a configurable **walk-in allocation** (default 30%) that cannot be booked online.
- **BR-17** Emergency cases override queue order. Waiting students are notified that an emergency has shifted their estimate.
- **BR-18** The queue is strictly ordered by serial within a session, except for emergency overrides.
- **BR-19** Displayed times are **estimates**, recalculated from the session's actual pace. The UI must never present them as guaranteed.
- **BR-20** If the estimate slips by more than **30 minutes**, affected students are notified proactively.
- **BR-21** Unclaimed slots become bookable again immediately on cancellation.
- **BR-22** Appointments not checked in by session end are auto-marked **Expired**, not No-show, if the doctor never ran the session.

### Schedules & leave
- **BR-25** The published schedule is the single source of truth; no booking may exist outside a published session.
- **BR-26** Marking a doctor unavailable requires resolving every affected booking before the change is committed.
- **BR-27** Affected students must be notified within **5 minutes** of a cancellation caused by leave, through all their enabled channels.
- **BR-28** Holidays and closure days block booking entirely and display the reason.
- **BR-29** Schedule changes within 24 hours of a session require a stated reason, recorded in the audit log.

### Fees
- **BR-30** The consultation fee is configurable (default 50 BDT) and payable at the counter in v1.
- **BR-31** A booking is confirmed **without** payment; unpaid status blocks consultation, not booking.
- **BR-32** A follow-up visit for the same complaint within **7 days** is fee-exempt. *(Assumption — requires DIU confirmation; see §18, MR-4.)*
- **BR-33** Fee waivers require staff authorisation and a recorded reason.
- **BR-34** The daily collection summary must reconcile against counted cash; discrepancies are recorded, not silently corrected.

### Medicine & inventory
- **BR-35** Students see status bands only — never exact quantities. *(Retained from the story; correct.)*
- **BR-36** Thresholds: **Out of Stock** = 0; **Low Stock** = at or below the item's configured threshold; otherwise **Available**.
- **BR-37** Every status display carries an "as of HH:MM" stamp and states that stock is not reserved.
- **BR-38** Prescription-only items are visible but marked as requiring a prescription; the UI must not imply direct collection.
- **BR-39** Dispensing follows **FEFO** — the earliest-expiring batch is issued first.
- **BR-40** Expired stock is unavailable for dispensing from the expiry date and must be quarantined and written off with a reason.
- **BR-41** Every stock change records who, what, how much, and why. Manual adjustments require a reason.
- **BR-42** Store status defaults to the published schedule; a manual override must carry a reason and expire automatically at end of day.

### Counseling *(must be ratified by DIU counseling professionals before build)*
- **BR-45** The student's self-reported urgency is an **input to triage, never the final priority**. Only a counseling professional sets final priority. *(From the story; strongly endorsed.)*
- **BR-46** Every counseling request receives an automatic acknowledgement within **1 minute** and human triage within **1 working day**.
- **BR-47** Crisis resources are displayed on every counseling screen, before login, and again at submission.
- **BR-48** The system states plainly that it is **not monitored outside office hours**, at the point of submission.
- **BR-49** Counseling notes are readable **only** by designated counseling professionals — not by doctors, medical staff, store operators, or system administrators.
- **BR-50** **Even the existence of a counseling record is confidential.** Non-counseling roles must not be able to infer that a given student has a counseling case.
- **BR-51** Every read of counseling case data is logged with user, record, and timestamp.
- **BR-52** Administrator access to counseling content requires **break-glass**: explicit justification, immediate logging, and automatic notification to the counseling service head. *(This deliberately overrides the story's "System Admin manages everything" framing.)*
- **BR-53** Counseling notifications use discreet wording — no service name, no diagnosis, no counselor specialisation in subject lines or previews.
- **BR-54** Cross-service information sharing (e.g. a doctor's referral note reaching a counselor) requires **recorded student consent**.
- **BR-55** Counseling reporting is aggregate-only, with a **minimum cell size of 10**; no report may allow re-identification.
- **BR-56** A student may withdraw a pending request at any time before it is scheduled.
- **BR-57** Risk disclosure triggers the documented escalation workflow, authored by DIU's counseling service.

### Data & audit
- **BR-60** All state transitions are recorded with actor, timestamp, previous and new state.
- **BR-61** Audit logs are append-only and cannot be edited by any role, including administrators.
- **BR-62** Records are retained per a DIU-approved policy — **which does not yet exist and must be created** (see §18, MR-9).
- **BR-63** Students may view their own appointment history and their own counseling request statuses at any time.
- **BR-64** Personal data is not shared outside the system without documented consent or a legal obligation.

---

## 15. Constraints

| ID | Constraint | Impact | Mitigation |
|----|-----------|--------|-----------|
| **C1** | **Organisational readiness.** Staff must change daily working habits | Highest risk to adoption | Pilot with one doctor; co-design the console with the receptionist; keep paper backup during pilot |
| **C2** | **Doctors will not accept added administrative burden** | Cannot depend on doctor logins | Phase 1 works with zero doctor interaction |
| **C3** | **Inventory accuracy depends entirely on one operator's diligence** | Stale stock data makes the student feature actively harmful | Ruthlessly fast entry UX; freshness timestamps; periodic stock audit |
| **C4** | **Counseling confidentiality is an ethical and possibly regulatory obligation** | Constrains the permission model and reporting | Isolated permission domain; access audit; aggregate-only reporting; counselor sign-off |
| **C5** | **Identity depends on DIU IT** — SSO availability is not guaranteed | Auth approach may need a fallback | Agree the identity approach with IT before Phase 1 begins |
| **C6** | **Student devices are mid-to-low-end on mobile data** | Performance budget is tight | PWA, minimal payload, works on 3G, offline-tolerant read views |
| **C7** | **Campus connectivity can drop at the Medical Center counter** | Queue console cannot assume connectivity | Local-resilient check-in with reconciliation, plus a documented paper fallback |
| **C8** | **Budget is likely minimal (probably an academic/internal project)** | Rules out paid SMS at volume, paid infrastructure, licensed components | Email + in-app first; SMS only for critical events if funded |
| **C9** | **No existing baseline data** | Success cannot be demonstrated | Two-week manual baseline before development |
| **C10** | **Fixed academic timeline (if a capstone project)** | Scope must fit the calendar, not the ambition | Narrow MVP; phases are genuinely optional |
| **C11** | **Small team, likely part-time** | Cannot build ten modules in parallel | Sequential module delivery per §23 |
| **C12** | **Bangladesh has an evolving personal data protection regime** | Compliance target may shift | Design to a defensible baseline: least privilege, audit, consent, retention |
| **C13** | **Single Medical Center assumed** | Multi-center would change scheduling and inventory materially | Confirm in discovery; if multiple centers exist, this is a Phase 1 scope change, not a Phase 3 one |
| **C14** | **Cash-based fee collection** | Reconciliation stays manual in v1 | Daily collection summary; digital payment deferred |

---

## 16. Assumptions

Each assumption is flagged with what happens if it turns out to be false.

| ID | Assumption | If false |
|----|-----------|----------|
| **A1** | DIU operates **one** Medical Center relevant to this system | Multi-center scheduling and per-center inventory become MVP scope |
| **A2** | The counseling service is organisationally separate from the Medical Center but serves the same students | Permission model and reporting lines change |
| **A3** | Students have a university-issued identity usable for authentication | Account provisioning becomes a significant additional workstream |
| **A4** | Only students are in scope; faculty and staff use other arrangements | User base, eligibility rules, and possibly fee rules expand |
| **A5** | The consultation fee is ~50 BDT, flat, per visit | Fee logic (tiers, exemptions, specialisations) becomes more complex |
| **A6** | Medicines are dispensed free or at nominal cost to students | A pricing, billing, and possibly payment layer is needed in the store module |
| **A7** | Doctor duty schedules are reasonably stable week to week | The schedule engine needs to be far more dynamic |
| **A8** | The Medical Center already maintains some medicine list that can seed the catalogue | Initial catalogue entry becomes a substantial manual data-migration task |
| **A9** | The counseling service has, or will author, a documented crisis/escalation protocol | **The counseling module cannot safely launch.** This is a hard dependency, not a nice-to-have |
| **A10** | Counselors are willing to move casework into a shared system | The counseling module has no users; re-plan around a lighter request-intake-only tool |
| **A11** | Reliable internet exists at the Medical Center counter and the store | Offline capability moves from mitigation to MVP requirement |
| **A12** | Email reaches students reliably and is checked | Notification strategy must shift to SMS, which has cost implications |
| **A13** | Doctor-hours are broadly sufficient for demand | Pure slot booking is the wrong model; a lottery/hybrid or capacity increase is needed (§3.3, Claim B) |
| **A14** | DIU will nominate a service owner responsible for the system post-launch | The system decays after handover; plan an explicit ownership transfer |
| **A15** | An English-only interface is acceptable initially | Bangla localisation moves into the MVP, particularly for counseling |
| **A16** | This is a university-internal system, not a commercial product | Licensing, SLAs, and support obligations change |

---

## 17. Risks

Scored as Probability × Impact. Only the material risks are listed.

### Critical

| ID | Risk | P | I | Mitigation |
|----|------|---|---|-----------|
| **R1** | **A student in crisis uses the counseling request as a help channel outside office hours and receives no response** | Med | **Critical** | Crisis layer in MVP (F-CNS-03/04/05); explicit non-monitoring notice; interstitial on high urgency; published SLA; escalation protocol authored by counselors before launch |
| **R2** | **Confidential counseling information is exposed to a non-counseling role** | Med | **Critical** | Isolated permission domain; BR-49/50/51/52; access audit; break-glass with notification; independent review before go-live |
| **R3** | **Medical Center staff abandon the system and revert to paper** | **High** | **Critical** | Walk-in support in MVP; co-design with the receptionist; sub-15-second check-in; pilot with paper backup; measure staff task time explicitly |
| **R4** | **Demand vastly exceeds doctor capacity; online slots vanish instantly and student sentiment worsens** | Med | High | Measure the baseline (§3.3); walk-in allocation (BR-16); consider daily slot release windows; be transparent about capacity |

### High

| ID | Risk | P | I | Mitigation |
|----|------|---|---|-----------|
| **R5** | Inventory data goes stale and students travel for medicine that isn't there | **High** | High | Freshness timestamps; "not reserved" wording; fast operator entry; weekly spot audit |
| **R6** | Doctors decline to engage, blocking schedule maintenance | Med | High | Staff-maintained schedules in Phase 1; doctor login never on the critical path |
| **R7** | Wait estimates are wrong often enough that students stop trusting the app | Med | High | Estimate framing (BR-19); continuous recalculation; proactive delay alerts; measure estimate accuracy as a KPI |
| **R8** | No named service owner after launch; system decays | **High** | High | Secure a sponsor and a named owner as a Phase 1 exit criterion (O11) |
| **R9** | Counselors reject the tool on professional/ethical grounds | Med | High | Co-design from day one; they own the rules; give them a visible confidentiality guarantee |
| **R10** | Scope creep toward a full EMR consumes the timeline | **High** | High | §12.2 is a contract; any EMR-shaped request triggers explicit re-planning |
| **R11** | SSO integration with DIU IT stalls the project | Med | High | Agree the identity approach in discovery; build a documented fallback path |
| **R12** | Students book slots speculatively and no-show en masse | **High** | Med | Booking limits (BR-11), no-show throttle (BR-15), reminders, easy cancellation |

### Medium

| ID | Risk | P | I | Mitigation |
|----|------|---|---|-----------|
| **R13** | Cash reconciliation disputes between the system record and counted cash | Med | Med | Daily collection summary; discrepancies recorded, never overwritten |
| **R14** | Notification content leaks sensitive context on a shared device | Med | High | Discreet content policy (BR-53); no service name in counseling subject lines |
| **R15** | A student books under another student's identity | Low | Med | ID verification at check-in; audit trail |
| **R16** | Poor performance on low-end devices / weak networks | Med | Med | Performance budget; test on real mid-range Android over 3G |
| **R17** | Initial medicine catalogue data entry is underestimated | **High** | Med | Treat as an explicit work package with an owner and a deadline, not a side task |
| **R18** | Aggregate counseling reporting inadvertently permits re-identification | Med | High | Minimum cell size 10 (BR-55); review every report before release |
| **R19** | Timeline slips past the academic deadline (if a capstone) | Med | High | Phase 1 is independently shippable; Phases 2–3 are genuinely optional |
| **R20** | Feedback feature becomes a de facto public rating of individual doctors | Med | Med | Service-level feedback only (§20, SI-9); never publish per-provider scores |

---

## 18. Missing Requirements

Requirements the story does not state but the system cannot ship without. Each needs a decision from DIU.

| ID | Missing requirement | Why it matters | Owner |
|----|--------------------|----------------|-------|
| **MR-1** | **Walk-in patient handling** | The dominant current behaviour; without it the digital and physical queues diverge and staff abandon the system | Product + Medical Center |
| **MR-2** | **Doctor leave → bulk appointment resolution** | Students would otherwise travel to see an absent doctor — the exact problem being solved | Product |
| **MR-3** | **No-show, cancellation, and late-arrival policy** | Without it, free booking invites mass no-shows and slot hoarding | Medical Center |
| **MR-4** | **Fee policy detail** — is 50 BDT per visit? Are follow-ups charged? Are there exemptions? | BR-30–33 are currently assumptions | Accounts + Medical Center |
| **MR-5** | **Payment-to-booking relationship** — pay to book, or pay on arrival? | Fundamentally changes the booking flow and the refund surface | Accounts |
| **MR-6** | **Emergency / triage path at the Medical Center** | A genuinely sick student must not be told "your slot is at 3:20 PM" | Medical Center |
| **MR-7** | **Counseling crisis and escalation protocol** | **Hard blocker for the counseling module.** Must be authored by counseling professionals | Counseling service |
| **MR-8** | **Counseling consent and confidentiality statement** | Students must know who can see what before they disclose anything | Counseling + Administration |
| **MR-9** | **Data retention and disposal policy** — including what happens on graduation | No policy currently exists; medical and counseling records have different obligations | Administration |
| **MR-10** | **Identity and authentication approach** — SSO or standalone | Blocks all account work | DIU IT |
| **MR-11** | **Eligibility rules** — who exactly may use the system | Affects account provisioning and access control | Administration |
| **MR-12** | **Store operating hours and holiday calendar** | Store status cannot be automated without it | Store Operator |
| **MR-13** | **Medicine catalogue with OTC / prescription-only classification** | Determines what the student-facing search may imply | Medical Center pharmacist/doctor |
| **MR-14** | **Whether a low-disclosure or anonymous counseling enquiry is permitted** | Materially affects whether the most reluctant students engage at all | Counseling service |
| **MR-15** | **Reporting requirements** — which reports, for whom, how often | "Reporting System" is currently an empty module name | Medical Center Director |
| **MR-16** | **Language requirement** — Bangla, English, or both | Affects every screen; retrofitting localisation is expensive | Product + Administration |
| **MR-17** | **Accessibility standard** | Health services must be usable by students with disabilities | Product |
| **MR-18** | **Offline / connectivity-loss procedure at the counter** | The queue must survive a network drop | Product + IT |
| **MR-19** | **Support and incident process post-launch** — who fixes a broken queue at 10 AM | Without it the first incident becomes a permanent outage | DIU IT |
| **MR-20** | **Whether doctors need to see a student's previous visits** | This is the EMR boundary; must be decided consciously, not drifted into | Medical Center |
| **MR-21** | **Service level and uptime expectation** | Sets infrastructure and support expectations | IT + Sponsor |
| **MR-22** | **Baseline metrics for all BG targets** | Success cannot otherwise be evidenced | Product |

---

## 19. Missing Business Logic

Specific decision logic the story leaves undefined. These are the questions that surface on day three of development.

**Appointments & queue**
1. **How is the wait estimate computed?** Fixed slot length, rolling average of today's consultations, or per-doctor historical average? *(Recommendation: rolling average of the current session, falling back to the doctor's 30-day average, floored at the configured slot length.)*
2. **What happens when a doctor starts late?** Does the whole queue shift, or do estimates compress?
3. **What if a doctor finishes early?** Are later students invited to arrive sooner? *(Recommendation: notify but never require earlier arrival.)*
4. **How are two doctors on duty simultaneously handled?** One queue per doctor, or a shared pool with any-available-doctor booking?
5. **What is the grace period for a late student, and who decides?** *(Recommendation: 20 minutes, staff discretion, re-queued rather than forfeited.)*
6. **Can a student book for a future date and a same-day slot simultaneously?** BR-11 says yes up to 2 — confirm.
7. **What happens to bookings when a session is cancelled mid-flow** (doctor called away halfway)?
8. **Does the serial number reset daily, per doctor, or run continuously?** Affects student mental model.
9. **How are follow-up visits distinguished from new visits?** Relevant to BR-32's fee exemption.

**Fees**
10. **What is the state of an appointment that is completed but unpaid?** Does that ever happen, and how is it resolved?
11. **Who authorises a waiver, and is there a limit?**
12. **How is a cash discrepancy resolved at end of day?**

**Medicine**
13. **What sets the Low Stock threshold** — a fixed number per item, a percentage, or days-of-supply? *(Recommendation: days-of-supply from consumption rate; it is the only threshold that stays meaningful as demand changes.)*
14. **How much may a single student receive at once?** Without a limit, one student can empty the shelf.
15. **Is a dispensing event linked to a student at all?** The story implies not. Without linkage there is no accountability and no consumption analytics — but linking it makes it health data with corresponding obligations. **This is a real trade-off requiring an explicit decision.**
16. **What happens when a batch expires while stock is showing Available?** Does status recalculate automatically at midnight?
17. **How are partial units handled** (half strips, loose tablets)?
18. **Is there a separate emergency/first-aid stock** excluded from student-facing availability?

**Counseling**
19. **Who receives a request when multiple counselors exist** — a shared pool, or round-robin assignment?
20. **What is the SLA for each priority level?** *(Recommendation: Urgent — same working day; Priority — 2 working days; Normal — 5 working days.)*
21. **What happens when a request breaches its SLA?** Escalation to whom?
22. **Can a student choose a specific counselor?** Gender preference is a genuine and important need in this context and the story does not address it. *(Recommendation: yes, offer a preference field — it materially affects whether some students engage at all.)*
23. **What happens when a student no-shows a counseling session?** A punitive rule would be actively harmful here; the medical no-show policy must **not** be reused.
24. **When is a case auto-closed?** After how long with no activity, and is the student told?
25. **Can a student reopen a closed case,** or must they submit a new request?
26. **Does a doctor's referral create a request automatically,** and does the student have to consent first? *(Recommendation: consent first, always.)*
27. **What is the maximum number of sessions per student,** if the service has capacity limits?

**Cross-cutting**
28. **What is the resolution when a student cancels but the staff have already checked them in?**
29. **How are duplicate accounts or a changed student ID handled?**
30. **What happens to a student's data when they graduate or withdraw mid-programme?**
31. **Who can correct an error in a completed record,** and is the correction visible as a correction?
32. **How does the system behave during a scheduled maintenance window** in the middle of a clinic session?

---

## 20. Suggested Improvements

Improvements that preserve the vision and materially increase the product's value. Ordered by return on effort.

| ID | Improvement | Rationale | Effort |
|----|------------|-----------|--------|
| **SI-1** | **Live queue position instead of a fixed promised time** (§5.2) | Converts the biggest credibility risk into the strongest feature. This is the single highest-value change in this document | Med |
| **SI-2** | **Walk-in support in the MVP** | Without it, the system is fiction within a week | Low |
| **SI-3** | **Crisis-safety layer in the MVP** | Cheap, and the only ethically defensible way to ship counseling intake | Low |
| **SI-4** | **Pre-login availability view** | The most common question ("is a doctor there now?") should not require a login. Removes the largest adoption barrier | Low |
| **SI-5** | **Consultation-room queue display** | A wall screen showing "Now serving: 07" reduces counter interruptions dramatically and needs no user account | Low |
| **SI-6** | **Freshness timestamps on all availability data** | "Available as of 2:14 PM" is honest and defuses the stale-data failure mode | Low |
| **SI-7** | **Counselor gender preference in counseling requests** | For a significant portion of students this is the difference between requesting help and not | Low |
| **SI-8** | **Discreet notification content policy** | A visible-on-lockscreen "Your psychiatry appointment" is a real privacy harm | Low |
| **SI-9** | **Service-level feedback, never individual-provider ratings** | Public doctor ratings would be professionally and politically corrosive in a small internal service, and would guarantee provider resistance | Low |
| **SI-10** | **Bangla + English interface** | Especially in counseling, students express distress in their first language | Med |
| **SI-11** | **Days-of-supply low-stock thresholds** | Fixed numeric thresholds go stale immediately; consumption-based ones stay correct | Med |
| **SI-12** | **Reporting delivered early in Phase 2, not last** | The Director's monthly report is what keeps institutional sponsorship alive | Med |
| **SI-13** | **A documented paper fallback procedure** | Every clinic system needs one. Design it deliberately rather than improvising it during the first outage | Low |
| **SI-14** | **Same-day slot release window** (e.g. a batch opens at 8 AM) | If demand exceeds supply, this is fairer than an instant week-ahead scramble | Low |
| **SI-15** | **Reason-for-visit categories** | Cheap to collect, and produces the first genuinely useful campus health insight ("40% of visits are respiratory in November") | Low |
| **SI-16** | **Announcement banner** | "Medical Center closed 14 Aug" prevents an entire category of wasted trips | Low |
| **SI-17** | **Reserve-for-pickup on prescription-linked medicines** (Phase 2) | Closes the "it was available when I checked" failure without exposing an abusable open reservation | Med |
| **SI-18** | **Consent-gated doctor→counselor referral** (Phase 2) | The most valuable cross-service integration, and the one with the clearest clinical benefit | Med |
| **SI-19** | **Estimate-accuracy as a tracked KPI** | If estimates are wrong more than ~25% of the time, the core feature is failing and you need to know before students tell you | Low |
| **SI-20** | **Explicit "not an emergency service" positioning throughout** | Protects students and the institution | Low |

### Ideas from the story that should be reconsidered

- **"Show the number of appointments"** — useful as a queue-load signal, but must never expose *who* is booked. Show counts only.
- **"Students indicate urgency"** — retain, but as an input to triage only. The story already says this; the UI must reinforce it so students do not feel they can escalate by declaring urgency, and so genuinely urgent students are not deterred by a fear of "wasting" the flag.
- **"System Admin manages the overall system"** — must be narrowed. Administrators manage identity, configuration, and infrastructure; they do not read counseling content. The story's actor table and its own §9 privacy statement contradict each other on this point.
- **"Payment gateway as a seventh actor"** — correctly deferred, but it should be deferred *explicitly with a rationale*, not left as an open ambition that invites premature design.

---

## 21. Scalability Considerations

Framed as product and operational scalability, not technical architecture.

**Volume scalability**
- Realistic scale is bounded: tens of thousands of students, tens of consultations per doctor-session, low hundreds of medicine SKUs. This is **not a high-volume system**; over-engineering for scale is the wrong instinct.
- The genuine load spike is **concentrated, not sustained**: if same-day slots release at 8 AM, a large fraction of daily traffic arrives in a 60-second window. Design the release mechanism (SI-14) to absorb this — staggered release or a queued release is a product answer to a load problem.
- Live queue updates are the other concentration point: many students watching one session simultaneously. Polling intervals and update granularity are product decisions with direct cost implications.

**Functional scalability**
- **Multiple doctors per session** must be supported from day one; multiple *sessions* per doctor per day should be assumed.
- **Multiple counselors** with a shared or assigned pool must be a configuration choice, not a rewrite (§19, Q19).
- **Multiple medicine stores or sub-stores** should be anticipated as a possibility even if only one exists today.

**Organisational scalability**
- **Multi-campus** is the most likely real expansion (DIU operates across more than one location). If a second Medical Center is ever in scope, schedules, inventory, queues, and reporting all become location-scoped. **Confirm in discovery (§16, A1)** — discovering this in Phase 3 is far more expensive than accommodating it in Phase 1's product model.
- **User-base expansion** to faculty, staff, and dependants is a plausible Phase 3 request. Eligibility, fees, and possibly dependant relationships would all need to change.
- **Service expansion** — dental, physiotherapy, vaccination drives, health camps — should be anticipated as "another bookable service type" rather than a third hard-coded module.

**Data scalability**
- Counseling case histories accumulate and are the most sensitive data in the system; retention policy (MR-9) is a scalability issue as much as a compliance one.
- Audit logs grow fastest of anything here. Plan retention and archival for them explicitly.
- Reporting demand grows once leadership sees the first monthly report. Expect requests for trends, comparisons, and drill-downs within two months of the first report.

**Operational scalability**
- **The single store operator is the hardest bottleneck in the system.** Every student-facing medicine feature depends on one person's data entry. Any growth in SKUs or dispensing volume must be matched by faster entry, not more discipline.
- **Support capacity** — one part-time administrator is fine at pilot scale and inadequate once three services and thousands of students depend on it. Define the support model before rollout (MR-19).
- **Counselor capacity is finite and cannot be scaled by software.** Making counseling easier to request *will increase demand* — this is a success, but it will surface capacity limits that were previously hidden by the friction of email. **Warn the counseling service of this before launch;** it is the most predictable and least anticipated consequence of the entire project.

---

## 22. MVP Definition

### 22.1 MVP thesis

> **A student can find out whether a doctor is available, reserve a place in the queue from their room, watch the queue move, and arrive at roughly the right time — while the front desk runs the whole day, walk-ins included, on one screen. Alongside it, students can check medicine availability before travelling, and can submit a counseling request that is acknowledged, triaged, and scheduled instead of vanishing into an inbox.**

If the MVP delivers only that, and delivers it reliably enough that the paper register is retired at the pilot site, the project has succeeded.

### 22.2 MVP scope

**In the MVP**
- University-identity login; six roles; strict inter-service permission isolation
- Student dashboard with three service entry points and pre-login availability view
- Doctor profiles, weekly rosters, date overrides, holidays, leave with bulk appointment resolution
- Slot booking → appointment ID + serial → confirmation
- **Live queue position and dynamically recalculated wait estimate**
- Staff queue console: check-in, status progression, **walk-in insertion**, emergency insertion, no-show marking
- Booking limits and no-show throttling
- Fee status recording at the counter + daily collection summary
- Medicine catalogue with OTC/prescription classification
- Student medicine search with status bands, freshness stamps, and store open/closed with hours
- Operator inventory: stock receipt with batch and expiry, dispensing, adjustments with reasons, low-stock alerts, full movement audit
- Counseling: counselor availability, request submission with category and urgency, **full crisis-safety layer**, automatic acknowledgement with SLA, counselor triage queue, counselor-set priority, session scheduling, session-completed status, confidential counselor-only notes, **access audit logging**, escalation workflow
- In-app + email notifications with discreet content policy
- Admin: accounts, roles, service configuration, calendars, audit log viewer

**Explicitly excluded from the MVP**
- Online payment · digital prescriptions · prescription-linked dispensing · reserve-for-pickup · alternatives suggestion · doctor self-service console · doctor-side clinical notes · counseling follow-up chains and case reassignment · SMS · web push · reporting dashboards (manual export only in MVP) · native apps · telemedicine · 2FA · anonymous enquiry · Bangla localisation *(reconsider if MR-16 resolves to Bangla-required, in which case it moves in)*

### 22.3 MVP success criteria

The MVP is validated only if, after **four weeks of pilot**:

| Criterion | Target |
|-----------|--------|
| Consultations that began as an online booking | ≥ 30% |
| Staff check-in time per student | ≤ 15 seconds |
| Staff using the system as the primary record (paper retired) | Yes, at the pilot site |
| Wait estimates accurate within ±15 minutes | ≥ 75% of appointments |
| Counseling requests acknowledged within SLA | 100% |
| Counseling requests human-triaged within 1 working day | ≥ 95% |
| Medicine availability status accurate on spot-check | ≥ 90% |
| Confidentiality incidents | 0 |
| Students who would recommend it | ≥ 70% |

**Kill criteria — if any of these hold at week four, stop and re-plan rather than roll out:**
- Staff have reverted to paper as the primary record.
- Wait-estimate accuracy is below 50% (the core promise is not deliverable and must be redesigned).
- Any confidentiality incident in the counseling module.
- Online bookings are below 10% (students are not adopting; the problem diagnosis in §3.3 was wrong).

---

## 23. Product Roadmap

### Phase 1 — Foundation & Core Services *(MVP)*

**Theme:** *Make the invisible visible, and make the front desk faster than paper.*

**Delivers:** all of §22.2.

**Sequence within the phase:**
1. Discovery, baseline measurement, policy decisions (MR-3, MR-4, MR-5, MR-7, MR-10, MR-11, MR-13), sponsor and owner confirmation
2. Identity, roles, permission isolation
3. Doctor schedules, calendars, leave handling
4. Booking, serial, live queue, staff console, walk-ins *(the heart of the release)*
5. Fee status and daily collection summary
6. Medicine catalogue, operator inventory, student search
7. Counseling intake, crisis layer, triage, scheduling, confidential notes, access audit
8. Notifications
9. Security and privacy review *(gate — the counseling module does not touch real data until this passes)*
10. Single-doctor pilot → measure against §22.3 → full rollout

**Exit criteria:** all §22.3 targets met at the pilot site; no kill criteria triggered; paper register retired at the pilot site; a named service owner is in place.

---

### Phase 2 — Depth, Integration & Institutional Value

**Theme:** *Connect the services to each other, and give leadership the numbers.*

**Delivers:**
- **Digital prescriptions** (narrowly scoped: drug, strength, quantity, duration — **not** clinical narrative)
- **Dispensing against a prescription** with automatic stock decrement and full traceability
- **Reserve-for-pickup** on prescription-linked medicines
- **Expiry management**: horizon alerts, FEFO guidance, quarantine and write-off workflow
- **Reporting dashboards** — medical, medicine, and aggregate-only counseling *(deliver this early in the phase; it is what sustains sponsorship)*
- **Counseling case depth**: follow-up chains, case reassignment, caseload analytics, consent-gated cross-service sharing
- **Consent-gated doctor → counselor referral**
- **Doctor self-service console** (optional for doctors, never required)
- **Appointment reschedule** and richer exception handling
- **Consultation-room queue display**
- **SMS notifications** for critical events, if funded
- **Two-factor authentication** for counselor and admin accounts
- **Bangla localisation** *(if not already pulled into Phase 1)*
- **Service feedback capture**
- **Formal data retention policy enforcement**

**Exit criteria:** monthly reporting is produced from the system for three consecutive months; prescription-linked dispensing covers the majority of dispensing events; counseling follow-up completion is measurable.

---

### Phase 3 — Scale, Convenience & Expansion

**Theme:** *Remove the remaining friction, and extend beyond one center.*

**Delivers:**
- **Online consultation-fee payment** (bKash / SSLCommerz or equivalent), including refunds, dispute handling, and reconciliation with Accounts
- **Multi-center / multi-campus** support: location-scoped schedules, inventory, queues, and reporting
- **Extended user base**: faculty, staff, and possibly dependants, with eligibility and fee rules
- **New service types**: dental, physiotherapy, vaccination and health camps, as configurable bookable services rather than new modules
- **Tele-counseling** (video sessions), subject to a dedicated privacy and platform review
- **Reorder suggestions** from consumption history; supplier and purchase-order tracking
- **Advanced analytics**: seasonal illness trends, peak-demand forecasting, capacity planning for the Director
- **Deeper university-system integration** beyond identity
- **Web push and offline-capable PWA**
- **Public health dashboards** (aggregate, anonymised) for campus health awareness

**Explicitly still out at the end of Phase 3:** full EMR, clinical decision support, symptom triage, ambulance dispatch, insurance/claims.

---

## 24. Development Milestones

Durations are indicative for a small, part-time team and should be re-based once team size is known. The **gates** matter more than the dates.

| # | Milestone | Key deliverables | Duration | Gate / exit criterion |
|---|-----------|-----------------|----------|----------------------|
| **M0** | **Discovery & Sign-off** | Stakeholder interviews; two-week baseline measurement; policy decisions (MR-3/4/5/7/10/11/13); confirmed sponsor and post-launch owner; validated §3.3 premises; signed scope | 3 weeks | **Gate: written sign-off from Medical Center, counseling service, and DIU IT. No development starts without it.** |
| **M1** | **Foundations** | Identity and authentication; role model; permission isolation; admin account management; audit logging skeleton; student dashboard shell | 3 weeks | A user of each role can log in and sees only their own domain |
| **M2** | **Schedules** | Doctor profiles; weekly rosters; date overrides; holiday calendar; leave marking with bulk appointment resolution; schedule audit | 2 weeks | Staff can publish a week of schedules and take a doctor off duty cleanly |
| **M3** | **Appointments & Queue** *(the critical milestone)* | Booking; serial generation; confirmation; cancellation; live queue position and dynamic estimates; staff queue console; check-in; status progression; **walk-in insertion**; emergency insertion; no-show handling; booking limits | 5 weeks | **Gate: a receptionist runs a simulated full clinic day — 25 patients, 8 walk-ins, 1 emergency, 3 no-shows — without touching paper** |
| **M4** | **Fees** | Fee configuration; payment status; counter recording with receipt; waivers; daily collection summary | 1.5 weeks | A day's collections reconcile against counted cash |
| **M5** | **Medicine** | Catalogue with OTC/prescription classification; student search with status bands and freshness stamps; store hours and status; operator stock receipt with batch and expiry; dispensing; adjustments with reasons; low-stock alerts; movement audit | 4 weeks | **Gate: catalogue is populated with real data and the operator completes a full working day in the system** |
| **M6** | **Counseling — Safety & Intake** | Counselor profiles and availability; request submission; **crisis banner, non-monitoring notice, urgency interstitial**; automatic acknowledgement with SLA; student status tracking | 2.5 weeks | **Gate: DIU counseling professionals sign off on every safety message and the escalation protocol** |
| **M7** | **Counseling — Triage & Cases** | Triage queue; counselor-set priority with override reasons; scheduling; case lifecycle; confidential notes; caseload view; access audit logging; escalation workflow | 3 weeks | A counselor runs a full triage-to-session cycle; access audit demonstrably records every read |
| **M8** | **Notifications** | In-app centre; email; templates with discreet content policy; all event triggers; operator and counselor alerts | 1.5 weeks | Every trigger fires correctly; no counseling notification reveals the service in its subject or preview |
| **M9** | **Hardening & Review** | Security and privacy review; permission-isolation testing; performance on mid-range Android over 3G; connectivity-loss handling; paper fallback procedure; accessibility pass; user documentation; staff training materials | 3 weeks | **Gate: privacy review passes. The counseling module handles no real student data before this gate.** |
| **M10** | **Pilot** | One doctor, one counselor, live store data; paper backup retained; daily observation; measurement against §22.3 | 4 weeks | **Gate: §22.3 criteria met; no kill criterion triggered** |
| **M11** | **Rollout** | All doctors; all counselors; full student communication campaign; support process live; ownership handover | 2 weeks | Paper register retired; named owner accepted handover; Phase 1 closed |

**Indicative Phase 1 total: ~34 weeks** for a small part-time team, of which roughly a quarter is discovery, hardening, pilot, and rollout rather than feature construction. That proportion is deliberate and should be defended — it is the part most often cut, and cutting it is what turns working software into shelfware.

**Phase 2:** ~16–20 weeks. **Phase 3:** ~20–24 weeks, and should be re-planned from real usage data rather than from this document.

### Critical path and dependencies

- **M0 → everything.** MR-7 (crisis protocol) and MR-10 (identity) are hard blockers for M6 and M1 respectively.
- **M3 is the highest-risk milestone** and carries the most novel logic (live estimation + walk-in reconciliation). Give it the most experienced person and the most slack.
- **M5 depends on MR-13** — the classified catalogue. Catalogue data entry (R17) is a separate work package with its own owner; it is routinely underestimated and it can start during M1.
- **M6 cannot begin without counseling professional engagement.** If they are unavailable, re-sequence rather than build the module speculatively.
- **M9 and M10 are not optional.** Any pressure to cut them should be met with a scope reduction elsewhere instead.

---

## Appendix A — Summary of Recommended Changes to the Story

For traceability, everything this document changes or adds relative to the source story:

| # | Change | Type | Section |
|---|--------|------|---------|
| 1 | Product renamed DIU MediCare → **DIU CampusCare** throughout | Correction | — |
| 2 | Fixed appointment time → **serial + live queue position with recalculated estimates** | Major change | §5.2 |
| 3 | **Walk-in patients** added as a first-class flow | Major addition | §5.2, §13.2 |
| 4 | **Crisis-safety layer** specified and moved into the MVP | Major addition | §5.2, §10 M7 |
| 5 | **Doctor leave → bulk appointment resolution** added | Major addition | §10 F-SCH-06 |
| 6 | **No-show, cancellation, and reschedule policy** defined | Addition | §14 BR-12–15 |
| 7 | **OTC vs prescription-only classification** added to the medicine catalogue | Addition | §5.3 |
| 8 | **Prescription-linked dispensing** proposed for Phase 2 | Addition | §5.3, §23 |
| 9 | **Freshness timestamps and "not reserved"** wording on availability | Addition | §14 BR-37 |
| 10 | **Batch, expiry, FEFO, and write-off** workflows specified | Addition | §10 M6 |
| 11 | Store status driven by **scheduled hours** with expiring manual override | Change | §14 BR-42 |
| 12 | **Administrator excluded from counseling content**; break-glass introduced | Change *(contradicts the story's actor table)* | §14 BR-52 |
| 13 | **Existence of a counseling record** made confidential, not just its content | Addition | §14 BR-50 |
| 14 | **Access audit logging** for all counseling reads | Addition | §14 BR-51 |
| 15 | **Discreet notification content policy** | Addition | §14 BR-53 |
| 16 | **Counselor gender preference** in counseling requests | Addition | §20 SI-7 |
| 17 | **Counseling no-show must not be penalised** like a medical no-show | Addition | §19 Q23 |
| 18 | **Aggregate-only counseling reporting** with minimum cell size | Addition | §14 BR-55 |
| 19 | Online payment **explicitly deferred to Phase 3** with rationale | Change | §11.3 |
| 20 | **Pre-login availability view** added | Addition | §20 SI-4 |
| 21 | **Consultation-room queue display** added | Addition | §20 SI-5 |
| 22 | **Service-level feedback only**, never per-doctor public ratings | Addition | §20 SI-9 |
| 23 | **Doctor login removed from the critical path** for Phase 1 | Change | §9 Persona 4 |
| 24 | **Baseline measurement** made a prerequisite | Addition | §6, §24 M0 |
| 25 | **Bangla localisation** raised as a likely MVP requirement | Addition | §18 MR-16 |
| 26 | **EMR boundary** explicitly drawn and defended | Clarification | §12.2, §12.3 |
| 27 | **Capacity-vs-demand validation** required before committing to pure slot booking | Challenge | §3.3 |
| 28 | **Medicine-store non-use hypothesis** required to be validated | Challenge | §3.3 |
| 29 | **Kill criteria** defined for the pilot | Addition | §22.3 |
| 30 | Counseling demand **will rise** once friction is removed — capacity warning | Challenge | §21 |

---

*End of Project Planning Document v1.0 — DIU CampusCare.*
