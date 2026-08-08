import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { JSX, ReactNode } from 'react';

import './StaffShell.css';
import type { SessionDto } from '../features/auth/api.js';
import { useLogout } from '../features/auth/use-session.js';

export interface StaffShellProps {
  readonly session: SessionDto;
  readonly pageTitle: string;
  readonly children: ReactNode;
}

/**
 * FRONTEND §2.3's persistent left rail (MCS/STO share this pattern; §2.1
 * gives the same reasoning to both — "desktop at a counter," "same
 * reasoning" for the operator). The rail's real destinations — Queue,
 * Walk-in, Payments, Schedule, Doctors for MCS; Catalogue, Stock, Store
 * for STO — are all later milestones (M2+), so, same as `AdminShell`, the
 * nav area renders nothing rather than a link to a page that doesn't
 * exist.
 *
 * The rail's `ConnectionIndicator` (§2.3, "a staff member acting on a
 * dropped connection needs to know before they act") is also omitted
 * rather than faked: it exists to warn about queued *offline actions*
 * (NFR-REL-04), and no staff action exists yet for anything to queue. A
 * cosmetic "● Online" with nothing behind it would be exactly the
 * placeholder UI this project refuses to ship.
 */
export function StaffShell({ session, pageTitle, children }: StaffShellProps): JSX.Element {
  const logout = useLogout();
  const queryClient = useQueryClient();

  return (
    <div className="cc-staff-shell">
      <aside className="cc-staff-rail">
        <Link to="/" className="cc-staff-rail__brand">
          DIU CampusCare
        </Link>
        <nav className="cc-staff-rail__nav" aria-label="Staff" />
        <div className="cc-staff-rail__footer">
          <p className="cc-staff-rail__user">{session.fullName}</p>
          <button
            type="button"
            className="cc-staff-rail__signout"
            onClick={() => {
              logout.mutate(session.csrfToken, { onSuccess: () => void queryClient.invalidateQueries() });
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <div className="cc-staff-shell__main">
        <header className="cc-staff-shell__header">
          <h1>{pageTitle}</h1>
        </header>
        <main className="cc-staff-shell__content">{children}</main>
      </div>
    </div>
  );
}
