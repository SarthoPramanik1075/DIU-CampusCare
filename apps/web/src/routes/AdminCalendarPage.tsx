import { useState, type JSX } from 'react';

import type { SessionDto } from '../features/auth/api.js';
import type { ConflictingSessionDto, ServiceCalendarEntryDto } from '../features/service-calendar/api.js';
import { CloseDayDialog } from '../features/service-calendar/CloseDayDialog.js';
import { useDeleteServiceCalendarEntry, useServiceCalendarList, useUpdateServiceCalendarEntry } from '../features/service-calendar/use-service-calendar.js';
import { ApiError } from '../infrastructure/api-client.js';
import { AdminShell } from '../shared/AdminShell.js';
import { Banner } from '../shared/primitives/Banner.js';
import { Button } from '../shared/primitives/Button.js';
import { ConfirmDialog } from '../shared/primitives/ConfirmDialog.js';
import { Input } from '../shared/primitives/Input.js';
import { Skeleton } from '../shared/Skeleton.js';

import './AdminCalendarPage.css';

export interface AdminCalendarPageProps {
  readonly session: SessionDto;
  readonly month: string | undefined;
  readonly onMonthChange: (month: string | undefined) => void;
}

const WEEKDAY_HEADINGS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthBounds(month: string): { readonly start: string; readonly end: string } {
  const [yearText, monthText] = month.split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, '0')}` };
}

function addMonths(month: string, delta: number): string {
  const [yearText, monthText] = month.split('-');
  const date = new Date(Date.UTC(Number(yearText), Number(monthText) - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

function formatMonthHeading(month: string): string {
  const [yearText, monthText] = month.split('-');
  const date = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, 1));
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function buildCells(month: string): readonly (string | null)[] {
  const { end } = monthBounds(month);
  const [yearText, monthText] = month.split('-');
  const firstWeekday = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, 1)).getUTCDay();
  const lastDay = Number(end.slice(-2));
  const cells: (string | null)[] = new Array<null>(firstWeekday).fill(null);
  for (let day = 1; day <= lastDay; day += 1) {
    cells.push(`${month}-${String(day).padStart(2, '0')}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** A-06 (FRONTEND §2.4, API §8.3). Closing a date never auto-cancels sessions already scheduled on it — `conflictingSessions` from the create response is shown here purely as information for staff to act on separately (§3.3's own flow), matching FR-SCH-* closure semantics. */
export function AdminCalendarPage({ session, month, onMonthChange }: AdminCalendarPageProps): JSX.Element {
  const activeMonth = month ?? currentMonth();
  const { start, end } = monthBounds(activeMonth);
  const calendarQuery = useServiceCalendarList(start, end);

  const [closeDialogDate, setCloseDialogDate] = useState<string | null>(null);
  const [conflictNotice, setConflictNotice] = useState<readonly ConflictingSessionDto[] | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editReason, setEditReason] = useState('');
  const [editError, setEditError] = useState<string | undefined>(undefined);
  const updateEntry = useUpdateServiceCalendarEntry(editingId ?? '');

  const [removeTarget, setRemoveTarget] = useState<ServiceCalendarEntryDto | null>(null);
  const [removeError, setRemoveError] = useState<string | undefined>(undefined);
  const deleteEntry = useDeleteServiceCalendarEntry(removeTarget?.id ?? '');

  const entriesByDate = new Map((calendarQuery.data?.items ?? []).map((entry) => [entry.date, entry]));

  function startEditing(entry: ServiceCalendarEntryDto): void {
    setEditingId(entry.id);
    setEditReason(entry.reason);
    setEditError(undefined);
  }

  async function handleSaveEdit(entry: ServiceCalendarEntryDto): Promise<void> {
    setEditError(undefined);
    try {
      await updateEntry.mutateAsync({ input: { reason: editReason, version: entry.version }, csrfToken: session.csrfToken });
      setEditingId(null);
    } catch (error) {
      setEditError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
    }
  }

  async function handleRemove(): Promise<void> {
    if (removeTarget === null) return;
    setRemoveError(undefined);
    try {
      await deleteEntry.mutateAsync({ csrfToken: session.csrfToken });
      setRemoveTarget(null);
    } catch (error) {
      setRemoveError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
    }
  }

  return (
    <AdminShell session={session} pageTitle="Service calendar">
      <div className="cc-calendar-toolbar">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            onMonthChange(addMonths(activeMonth, -1));
          }}
        >
          ← Previous month
        </Button>
        <span className="cc-calendar-toolbar__label">{formatMonthHeading(activeMonth)}</span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            onMonthChange(addMonths(activeMonth, 1));
          }}
        >
          Next month →
        </Button>
      </div>

      {conflictNotice !== null && conflictNotice.length > 0 && (
        <div className="cc-calendar-conflicts">
          <Banner
            tone="warning"
            message={`${conflictNotice.length} already-scheduled session${conflictNotice.length === 1 ? '' : 's'} fall on the now-closed date(s). They were not cancelled — cancel each one separately if needed.`}
          />
          <ul>
            {conflictNotice.map((conflict) => (
              <li key={conflict.sessionId}>
                {conflict.doctorName} on {conflict.sessionDate}
              </li>
            ))}
          </ul>
        </div>
      )}

      {calendarQuery.isPending && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }} aria-busy="true">
          <Skeleton width="100%" height="240px" />
        </div>
      )}

      {calendarQuery.isError && <Banner tone="danger" message="The calendar couldn't be loaded right now. Try refreshing the page." />}

      {calendarQuery.data !== undefined && (
        <>
          <div className="cc-calendar-grid cc-calendar-grid--headings">
            {WEEKDAY_HEADINGS.map((heading) => (
              <div key={heading} className="cc-calendar-grid__heading">
                {heading}
              </div>
            ))}
          </div>
          <div className="cc-calendar-grid">
            {buildCells(activeMonth).map((date, index) => {
              if (date === null) return <div key={`blank-${String(index)}`} className="cc-calendar-cell cc-calendar-cell--blank" />;
              const entry = entriesByDate.get(date);
              const dayNumber = Number(date.slice(-2));
              const isPast = date < todayIsoDate();
              const isEditing = editingId === entry?.id;

              return (
                <div key={date} className={`cc-calendar-cell${entry !== undefined ? ' cc-calendar-cell--marked' : ''}`}>
                  <span className="cc-calendar-cell__date">{dayNumber}</span>
                  {entry === undefined ? (
                    <Button
                      variant="tertiary"
                      size="sm"
                      onClick={() => {
                        setCloseDialogDate(date);
                      }}
                    >
                      Close
                    </Button>
                  ) : isEditing ? (
                    <div className="cc-calendar-cell__edit">
                      {editError !== undefined && <Banner tone="danger" message={editError} />}
                      <Input label="Reason" value={editReason} onChange={setEditReason} />
                      <div className="cc-calendar-cell__actions">
                        <Button variant="primary" size="sm" loading={updateEntry.isPending} onClick={() => void handleSaveEdit(entry)}>
                          Save
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => { setEditingId(null); }}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="cc-calendar-cell__body">
                      <span className={entry.isServiceDay ? 'cc-calendar-cell__tag cc-calendar-cell__tag--open' : 'cc-calendar-cell__tag cc-calendar-cell__tag--closed'}>
                        {entry.isServiceDay ? 'Working day (override)' : 'Closed'}
                      </span>
                      <p className="cc-calendar-cell__reason">{entry.reason}</p>
                      <div className="cc-calendar-cell__actions">
                        <Button variant="tertiary" size="sm" onClick={() => { startEditing(entry); }}>
                          Edit reason
                        </Button>
                        <Button
                          variant="tertiary"
                          size="sm"
                          disabled={isPast}
                          {...(isPast ? { disabledReason: "This date has already passed — it can't be reopened." } : {})}
                          onClick={() => {
                            setRemoveError(undefined);
                            setRemoveTarget(entry);
                          }}
                        >
                          {entry.isServiceDay ? 'Remove override' : 'Reopen'}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {closeDialogDate !== null && (
        <CloseDayDialog
          open
          defaultDate={closeDialogDate}
          csrfToken={session.csrfToken}
          onCreated={(result) => {
            setCloseDialogDate(null);
            setConflictNotice(result.conflictingSessions);
          }}
          onCancel={() => {
            setCloseDialogDate(null);
          }}
        />
      )}

      {removeTarget !== null && (
        <ConfirmDialog
          open
          title={removeTarget.isServiceDay ? 'Remove this override?' : 'Reopen this date?'}
          consequence="This does not affect sessions already scheduled around it either way."
          confirmLabel={removeTarget.isServiceDay ? 'Remove' : 'Reopen'}
          cancelLabel="Keep it"
          confirmVariant="danger"
          loading={deleteEntry.isPending}
          {...(removeError === undefined ? {} : { errorMessage: removeError })}
          onConfirm={() => void handleRemove()}
          onCancel={() => {
            setRemoveTarget(null);
          }}
        />
      )}
    </AdminShell>
  );
}
