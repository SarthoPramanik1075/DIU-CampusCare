import { Link } from '@tanstack/react-router';
import { useState, type JSX } from 'react';

import type { SessionDto } from '../features/auth/api.js';
import { useDoctorDetail } from '../features/doctors/use-doctors.js';
import type { PreviewUnavailabilityResultDto, UnavailabilityRecordDto } from '../features/unavailability/api.js';
import { useConfirmUnavailability, useDeleteUnavailability, useDoctorUnavailability, usePreviewUnavailability } from '../features/unavailability/use-unavailability.js';
import { ApiError } from '../infrastructure/api-client.js';
import { Banner } from '../shared/primitives/Banner.js';
import { Button } from '../shared/primitives/Button.js';
import { ConfirmDialog } from '../shared/primitives/ConfirmDialog.js';
import { Input } from '../shared/primitives/Input.js';
import { Skeleton } from '../shared/Skeleton.js';
import { StaffShell } from '../shared/StaffShell.js';

import './DoctorUnavailabilityPage.css';

export interface DoctorUnavailabilityPageProps {
  readonly session: SessionDto;
  readonly doctorId: string;
}

type Phase = 'form' | 'preview';

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * F-13 (FRONTEND §10.4, API §3.4). Step 2 is a full screen, not a dialog —
 * a list of affected bookings that can run into the dozens is a technical
 * presentation squeezed into a dialog, not a real one, per FRONTEND's own
 * design note. `previewToken`/`expiresAt` are handed back by the server on
 * every preview call; the client never decides on its own that a preview
 * is still fresh — `IMPACT_CHANGED`/`PREVIEW_REQUIRED` on confirm are both
 * handled the same way, by re-previewing and showing the refreshed list.
 */
export function DoctorUnavailabilityPage({ session, doctorId }: DoctorUnavailabilityPageProps): JSX.Element {
  const doctorQuery = useDoctorDetail(doctorId);
  const listQuery = useDoctorUnavailability(doctorId);
  const previewMutation = usePreviewUnavailability(doctorId);
  const confirmMutation = useConfirmUnavailability(doctorId);

  const [phase, setPhase] = useState<Phase>('form');
  const [startDate, setStartDate] = useState(todayIsoDate());
  const [endDate, setEndDate] = useState(todayIsoDate());
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState<string | undefined>(undefined);

  const [preview, setPreview] = useState<PreviewUnavailabilityResultDto | null>(null);
  const [confirmError, setConfirmError] = useState<string | undefined>(undefined);
  const [impactChangedNotice, setImpactChangedNotice] = useState<string | undefined>(undefined);

  const [removeTarget, setRemoveTarget] = useState<UnavailabilityRecordDto | null>(null);
  const [removeError, setRemoveError] = useState<string | undefined>(undefined);
  const deleteMutation = useDeleteUnavailability(doctorId, removeTarget?.unavailabilityId ?? '');

  const doctor = doctorQuery.data;
  const records = listQuery.data?.items ?? [];

  async function handlePreviewSubmit(): Promise<void> {
    setFormError(undefined);
    try {
      const result = await previewMutation.mutateAsync({ input: { startDate, endDate, reason: reason.trim() }, csrfToken: session.csrfToken });
      setPreview(result);
      setImpactChangedNotice(undefined);
      setConfirmError(undefined);
      setPhase('preview');
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
    }
  }

  async function refreshPreview(notice: string): Promise<void> {
    try {
      const result = await previewMutation.mutateAsync({ input: { startDate, endDate, reason: reason.trim() }, csrfToken: session.csrfToken });
      setPreview(result);
      setImpactChangedNotice(notice);
    } catch (error) {
      setConfirmError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
    }
  }

  async function handleConfirm(): Promise<void> {
    if (preview === null) return;
    setConfirmError(undefined);
    try {
      await confirmMutation.mutateAsync({
        input: { previewToken: preview.previewToken, startDate, endDate, reason: reason.trim() },
        csrfToken: session.csrfToken,
      });
      setPhase('form');
      setPreview(null);
      setStartDate(todayIsoDate());
      setEndDate(todayIsoDate());
      setReason('');
    } catch (error) {
      if (error instanceof ApiError && (error.code === 'IMPACT_CHANGED' || error.code === 'PREVIEW_REQUIRED')) {
        await refreshPreview(error.message);
      } else {
        setConfirmError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
      }
    }
  }

  async function handleRemove(reasonText?: string): Promise<void> {
    if (removeTarget === null || reasonText === undefined) return;
    setRemoveError(undefined);
    try {
      await deleteMutation.mutateAsync({ reason: reasonText, csrfToken: session.csrfToken });
      setRemoveTarget(null);
    } catch (error) {
      setRemoveError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
    }
  }

  const pageTitle = doctor === undefined ? 'Unavailability' : `${doctor.fullName} · Unavailability`;

  if (phase === 'preview' && preview !== null) {
    return (
      <StaffShell session={session} pageTitle={pageTitle}>
        <div className="cc-unavail-preview">
          <p className="cc-unavail-preview__range">
            {startDate} – {endDate} &middot; {reason}
          </p>

          {impactChangedNotice !== undefined && <Banner tone="warning" message={impactChangedNotice} />}
          {confirmError !== undefined && <Banner tone="danger" message={confirmError} />}

          <p className="cc-unavail-preview__summary">
            {preview.affectedSessions} session{preview.affectedSessions === 1 ? '' : 's'} affected &middot; {preview.affectedAppointments.length} booking
            {preview.affectedAppointments.length === 1 ? '' : 's'} to cancel
          </p>

          {preview.affectedAppointments.length === 0 ? (
            <p style={{ color: 'var(--color-text-secondary)' }}>No bookings fall within this range.</p>
          ) : (
            <table className="cc-unavail-table">
              <thead>
                <tr>
                  <th scope="col">Booking</th>
                  <th scope="col">Student</th>
                  <th scope="col">Session date</th>
                  <th scope="col">Serial</th>
                  <th scope="col">Payment</th>
                  <th scope="col">Refund</th>
                </tr>
              </thead>
              <tbody>
                {preview.affectedAppointments.map((appointment) => (
                  <tr key={appointment.appointmentRef}>
                    <td>{appointment.appointmentRef}</td>
                    <td>{appointment.studentName ?? appointment.studentRef ?? 'Unknown'}</td>
                    <td>{appointment.sessionDate}</td>
                    <td>{appointment.serialNumber}</td>
                    <td>{appointment.paymentStatus}</td>
                    <td>{appointment.requiresRefundFlag ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {preview.alternativeAvailability.length > 0 && (
            <div className="cc-unavail-alternatives">
              <h2>Alternative availability to offer</h2>
              <ul>
                {preview.alternativeAvailability.map((alt, index) => (
                  <li key={`${alt.doctorName}-${alt.sessionDate}-${String(index)}`}>
                    {alt.doctorName} on {alt.sessionDate} &middot; {alt.remainingSlots} slots remaining
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="cc-unavail-preview__actions">
            <Button
              variant="secondary"
              onClick={() => {
                setPhase('form');
              }}
            >
              Back
            </Button>
            <Button variant="danger" loading={confirmMutation.isPending} onClick={() => void handleConfirm()}>
              Cancel these {preview.affectedAppointments.length} and notify
            </Button>
          </div>
        </div>
      </StaffShell>
    );
  }

  return (
    <StaffShell session={session} pageTitle={pageTitle}>
      <p style={{ marginTop: 0 }}>
        <Link to="/staff/doctors/$doctorId" params={{ doctorId }}>
          ← {doctor?.fullName ?? 'Doctor'}
        </Link>
      </p>

      {(doctorQuery.isPending || listQuery.isPending) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }} aria-busy="true">
          <Skeleton width="100%" height="40px" />
          <Skeleton width="100%" height="40px" />
        </div>
      )}

      {listQuery.isError && <Banner tone="danger" message="Unavailability couldn't be loaded right now. Try refreshing the page." />}

      {listQuery.data !== undefined && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', maxWidth: '720px' }}>
          {records.length === 0 ? (
            <p style={{ color: 'var(--color-text-secondary)' }}>No recorded leave.</p>
          ) : (
            <table className="cc-unavail-table">
              <thead>
                <tr>
                  <th scope="col">From</th>
                  <th scope="col">To</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => {
                  const alreadyStarted = record.startDate <= todayIsoDate();
                  return (
                    <tr key={record.unavailabilityId}>
                      <td>{record.startDate}</td>
                      <td>{record.endDate}</td>
                      <td>{record.reason}</td>
                      <td>
                        <Button
                          variant="tertiary"
                          size="sm"
                          disabled={alreadyStarted}
                          {...(alreadyStarted ? { disabledReason: 'This leave has already started.' } : {})}
                          onClick={() => {
                            setRemoveError(undefined);
                            setRemoveTarget(record);
                          }}
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <div className="cc-unavail-form">
            <h2>Mark unavailable</h2>
            {formError !== undefined && <Banner tone="danger" message={formError} />}
            <div className="cc-unavail-form__dates">
              <div>
                <label htmlFor="unavail-start">From</label>
                <input id="unavail-start" type="date" value={startDate} onChange={(event) => { setStartDate(event.target.value); }} />
              </div>
              <div>
                <label htmlFor="unavail-end">To</label>
                <input id="unavail-end" type="date" value={endDate} onChange={(event) => { setEndDate(event.target.value); }} />
              </div>
            </div>
            <Input label="Reason" value={reason} onChange={setReason} help="At least 10 characters." />
            <Button
              variant="primary"
              loading={previewMutation.isPending}
              disabled={reason.trim().length < 10}
              {...(reason.trim().length < 10 ? { disabledReason: 'Enter a reason of at least 10 characters.' } : {})}
              onClick={() => void handlePreviewSubmit()}
            >
              Review impact
            </Button>
          </div>
        </div>
      )}

      {removeTarget !== null && (
        <ConfirmDialog
          open
          title="Remove this leave period?"
          consequence="This restores the doctor's normal duty roster for these dates. It does not un-cancel anything already cancelled."
          confirmLabel="Remove"
          cancelLabel="Keep it"
          confirmVariant="danger"
          reason={{ required: true, minLength: 10 }}
          loading={deleteMutation.isPending}
          {...(removeError === undefined ? {} : { errorMessage: removeError })}
          onConfirm={(reasonText) => {
            void handleRemove(reasonText);
          }}
          onCancel={() => {
            setRemoveTarget(null);
          }}
        />
      )}
    </StaffShell>
  );
}
