import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import { AnnouncementList } from '../features/announcements/AnnouncementList.js';
import { useLogout, useSession } from '../features/auth/use-session.js';

/**
 * P-01 · Landing / public availability (FRONTEND §10.1) — the M0.5 vertical
 * slice plus M1's real sign-in state. The full P-01 wireframe additionally
 * shows doctor duty-roster availability (`GET /api/v1/public/availability`)
 * and medicine-store status; neither endpoint exists yet (SCH and pharmacy
 * modules are later milestones), so this page renders only what is real:
 * live announcements and the caller's actual session state.
 */
export function LandingPage(): JSX.Element {
  const session = useSession();
  const logout = useLogout();
  const queryClient = useQueryClient();
  const currentSession = session.data;

  return (
    <main style={{ maxWidth: 'var(--container-content)', margin: '0 auto', padding: 'var(--space-3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
        <h1 style={{ fontSize: 'var(--text-2xl)' }}>DIU CampusCare</h1>
        {currentSession === undefined ? null : currentSession === null ? (
          <Link to="/sign-in">Sign in</Link>
        ) : (
          <span>
            Signed in as {currentSession.fullName}{' '}
            <button
              type="button"
              style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', textDecoration: 'underline', padding: 0, font: 'inherit' }}
              onClick={() => {
                logout.mutate(currentSession.csrfToken, {
                  onSuccess: () => void queryClient.invalidateQueries(),
                });
              }}
            >
              Sign out
            </button>
          </span>
        )}
      </div>
      <AnnouncementList />
    </main>
  );
}
