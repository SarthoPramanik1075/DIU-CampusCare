import { useQuery } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import type { SessionDto } from '../features/auth/api.js';
import { fetchPublicServiceCalendar } from '../features/service-calendar/api.js';
import type { ClinicSessionDto } from '../features/sessions/api.js';
import { CreateSessionDialog } from '../features/sessions/CreateSessionDialog.js';
import { SessionCard } from '../features/sessions/SessionCard.js';
import { useClinicSessions } from '../features/sessions/use-sessions.js';
import { Banner } from '../shared/primitives/Banner.js';
import { Button } from '../shared/primitives/Button.js';
import { Skeleton } from '../shared/Skeleton.js';
import { StaffShell } from '../shared/StaffShell.js';

import './SchedulePage.css';

export interface SchedulePageProps {
  readonly session: SessionDto;
  readonly date: string | undefined;
  readonly onDateChange: (date: string | undefined) => void;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  return new Date(new Date(`${isoDate}T00:00:00Z`).getTime() + days * MS_PER_DAY).toISOString().slice(0, 10);
}

function startOfWeek(isoDate: string): string {
  const weekday = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return addDays(isoDate, -weekday);
}

function formatDayHeading(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  const weekday = DAY_NAMES[date.getUTCDay()];
  return `${weekday} ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`;
}

/** F-12 (FRONTEND §10.4, API §3.3). A week view: every day either shows its sessions or, when `config.service_calendar` marks it closed, the closure reason instead — non-service days are shown, never silently omitted (FR-SCH-11). */
export function SchedulePage({ session, date, onDateChange }: SchedulePageProps): JSX.Element {
  const [createOpen, setCreateOpen] = useState(false);
  const anchor = date ?? todayIsoDate();
  const weekStart = startOfWeek(anchor);
  const weekEnd = addDays(weekStart, 6);
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));

  const sessionsQuery = useClinicSessions(weekStart, weekEnd);
  const calendarQuery = useQuery({
    queryKey: ['public-service-calendar', weekStart, weekEnd],
    queryFn: () => fetchPublicServiceCalendar(weekStart, weekEnd),
  });

  const closuresByDate = new Map((calendarQuery.data?.items ?? []).filter((entry) => !entry.isServiceDay).map((entry) => [entry.date, entry]));
  const sessionsByDate = new Map<string, ClinicSessionDto[]>();
  for (const item of sessionsQuery.data?.items ?? []) {
    const existing = sessionsByDate.get(item.sessionDate) ?? [];
    sessionsByDate.set(item.sessionDate, [...existing, item]);
  }

  return (
    <StaffShell session={session} pageTitle="Schedule">
      <div className="cc-schedule-toolbar">
        <div className="cc-schedule-toolbar__nav">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              onDateChange(addDays(weekStart, -7));
            }}
          >
            ← Previous week
          </Button>
          <span className="cc-schedule-toolbar__label">
            Week of {formatDayHeading(weekStart)} – {formatDayHeading(weekEnd)}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              onDateChange(addDays(weekStart, 7));
            }}
          >
            Next week →
          </Button>
        </div>
        <Button
          variant="primary"
          icon="plus"
          onClick={() => {
            setCreateOpen(true);
          }}
        >
          Session
        </Button>
      </div>

      {(sessionsQuery.isPending || calendarQuery.isPending) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }} aria-busy="true">
          <Skeleton width="100%" height="60px" />
          <Skeleton width="100%" height="60px" />
        </div>
      )}

      {sessionsQuery.isError && <Banner tone="danger" message="The schedule couldn't be loaded right now. Try refreshing the page." />}

      {sessionsQuery.data !== undefined && calendarQuery.data !== undefined && (
        <div className="cc-schedule-days">
          {days.map((day) => {
            const closure = closuresByDate.get(day);
            const daySessions = sessionsByDate.get(day) ?? [];
            return (
              <section key={day} className="cc-schedule-day">
                {closure !== undefined ? (
                  <h2 className="cc-schedule-day__heading cc-schedule-day__heading--closed">
                    {formatDayHeading(day)} — Closed · {closure.reason}
                  </h2>
                ) : (
                  <>
                    <h2 className="cc-schedule-day__heading">{formatDayHeading(day)}</h2>
                    {daySessions.length === 0 ? (
                      <p className="cc-schedule-day__empty">No sessions.</p>
                    ) : (
                      daySessions.map((item) => <SessionCard key={item.sessionId} session={item} csrfToken={session.csrfToken} />)
                    )}
                  </>
                )}
              </section>
            );
          })}
        </div>
      )}

      <CreateSessionDialog
        open={createOpen}
        defaultDate={anchor}
        csrfToken={session.csrfToken}
        onCreated={() => {
          setCreateOpen(false);
        }}
        onCancel={() => {
          setCreateOpen(false);
        }}
      />
    </StaffShell>
  );
}
