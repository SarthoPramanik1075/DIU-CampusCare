import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import { AnnouncementList } from '../features/announcements/AnnouncementList.js';
import { useLogout, useSession } from '../features/auth/use-session.js';
import { AppHeader } from '../shared/AppHeader.js';

/**
 * P-01 · Landing / public availability (FRONTEND §10.1) — the M0.5 vertical
 * slice plus M1's real sign-in state. The full P-01 wireframe additionally
 * shows doctor duty-roster availability (`GET /api/v1/public/availability`)
 * and medicine-store status; neither endpoint exists yet (SCH and pharmacy
 * modules are later milestones), so this page renders only what is real:
 * live announcements and the caller's actual session state. That is also
 * why the body below the header can be visually quiet on a day with no
 * announcements — `AnnouncementList` intentionally renders nothing rather
 * than an invented "all clear" card (see its own doc comment); the
 * placeholder content ban applies here just as much as anywhere else.
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
        {currentSession !== null && currentSession !== undefined && currentSession.roles.includes('STU') && (
          <p style={{ marginTop: 0 }}>
            <Link to="/student">Go to your dashboard</Link>
          </p>
        )}
        {currentSession !== null && currentSession !== undefined && currentSession.roles.includes('ADM') && (
          <p style={{ marginTop: 0 }}>
            <Link to="/admin/users">Go to account administration</Link>
          </p>
        )}
        <AnnouncementList />
      </main>
    </>
  );
}
