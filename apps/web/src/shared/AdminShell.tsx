import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { JSX, ReactNode } from 'react';

import './AdminShell.css';
import type { SessionDto } from '../features/auth/api.js';
import { useLogout } from '../features/auth/use-session.js';

export interface AdminShellProps {
  readonly session: SessionDto;
  readonly pageTitle: string;
  readonly children: ReactNode;
}

/**
 * FRONTEND §2.4's admin rail is specified with four groups (Operations,
 * People, Configuration, plus Break-glass on its own) spanning nine
 * destinations. Accounts (A-02/A-03/A-04) and the service calendar (A-06,
 * M2) are the only real screens so far — Health (A-01), Audit log (A-08),
 * Exports (A-11), a stand-alone Roles list, Settings (A-05), Announcements
 * admin (A-07) and Break-glass (A-09) are all later milestones. A group
 * heading with no links, or a link to a page that doesn't exist yet, is
 * exactly the placeholder chrome this project refuses to ship — so only
 * People and Configuration render, each with its one real destination.
 */
export function AdminShell({ session, pageTitle, children }: AdminShellProps): JSX.Element {
  const logout = useLogout();
  const queryClient = useQueryClient();

  return (
    <div className="cc-admin-shell">
      <aside className="cc-admin-rail">
        <Link to="/" className="cc-admin-rail__brand">
          DIU CampusCare
        </Link>
        <nav className="cc-admin-rail__nav" aria-label="Admin">
          <p className="cc-admin-rail__group-label">People</p>
          <Link
            to="/admin/users"
            className="cc-admin-rail__link"
            activeProps={{ className: 'cc-admin-rail__link cc-admin-rail__link--active' }}
          >
            Accounts
          </Link>
          <p className="cc-admin-rail__group-label">Configuration</p>
          <Link
            to="/admin/calendar"
            className="cc-admin-rail__link"
            activeProps={{ className: 'cc-admin-rail__link cc-admin-rail__link--active' }}
          >
            Calendar
          </Link>
        </nav>
        <div className="cc-admin-rail__footer">
          <p className="cc-admin-rail__user">{session.fullName}</p>
          <button
            type="button"
            className="cc-admin-rail__signout"
            onClick={() => {
              logout.mutate(session.csrfToken, { onSuccess: () => void queryClient.invalidateQueries() });
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <div className="cc-admin-shell__main">
        <header className="cc-admin-shell__header">
          <h1>{pageTitle}</h1>
        </header>
        <main className="cc-admin-shell__content">{children}</main>
      </div>
    </div>
  );
}
