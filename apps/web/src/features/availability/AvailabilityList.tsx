import { useId, type JSX } from 'react';

import { SessionStatusDisplay } from '../../features/sessions/SessionStatusDisplay.js';
import { Banner } from '../../shared/primitives/Banner.js';
import { Skeleton } from '../../shared/Skeleton.js';
import { useDelayedFlag } from '../../shared/use-delayed-flag.js';

import type { PublicAvailabilityDayDto } from './api.js';
import './AvailabilityList.css';
import { usePublicAvailability } from './use-availability.js';

const SKELETON_DELAY_MS = 300;
const LOADING_TEXT_DELAY_MS = 2000;

function formatDayHeading(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Dhaka' });
}

function DayRow({ day }: { readonly day: PublicAvailabilityDayDto }): JSX.Element {
  if (!day.isServiceDay) {
    return (
      <div role="listitem" className="cc-availability-day cc-availability-day--closed">
        <h3>{formatDayHeading(day.date)}</h3>
        <p>Closed{day.closureReason !== null && day.closureReason.length > 0 ? ` — ${day.closureReason}` : ''}</p>
      </div>
    );
  }

  return (
    <div role="listitem" className="cc-availability-day">
      <h3>{formatDayHeading(day.date)}</h3>
      {day.sessions.length === 0 ? (
        <p style={{ color: 'var(--color-text-secondary)' }}>No sessions scheduled.</p>
      ) : (
        day.sessions.map((session) => (
          <div key={session.sessionId} className="cc-availability-session">
            <span className="cc-availability-session__doctor">{session.doctorName}</span>
            {session.specialisation !== null && <span className="cc-availability-session__specialisation">{session.specialisation}</span>}
            <span>
              {formatTime(session.startsAt)}–{formatTime(session.endsAt)}
            </span>
            <SessionStatusDisplay status={session.status} />
            <span className="cc-availability-session__slots">{session.remainingSlotCount} slots remaining</span>
          </div>
        ))
      )}
    </div>
  );
}

/**
 * P-01's remaining gap, closed: API §2.2 `GET /api/v1/public/availability`,
 * the doctor duty-roster availability `LandingPage`'s own doc comment named
 * as still-missing at M1. Same four-state discipline as `AnnouncementList`
 * (M0.5) — pending renders nothing until a delay to avoid a skeleton flash,
 * errors degrade to a non-blocking banner, and an empty publication window
 * renders nothing rather than an invented "nothing scheduled" card. A
 * *closed* day within a non-empty window is still shown, though — that is
 * real information, not a placeholder (FR-SCH-11/BR-28).
 */
export function AvailabilityList(): JSX.Element | null {
  const headingId = useId();
  const { data, isPending, isError, error } = usePublicAvailability();
  const showSkeleton = useDelayedFlag(isPending, SKELETON_DELAY_MS);
  const showLoadingText = useDelayedFlag(isPending, LOADING_TEXT_DELAY_MS);

  if (isPending) {
    if (!showSkeleton) return null;
    return (
      <div aria-busy="true" aria-live="polite">
        <Skeleton width="100%" height="96px" />
        {showLoadingText && <span className="cc-visually-hidden">Loading availability…</span>}
      </div>
    );
  }

  if (isError) {
    return (
      <Banner
        tone="warning"
        message={`Doctor availability couldn't be loaded right now (${error.message}). The rest of this page still works.`}
      />
    );
  }

  if (data.days.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>Doctor availability</h2>
      <div role="list" aria-label="Doctor availability" className="cc-availability-list">
        {data.days.map((day) => (
          <DayRow key={day.date} day={day} />
        ))}
      </div>
    </section>
  );
}
