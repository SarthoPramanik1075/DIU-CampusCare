import type { RoleCode } from '@campuscare/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import { AnnouncementList } from '../features/announcements/AnnouncementList.js';
import { useLogout, useSession } from '../features/auth/use-session.js';
import { AvailabilityList } from '../features/availability/AvailabilityList.js';
import { AppHeader } from '../shared/AppHeader.js';

/**
 * Each role's real home, once it has one. `DOC` has none — FRONTEND §10.8
 * records that as a decision, not a gap ("no Phase 1 function requires it";
 * `/staff` covers the doctor-duty workflow) — and `CNP` has none yet either:
 * every counseling screen is required to carry the crisis banner (FR-CNS-03),
 * and its content is the still-unsupplied `[R3]` protocol
 * (`apps/counseling-api/content/crisis-protocol/README.md`), the same
 * blocking dependency that already makes `counseling-api` refuse to start.
 */
const ROLE_HOME: Partial<Record<RoleCode, { readonly to: string; readonly label: string }>> = {
  STU: { to: '/student', label: 'Go to your dashboard' },
  MCS: { to: '/staff', label: 'Go to the medical centre' },
  STO: { to: '/operator', label: 'Go to the medicine store' },
  ADM: { to: '/admin/users', label: 'Go to account administration' },
};

/**
 * P-01 · Landing / public availability (FRONTEND §10.1) — the M0.5 vertical
 * slice, M1's real sign-in state, and M2's doctor duty-roster availability
 * (`GET /api/v1/public/availability`, `AvailabilityList`). Medicine-store
 * status is still absent — the pharmacy module is a later milestone. The
 * body below the header can still be visually quiet on a day with no
 * announcements and nothing published in the availability window —
 * `AnnouncementList`/`AvailabilityList` both intentionally render nothing
 * rather than an invented "all clear" card (see their own doc comments);
 * the placeholder content ban applies here just as much as anywhere else.
 */
export function LandingPage(): JSX.Element {
  const session = useSession();
  const logout = useLogout();
  const queryClient = useQueryClient();
  const currentSession = session.data;

  return (
    <>
      <AppHeader>
        {currentSession === undefined ? null : currentSession === null ? (
          <Link to="/sign-in">Sign in</Link>
        ) : (
          <>
            <span>Signed in as {currentSession.fullName}</span>
            <button
              type="button"
              className="cc-app-header__signout"
              onClick={() => {
                logout.mutate(currentSession.csrfToken, {
                  onSuccess: () => void queryClient.invalidateQueries(),
                });
              }}
            >
              Sign out
            </button>
          </>
        )}
      </AppHeader>
      <main style={{ maxWidth: 'var(--container-content)', margin: '0 auto', padding: 'var(--space-4) var(--space-3)' }}>
        <h1 style={{ marginTop: 0 }}>DIU CampusCare</h1>
        {currentSession?.roles.map((role) => {
          const home = ROLE_HOME[role];
          if (home === undefined) return null;
          return (
            <p key={role} style={{ marginTop: 0 }}>
              <Link to={home.to}>{home.label}</Link>
            </p>
          );
        })}
        <AnnouncementList />
        <AvailabilityList />
      </main>
    </>
  );
}
