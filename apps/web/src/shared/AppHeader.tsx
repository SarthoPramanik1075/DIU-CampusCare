import { Link } from '@tanstack/react-router';
import type { JSX, ReactNode } from 'react';

import './AppHeader.css';

export interface AppHeaderProps {
  readonly children?: ReactNode;
}

/**
 * FRONTEND §2.1's public top bar: "Top bar, three links, no menu — two or
 * three destinations." Only the wordmark and the sign-in/session slot are
 * real destinations today; `Availability`/`Medicine` are not added here
 * because neither has a page behind it yet (P-01's full availability view
 * is M2/M3, P-02's search is M5) — an unstyled bar with working content is
 * the honest state, a styled bar with a link to nothing is not.
 */
export function AppHeader({ children }: AppHeaderProps): JSX.Element {
  return (
    <header className="cc-app-header">
      <div className="cc-app-header__inner">
        <Link to="/" className="cc-app-header__brand">
          DIU CampusCare
        </Link>
        <div className="cc-app-header__slot">{children}</div>
      </div>
    </header>
  );
}
