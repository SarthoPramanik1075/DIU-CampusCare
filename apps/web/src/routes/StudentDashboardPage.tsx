import { useQueryClient } from '@tanstack/react-query';
import type { JSX } from 'react';

import type { SessionDto } from '../features/auth/api.js';
import { useLogout } from '../features/auth/use-session.js';
import { useDashboard } from '../features/dashboard/use-dashboard.js';
import { AppHeader } from '../shared/AppHeader.js';
import { Banner } from '../shared/primitives/Banner.js';
import { Card } from '../shared/primitives/Card.js';
import { Icon } from '../shared/primitives/icons.js';
import { Skeleton } from '../shared/Skeleton.js';

interface StudentDashboardPageProps {
  readonly session: SessionDto;
}

/**
 * S-01 · Student dashboard (FRONTEND §9.1). `upcomingAppointments` and
 * `todaysDoctors` render their real, honest empty states — nothing books
 * or schedules anything until M2 — and the "Support" (counseling) tile is
 * entirely absent rather than a disabled placeholder: FR-DASH-03's status
 * panel doesn't exist as a real feature yet, and a tile that goes nowhere
 * is exactly the placeholder UI this project refuses to ship. Navigation
 * is the header only, for the same reason (FRONTEND §2.2's four tabs need
 * three destinations — Book, Medicine, More — that don't exist yet).
 */
export function StudentDashboardPage({ session }: StudentDashboardPageProps): JSX.Element {
  const dashboard = useDashboard();
  const logout = useLogout();
  const queryClient = useQueryClient();

  return (
    <>
      <AppHeader>
        {dashboard.data !== undefined && dashboard.data.notifications.unreadCount > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-0-5)' }}>
            <Icon name="bell" aria-hidden="true" />
            {dashboard.data.notifications.unreadCount}
          </span>
        )}
        <span>{session.fullName}</span>
        <button
          type="button"
          className="cc-app-header__signout"
          onClick={() => {
            logout.mutate(session.csrfToken, { onSuccess: () => void queryClient.invalidateQueries() });
          }}
        >
          Sign out
        </button>
      </AppHeader>

      <main style={{ maxWidth: 'var(--container-content)', margin: '0 auto', padding: 'var(--space-3)' }}>
        {dashboard.isPending && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }} aria-busy="true">
            <Skeleton width="100%" height="80px" />
            <Skeleton width="100%" height="160px" />
          </div>
        )}

        {dashboard.isError && (
          <Banner tone="danger" message="Your dashboard couldn't be loaded right now. Try refreshing the page." />
        )}

        {dashboard.data !== undefined && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {dashboard.data.announcements.map((announcement) => (
              <Banner key={announcement.id} tone="info" message={announcement.body} />
            ))}

            {dashboard.data.bookingSuspension !== null && (
              <Banner
                tone="warning"
                heading="Online booking is paused on your account"
                message={`${dashboard.data.bookingSuspension.reason} You can still come to the medical centre as a walk-in and you will be seen.`}
              />
            )}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: 'var(--space-3)',
              }}
            >
              <Card title="Next appointment">
                {dashboard.data.upcomingAppointments.length === 0 ? (
                  <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>No upcoming appointments.</p>
                ) : null}
              </Card>

              <Card title="Today">
                <p style={{ margin: 0, fontWeight: 600 }}>Medicine store</p>
                <p style={{ margin: 'var(--space-0-5) 0 var(--space-2)', display: 'flex', alignItems: 'center', gap: 'var(--space-0-5)', color: dashboard.data.medicineStore.isOpen ? 'var(--color-success)' : 'var(--color-text-secondary)' }}>
                  <Icon name={dashboard.data.medicineStore.isOpen ? 'check' : 'clock'} aria-hidden="true" />
                  {dashboard.data.medicineStore.isOpen && dashboard.data.medicineStore.closesAt !== null
                    ? `Open until ${dashboard.data.medicineStore.closesAt.slice(0, 5)}`
                    : 'Closed'}
                </p>

                <p style={{ margin: 0, fontWeight: 600 }}>Doctors on duty</p>
                {dashboard.data.todaysDoctors.length === 0 && (
                  <p style={{ margin: 'var(--space-0-5) 0 0', color: 'var(--color-text-secondary)' }}>No duty information available yet.</p>
                )}
              </Card>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
