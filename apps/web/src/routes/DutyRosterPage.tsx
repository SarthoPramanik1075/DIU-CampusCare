import { Link } from '@tanstack/react-router';
import { useState, type JSX } from 'react';

import type { SessionDto } from '../features/auth/api.js';
import { useDoctorDetail } from '../features/doctors/use-doctors.js';
import type { DutyRosterDto } from '../features/duty-rosters/api.js';
import { useCreateDutyRoster, useDeleteDutyRoster, useDutyRosters, useUpdateDutyRoster } from '../features/duty-rosters/use-duty-rosters.js';
import { ApiError } from '../infrastructure/api-client.js';
import { Banner } from '../shared/primitives/Banner.js';
import { Button } from '../shared/primitives/Button.js';
import { ConfirmDialog } from '../shared/primitives/ConfirmDialog.js';
import { Skeleton } from '../shared/Skeleton.js';
import { StaffShell } from '../shared/StaffShell.js';

import './DutyRosterPage.css';

export interface DutyRosterPageProps {
  readonly session: SessionDto;
  readonly doctorId: string;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

function formatLocalTime(time: string): string {
  const [hoursText, minutesText] = time.split(':');
  const hours = Number(hoursText);
  const period = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${String(hour12)}:${minutesText ?? '00'} ${period}`;
}

interface RosterFormValue {
  readonly weekday: number;
  readonly startsAtLocal: string;
  readonly endsAtLocal: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

const BLANK_FORM: RosterFormValue = { weekday: 0, startsAtLocal: '09:00', endsAtLocal: '13:00', effectiveFrom: todayIsoDate(), effectiveTo: '' };

function RosterForm({
  value,
  onChange,
  onSave,
  onCancel,
  saving,
  saveLabel,
}: {
  readonly value: RosterFormValue;
  readonly onChange: (next: RosterFormValue) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
  readonly saving: boolean;
  readonly saveLabel: string;
}): JSX.Element {
  return (
    <div className="cc-roster-form">
      <div className="cc-roster-form__field">
        <label htmlFor="roster-weekday">Day</label>
        <select id="roster-weekday" value={value.weekday} onChange={(event) => { onChange({ ...value, weekday: Number(event.target.value) }); }}>
          {WEEKDAY_NAMES.map((name, index) => (
            <option key={name} value={index}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <div className="cc-roster-form__field">
        <label htmlFor="roster-from">From</label>
        <input id="roster-from" type="time" value={value.startsAtLocal} onChange={(event) => { onChange({ ...value, startsAtLocal: event.target.value }); }} />
      </div>
      <div className="cc-roster-form__field">
        <label htmlFor="roster-to">To</label>
        <input id="roster-to" type="time" value={value.endsAtLocal} onChange={(event) => { onChange({ ...value, endsAtLocal: event.target.value }); }} />
      </div>
      <div className="cc-roster-form__field">
        <label htmlFor="roster-effective-from">Effective from</label>
        <input id="roster-effective-from" type="date" value={value.effectiveFrom} onChange={(event) => { onChange({ ...value, effectiveFrom: event.target.value }); }} />
      </div>
      <div className="cc-roster-form__field">
        <label htmlFor="roster-effective-to">Effective to (optional)</label>
        <input id="roster-effective-to" type="date" value={value.effectiveTo} onChange={(event) => { onChange({ ...value, effectiveTo: event.target.value }); }} />
      </div>
      <div className="cc-roster-form__actions">
        <Button variant="primary" size="sm" loading={saving} onClick={onSave}>
          {saveLabel}
        </Button>
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** F-11 (FRONTEND §10.4, API §3.2). A roster is a template — editing or removing one never retroactively touches sessions already materialised from it, stated here exactly as staff would otherwise wrongly assume it does. */
export function DutyRosterPage({ session, doctorId }: DutyRosterPageProps): JSX.Element {
  const doctorQuery = useDoctorDetail(doctorId);
  const rostersQuery = useDutyRosters(doctorId);
  const createRoster = useCreateDutyRoster(doctorId);

  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState<RosterFormValue>(BLANK_FORM);
  const [addError, setAddError] = useState<string | undefined>(undefined);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<RosterFormValue>(BLANK_FORM);
  const [editError, setEditError] = useState<string | undefined>(undefined);

  const [removeTarget, setRemoveTarget] = useState<DutyRosterDto | null>(null);
  const [removeError, setRemoveError] = useState<string | undefined>(undefined);

  const updateRoster = useUpdateDutyRoster(doctorId, editingId ?? '');
  const deleteRoster = useDeleteDutyRoster(doctorId, removeTarget?.rosterId ?? '');

  const doctor = doctorQuery.data;
  const rosters = rostersQuery.data?.items ?? [];

  async function handleAdd(): Promise<void> {
    setAddError(undefined);
    try {
      await createRoster.mutateAsync({
        input: {
          weekday: addForm.weekday,
          startsAtLocal: addForm.startsAtLocal,
          endsAtLocal: addForm.endsAtLocal,
          effectiveFrom: addForm.effectiveFrom,
          effectiveTo: addForm.effectiveTo.length > 0 ? addForm.effectiveTo : null,
        },
        csrfToken: session.csrfToken,
      });
      setAdding(false);
      setAddForm(BLANK_FORM);
    } catch (error) {
      setAddError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
    }
  }

  function startEditing(roster: DutyRosterDto): void {
    setEditingId(roster.rosterId);
    setEditForm({
      weekday: roster.weekday,
      startsAtLocal: roster.startsAtLocal.slice(0, 5),
      endsAtLocal: roster.endsAtLocal.slice(0, 5),
      effectiveFrom: roster.effectiveFrom,
      effectiveTo: roster.effectiveTo ?? '',
    });
    setEditError(undefined);
  }

  async function handleSaveEdit(roster: DutyRosterDto): Promise<void> {
    setEditError(undefined);
    try {
      await updateRoster.mutateAsync({
        input: {
          weekday: editForm.weekday,
          startsAtLocal: editForm.startsAtLocal,
          endsAtLocal: editForm.endsAtLocal,
          effectiveFrom: editForm.effectiveFrom,
          effectiveTo: editForm.effectiveTo.length > 0 ? editForm.effectiveTo : null,
          version: roster.version,
        },
        csrfToken: session.csrfToken,
      });
      setEditingId(null);
    } catch (error) {
      setEditError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
    }
  }

  async function handleRemove(reason?: string): Promise<void> {
    if (removeTarget === null || reason === undefined) return;
    setRemoveError(undefined);
    try {
      await deleteRoster.mutateAsync({ reason, csrfToken: session.csrfToken });
      setRemoveTarget(null);
    } catch (error) {
      setRemoveError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
    }
  }

  return (
    <StaffShell session={session} pageTitle={doctor === undefined ? 'Weekly duty' : `${doctor.fullName} · Weekly duty`}>
      <p style={{ marginTop: 0 }}>
        <Link to="/staff/doctors/$doctorId" params={{ doctorId }}>
          ← {doctor?.fullName ?? 'Doctor'}
        </Link>
      </p>

      {(doctorQuery.isPending || rostersQuery.isPending) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }} aria-busy="true">
          <Skeleton width="100%" height="40px" />
          <Skeleton width="100%" height="40px" />
        </div>
      )}

      {rostersQuery.isError && <Banner tone="danger" message="The duty roster couldn't be loaded right now. Try refreshing the page." />}

      {rostersQuery.data !== undefined && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', maxWidth: '720px' }}>
          {rosters.length === 0 ? (
            <p style={{ color: 'var(--color-text-secondary)' }}>No recurring duty times yet.</p>
          ) : (
            <table className="cc-roster-table">
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col">From</th>
                  <th scope="col">To</th>
                  <th scope="col">Effective</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rosters.map((roster) =>
                  editingId === roster.rosterId ? (
                    <tr key={roster.rosterId}>
                      <td colSpan={5}>
                        {editError !== undefined && <Banner tone="danger" message={editError} />}
                        <RosterForm
                          value={editForm}
                          onChange={setEditForm}
                          onSave={() => void handleSaveEdit(roster)}
                          onCancel={() => {
                            setEditingId(null);
                          }}
                          saving={updateRoster.isPending}
                          saveLabel="Save"
                        />
                      </td>
                    </tr>
                  ) : (
                    <tr key={roster.rosterId}>
                      <td>{WEEKDAY_NAMES[roster.weekday]}</td>
                      <td>{formatLocalTime(roster.startsAtLocal)}</td>
                      <td>{formatLocalTime(roster.endsAtLocal)}</td>
                      <td>
                        {roster.effectiveFrom}
                        {roster.effectiveTo !== null && ` – ${roster.effectiveTo}`}
                      </td>
                      <td className="cc-roster-table__actions">
                        <Button variant="tertiary" size="sm" onClick={() => { startEditing(roster); }}>
                          Edit
                        </Button>
                        <Button
                          variant="tertiary"
                          size="sm"
                          onClick={() => {
                            setRemoveError(undefined);
                            setRemoveTarget(roster);
                          }}
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          )}

          {adding ? (
            <div>
              {addError !== undefined && <Banner tone="danger" message={addError} />}
              <RosterForm
                value={addForm}
                onChange={setAddForm}
                onSave={() => void handleAdd()}
                onCancel={() => {
                  setAdding(false);
                  setAddError(undefined);
                }}
                saving={createRoster.isPending}
                saveLabel="Add"
              />
            </div>
          ) : (
            <div>
              <Button
                variant="secondary"
                icon="plus"
                onClick={() => {
                  setAddForm(BLANK_FORM);
                  setAddError(undefined);
                  setAdding(true);
                }}
              >
                Add a day
              </Button>
            </div>
          )}

          <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
            ⓘ Changing this pattern doesn&rsquo;t move sessions that are already scheduled.
          </p>
        </div>
      )}

      {removeTarget !== null && (
        <ConfirmDialog
          open
          title={`Remove ${WEEKDAY_NAMES[removeTarget.weekday]} duty?`}
          consequence="This stops the recurring pattern from this day onward. Sessions already scheduled from it are not affected."
          confirmLabel="Remove"
          cancelLabel="Keep it"
          confirmVariant="danger"
          reason={{ required: true, minLength: 10 }}
          loading={deleteRoster.isPending}
          {...(removeError === undefined ? {} : { errorMessage: removeError })}
          onConfirm={(reason) => {
            void handleRemove(reason);
          }}
          onCancel={() => {
            setRemoveTarget(null);
          }}
        />
      )}
    </StaffShell>
  );
}
