import { useState, type JSX } from 'react';

import { ApiError } from '../../infrastructure/api-client.js';
import { Banner } from '../../shared/primitives/Banner.js';
import { Button } from '../../shared/primitives/Button.js';
import { ConfirmDialog } from '../../shared/primitives/ConfirmDialog.js';

import type { ClinicSessionDto } from './api.js';
import { SessionStatusDisplay } from './SessionStatusDisplay.js';
import { useCancelSession, useCompleteSession, useInterruptSession, useStartSession, useUpdateClinicSession } from './use-sessions.js';

export interface SessionCardProps {
  readonly session: ClinicSessionDto;
  readonly csrfToken: string;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Dhaka' });
}

function canStart(status: ClinicSessionDto['status']): boolean {
  return status === 'scheduled' || status === 'interrupted';
}
function canInterrupt(status: ClinicSessionDto['status']): boolean {
  return status === 'started';
}
function canComplete(status: ClinicSessionDto['status']): boolean {
  return status === 'started' || status === 'interrupted';
}
function canCancel(status: ClinicSessionDto['status']): boolean {
  return status !== 'completed' && status !== 'cancelled';
}

type OpenDialog = 'interrupt' | 'complete' | 'cancel' | null;

/** F-12's per-session row (FRONTEND §10.4, API §3.3). */
export function SessionCard({ session, csrfToken }: SessionCardProps): JSX.Element {
  const startMutation = useStartSession(session.sessionId);
  const interruptMutation = useInterruptSession(session.sessionId);
  const completeMutation = useCompleteSession(session.sessionId);
  const cancelMutation = useCancelSession(session.sessionId);
  const updateMutation = useUpdateClinicSession(session.sessionId);

  const [openDialog, setOpenDialog] = useState<OpenDialog>(null);
  const [dialogError, setDialogError] = useState<string | undefined>(undefined);
  const [cancelConfirmedImpact, setCancelConfirmedImpact] = useState(false);
  const [cancelConsequence, setCancelConsequence] = useState('This cancels every booking in the session and notifies each student.');

  const [startError, setStartError] = useState<string | undefined>(undefined);

  const [editing, setEditing] = useState(false);
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [editReason, setEditReason] = useState('');
  const [editError, setEditError] = useState<string | undefined>(undefined);

  async function handleStart(): Promise<void> {
    setStartError(undefined);
    try {
      await startMutation.mutateAsync({ version: session.version, csrfToken });
    } catch (error) {
      setStartError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
    }
  }

  async function handleInterrupt(reason?: string): Promise<void> {
    if (reason === undefined) return;
    setDialogError(undefined);
    try {
      await interruptMutation.mutateAsync({ reason, version: session.version, csrfToken });
      setOpenDialog(null);
    } catch (error) {
      setDialogError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
    }
  }

  async function handleComplete(): Promise<void> {
    setDialogError(undefined);
    try {
      await completeMutation.mutateAsync({ version: session.version, csrfToken });
      setOpenDialog(null);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CONSULTATION_IN_PROGRESS') {
        setDialogError(error.message);
      } else {
        setDialogError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
      }
    }
  }

  async function handleCancel(reason?: string): Promise<void> {
    if (reason === undefined) return;
    setDialogError(undefined);
    try {
      await cancelMutation.mutateAsync({ reason, version: session.version, confirmedImpact: cancelConfirmedImpact, csrfToken });
      setOpenDialog(null);
      setCancelConfirmedImpact(false);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CONFIRMATION_REQUIRED') {
        setCancelConsequence(error.message);
        setCancelConfirmedImpact(true);
      } else {
        setDialogError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
      }
    }
  }

  function startEditing(): void {
    setEditStart(new Date(session.startsAt).toTimeString().slice(0, 5));
    setEditEnd(new Date(session.endsAt).toTimeString().slice(0, 5));
    setEditReason('');
    setEditError(undefined);
    setEditing(true);
  }

  async function handleSaveEdit(): Promise<void> {
    setEditError(undefined);
    try {
      const startsAt = new Date(`${session.sessionDate}T${editStart}:00`);
      const endsAt = new Date(`${session.sessionDate}T${editEnd}:00`);
      await updateMutation.mutateAsync({
        input: {
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          ...(editReason.trim().length > 0 ? { changeReason: editReason.trim() } : {}),
          version: session.version,
        },
        csrfToken,
      });
      setEditing(false);
    } catch (error) {
      setEditError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
    }
  }

  return (
    <div className="cc-session-card">
      <div className="cc-session-card__row">
        <span className="cc-session-card__doctor">{session.doctorName}</span>
        <span>
          {formatTime(session.startsAt)}–{formatTime(session.endsAt)}
        </span>
        <SessionStatusDisplay status={session.status} />
      </div>
      <p className="cc-session-card__counts">
        {session.totalSlotCount} slots · {session.bookableSlotCount} bookable · {session.bookedSlotCount} booked
      </p>

      {startError !== undefined && <Banner tone="danger" message={startError} />}

      {editing ? (
        <div className="cc-session-card__edit">
          {editError !== undefined && <Banner tone="danger" message={editError} />}
          <div className="cc-session-card__edit-fields">
            <label>
              Starts
              <input type="time" value={editStart} onChange={(event) => { setEditStart(event.target.value); }} />
            </label>
            <label>
              Ends
              <input type="time" value={editEnd} onChange={(event) => { setEditEnd(event.target.value); }} />
            </label>
            <label>
              Reason (required within 24h)
              <input type="text" value={editReason} onChange={(event) => { setEditReason(event.target.value); }} />
            </label>
          </div>
          <div className="cc-session-card__actions">
            <Button variant="primary" size="sm" loading={updateMutation.isPending} onClick={() => void handleSaveEdit()}>
              Save
            </Button>
            <Button variant="secondary" size="sm" onClick={() => { setEditing(false); }}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="cc-session-card__actions">
          {canStart(session.status) && (
            <Button variant="primary" size="sm" loading={startMutation.isPending} onClick={() => void handleStart()}>
              {session.status === 'interrupted' ? 'Resume' : 'Start'}
            </Button>
          )}
          {canInterrupt(session.status) && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setDialogError(undefined);
                setOpenDialog('interrupt');
              }}
            >
              Interrupt
            </Button>
          )}
          {canComplete(session.status) && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setDialogError(undefined);
                setOpenDialog('complete');
              }}
            >
              Complete
            </Button>
          )}
          {canCancel(session.status) && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                setDialogError(undefined);
                setCancelConfirmedImpact(false);
                setCancelConsequence('This cancels every booking in the session and notifies each student.');
                setOpenDialog('cancel');
              }}
            >
              Cancel session
            </Button>
          )}
          {session.status !== 'completed' && session.status !== 'cancelled' && (
            <Button variant="tertiary" size="sm" onClick={startEditing}>
              Edit
            </Button>
          )}
        </div>
      )}

      {openDialog === 'interrupt' && (
        <ConfirmDialog
          open
          title="Interrupt this session?"
          consequence="Remaining patients are notified. Bookings are not cancelled — resume it or cancel it separately once you know what's next."
          confirmLabel="Interrupt"
          cancelLabel="Keep running"
          confirmVariant="danger"
          reason={{ required: true, minLength: 10 }}
          loading={interruptMutation.isPending}
          {...(dialogError === undefined ? {} : { errorMessage: dialogError })}
          onConfirm={(reason) => void handleInterrupt(reason)}
          onCancel={() => { setOpenDialog(null); }}
        />
      )}

      {openDialog === 'complete' && (
        <ConfirmDialog
          open
          title="Complete this session?"
          consequence="Any booking still marked booked becomes expired, not no-show — no penalty applies, and those students are offered another time."
          confirmLabel="Complete"
          cancelLabel="Not yet"
          confirmVariant="primary"
          loading={completeMutation.isPending}
          {...(dialogError === undefined ? {} : { errorMessage: dialogError })}
          onConfirm={() => void handleComplete()}
          onCancel={() => { setOpenDialog(null); }}
        />
      )}

      {openDialog === 'cancel' && (
        <ConfirmDialog
          open
          title="Cancel this session?"
          consequence={cancelConsequence}
          confirmLabel={cancelConfirmedImpact ? 'Confirm cancel' : 'Cancel session'}
          cancelLabel="Keep session"
          confirmVariant="danger"
          reason={{ required: true, minLength: 10 }}
          loading={cancelMutation.isPending}
          {...(dialogError === undefined ? {} : { errorMessage: dialogError })}
          onConfirm={(reason) => void handleCancel(reason)}
          onCancel={() => { setOpenDialog(null); }}
        />
      )}
    </div>
  );
}
