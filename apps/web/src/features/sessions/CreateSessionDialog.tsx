import { useEffect, useId, useMemo, useRef, useState, type JSX } from 'react';

import { ApiError } from '../../infrastructure/api-client.js';
import '../../shared/primitives/Dialog.css';
import { Banner } from '../../shared/primitives/Banner.js';
import { Button } from '../../shared/primitives/Button.js';
import { Input } from '../../shared/primitives/Input.js';
import { useDoctorsList } from '../doctors/use-doctors.js';

import type { ClinicSessionDto } from './api.js';
import { previewSlotCounts } from './slot-preview.js';
import { useCreateClinicSession } from './use-sessions.js';

export interface CreateSessionDialogProps {
  readonly open: boolean;
  readonly defaultDate: string;
  readonly csrfToken: string;
  readonly onCreated: (session: ClinicSessionDto) => void;
  readonly onCancel: () => void;
}

const REASON_REQUIRED_HOURS = 24;

function combineDateAndTime(date: string, time: string): Date {
  return new Date(`${date}T${time}:00`);
}

/** F-12's create half (API §3.3). Previews derived slot counts live and progressively reveals the two conditional fields the API itself gates: the override checkbox on `NON_SERVICE_DAY`, and the change reason within 24 hours of the session start (VR-18). */
export function CreateSessionDialog({ open, defaultDate, csrfToken, onCreated, onCancel }: CreateSessionDialogProps): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const doctorsQuery = useDoctorsList({ isActive: true });
  const createSession = useCreateClinicSession();

  const [doctorId, setDoctorId] = useState('');
  const [sessionDate, setSessionDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('13:00');
  const [slotLengthMinutes, setSlotLengthMinutes] = useState('10');
  const [walkInAllocationPct, setWalkInAllocationPct] = useState('30');
  const [changeReason, setChangeReason] = useState('');
  const [overrideNonServiceDay, setOverrideNonServiceDay] = useState(false);
  const [nonServiceDayMessage, setNonServiceDayMessage] = useState<string | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      setDoctorId('');
      setSessionDate(defaultDate);
      setStartTime('09:00');
      setEndTime('13:00');
      setSlotLengthMinutes('10');
      setWalkInAllocationPct('30');
      setChangeReason('');
      setOverrideNonServiceDay(false);
      setNonServiceDayMessage(undefined);
      setErrorMessage(undefined);
      createSession.reset();
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, defaultDate, createSession]);

  const startsAt = useMemo(() => combineDateAndTime(sessionDate, startTime), [sessionDate, startTime]);
  const endsAt = useMemo(() => combineDateAndTime(sessionDate, endTime), [sessionDate, endTime]);
  const preview = previewSlotCounts(startsAt, endsAt, Number(slotLengthMinutes), Number(walkInAllocationPct));
  const reasonRequired = startsAt.getTime() - Date.now() < REASON_REQUIRED_HOURS * 60 * 60 * 1000;

  const activeDoctors = doctorsQuery.data?.items ?? [];
  const canSubmit = doctorId.length > 0 && preview !== null && (!reasonRequired || changeReason.trim().length >= 10);

  async function handleSubmit(): Promise<void> {
    setErrorMessage(undefined);
    try {
      const session = await createSession.mutateAsync({
        input: {
          doctorId,
          sessionDate,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          slotLengthMinutes: Number(slotLengthMinutes),
          walkInAllocationPct: Number(walkInAllocationPct),
          changeReason: changeReason.trim().length > 0 ? changeReason.trim() : null,
          overrideNonServiceDay,
        },
        csrfToken,
      });
      onCreated(session);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'NON_SERVICE_DAY') {
        setNonServiceDayMessage(error.message);
      } else {
        setErrorMessage(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
      }
    }
  }

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events -- backdrop-click-to-cancel on the native <dialog>; Esc already reaches the same outcome via the browser's own default handling.
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="cc-dialog cc-dialog--form"
      onClose={onCancel}
      onClick={(event) => {
        if (event.target === dialogRef.current) dialogRef.current.close();
      }}
    >
      <form
        className="cc-dialog__content"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <h2 id={titleId} className="cc-dialog__title">
          New session
        </h2>

        {errorMessage !== undefined && <Banner tone="danger" message={errorMessage} />}
        {nonServiceDayMessage !== undefined && <Banner tone="warning" message={nonServiceDayMessage} />}

        <div className="cc-dialog__section-label">
          <label htmlFor="session-doctor">Doctor</label>
        </div>
        <select id="session-doctor" value={doctorId} onChange={(event) => { setDoctorId(event.target.value); }} required>
          <option value="" disabled>
            Choose a doctor
          </option>
          {activeDoctors.map((doctor) => (
            <option key={doctor.doctorId} value={doctor.doctorId}>
              {doctor.fullName}
            </option>
          ))}
        </select>

        <Input label="Date" type="text" inputMode="text" value={sessionDate} onChange={setSessionDate} placeholder="YYYY-MM-DD" required />

        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <div style={{ flex: 1 }}>
            <label htmlFor="session-start-time" className="cc-field__label">
              Starts
            </label>
            <input id="session-start-time" type="time" value={startTime} onChange={(event) => { setStartTime(event.target.value); }} required />
          </div>
          <div style={{ flex: 1 }}>
            <label htmlFor="session-end-time" className="cc-field__label">
              Ends
            </label>
            <input id="session-end-time" type="time" value={endTime} onChange={(event) => { setEndTime(event.target.value); }} required />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Input label="Slot length (minutes)" type="text" inputMode="numeric" value={slotLengthMinutes} onChange={setSlotLengthMinutes} />
          <Input label="Walk-in allocation (%)" type="text" inputMode="numeric" value={walkInAllocationPct} onChange={setWalkInAllocationPct} />
        </div>

        <p className="cc-dialog__counter">
          {preview === null ? 'Enter valid times to see the derived slots.' : `${String(preview.totalSlotCount)} slots, ${String(preview.bookableSlotCount)} bookable online`}
        </p>

        {reasonRequired && (
          <Input
            label="Reason (required — starts within 24 hours)"
            value={changeReason}
            onChange={setChangeReason}
            help="At least 10 characters."
          />
        )}

        {nonServiceDayMessage !== undefined && (
          <label className="cc-dialog__checkbox-row">
            <input type="checkbox" checked={overrideNonServiceDay} onChange={(event) => { setOverrideNonServiceDay(event.target.checked); }} />
            Create it anyway
          </label>
        )}

        <div className="cc-dialog__actions">
          <Button
            variant="secondary"
            onClick={() => {
              dialogRef.current?.close();
            }}
          >
            Cancel
          </Button>
          <Button variant="primary" type="submit" loading={createSession.isPending} disabled={!canSubmit}>
            Create session
          </Button>
        </div>
      </form>
    </dialog>
  );
}
