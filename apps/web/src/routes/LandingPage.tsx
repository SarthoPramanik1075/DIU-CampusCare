import type { JSX } from 'react';

import { AnnouncementList } from '../features/announcements/AnnouncementList.js';

/**
 * P-01 · Landing / public availability (FRONTEND §10.1) — the M0.5 vertical
 * slice only. The full P-01 wireframe additionally shows doctor duty-roster
 * availability (`GET /api/v1/public/availability`) and medicine-store
 * status; neither endpoint exists yet (SCH and pharmacy modules are later
 * milestones), so this page renders only what is real: live announcements.
 * A "Sign in" affordance is likewise omitted — the AUTH module has no login
 * flow yet, and a button that does nothing is exactly the placeholder UI
 * the project rules forbid.
 */
export function LandingPage(): JSX.Element {
  return (
    <main style={{ maxWidth: 'var(--container-content)', margin: '0 auto', padding: 'var(--space-3)' }}>
      <h1 style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-3)' }}>DIU CampusCare</h1>
      <AnnouncementList />
    </main>
  );
}
