import { Link } from '@tanstack/react-router';
import { useState, type JSX } from 'react';

import type { SessionDto } from '../features/auth/api.js';
import { DoctorActiveDisplay } from '../features/doctors/DoctorActiveDisplay.js';
import { useDeactivateDoctor, useDeleteDoctor, useDoctorDetail, useUpdateDoctor } from '../features/doctors/use-doctors.js';
import { ApiError } from '../infrastructure/api-client.js';
import { Banner } from '../shared/primitives/Banner.js';
import { Button } from '../shared/primitives/Button.js';
import { Card } from '../shared/primitives/Card.js';
import { ConfirmDialog } from '../shared/primitives/ConfirmDialog.js';
import { Input } from '../shared/primitives/Input.js';
import { Skeleton } from '../shared/Skeleton.js';
import { StaffShell } from '../shared/StaffShell.js';

export interface DoctorDetailPageProps {
  readonly session: SessionDto;
  readonly doctorId: string;
  readonly onDeleted: () => void;
}

type DialogState = 'deactivate' | 'delete' | null;

/** F-10 (FRONTEND §10.4). "Photo" is a URL field, not a file uploader — no upload endpoint exists yet, and a fake picker would be exactly the placeholder UI this project refuses to ship. Linked account is shown read-only: CON-02 makes it optional and the backend only ever sets it at creation (`PATCH` doesn't accept it). */
export function DoctorDetailPage({ session, doctorId, onDeleted }: DoctorDetailPageProps): JSX.Element {
  const doctorQuery = useDoctorDetail(doctorId);
  const updateDoctor = useUpdateDoctor(doctorId);
  const deactivateDoctor = useDeactivateDoctor(doctorId);
  const deleteDoctor = useDeleteDoctor(doctorId);

  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState('');
  const [designation, setDesignation] = useState('');
  const [specialisation, setSpecialisation] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [editError, setEditError] = useState<string | undefined>(undefined);

  const [openDialog, setOpenDialog] = useState<DialogState>(null);
  const [dialogError, setDialogError] = useState<string | undefined>(undefined);
  const [deleteBlockedMessage, setDeleteBlockedMessage] = useState<string | undefined>(undefined);

  const doctor = doctorQuery.data;

  function startEditing(): void {
    if (doctor === undefined) return;
    setFullName(doctor.fullName);
    setDesignation(doctor.designation ?? '');
    setSpecialisation(doctor.specialisation ?? '');
    setPhotoUrl(doctor.photoUrl ?? '');
    setEditError(undefined);
    setEditing(true);
  }

  async function handleSave(): Promise<void> {
    if (doctor === undefined) return;
    setEditError(undefined);
    try {
      await updateDoctor.mutateAsync({
        input: {
          fullName,
          designation: designation.trim().length > 0 ? designation.trim() : null,
          specialisation: specialisation.trim().length > 0 ? specialisation.trim() : null,
          photoUrl: photoUrl.trim().length > 0 ? photoUrl.trim() : null,
          version: doctor.version,
        },
        csrfToken: session.csrfToken,
      });
      setEditing(false);
    } catch (error) {
      setEditError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
    }
  }

  async function handleDeactivate(reason?: string): Promise<void> {
    if (doctor === undefined || reason === undefined) return;
    setDialogError(undefined);
    try {
      await deactivateDoctor.mutateAsync({ reason, version: doctor.version, csrfToken: session.csrfToken });
      setOpenDialog(null);
    } catch (error) {
      setDialogError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
    }
  }

  async function handleDelete(): Promise<void> {
    setDialogError(undefined);
    try {
      await deleteDoctor.mutateAsync({ csrfToken: session.csrfToken });
      onDeleted();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'DOCTOR_HAS_HISTORY') {
        setOpenDialog(null);
        setDeleteBlockedMessage(error.message);
      } else {
        setDialogError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
      }
    }
  }

  return (
    <StaffShell session={session} pageTitle={doctor?.fullName ?? 'Doctor'}>
      <p style={{ marginTop: 0 }}>
        <Link to="/staff/doctors">← Doctors</Link>
      </p>

      {doctorQuery.isPending && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }} aria-busy="true">
          <Skeleton width="100%" height="160px" />
        </div>
      )}

      {doctorQuery.isError && <Banner tone="danger" message={doctorQuery.error instanceof ApiError ? doctorQuery.error.message : 'This doctor could not be loaded.'} />}

      {deleteBlockedMessage !== undefined && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', marginBottom: 'var(--space-2)' }}>
          <Banner tone="warning" message={deleteBlockedMessage} />
          <Button variant="secondary" size="sm" onClick={() => void handleDeactivate('Retired from the medical centre')}>
            Deactivate instead
          </Button>
        </div>
      )}

      {doctor !== undefined && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', maxWidth: '640px' }}>
          <Card title="Profile">
            {editing ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {editError !== undefined && <Banner tone="danger" message={editError} />}
                <Input label="Full name" value={fullName} onChange={setFullName} required autoComplete="off" />
                <Input label="Designation" value={designation} onChange={setDesignation} autoComplete="off" />
                <Input label="Specialisation" value={specialisation} onChange={setSpecialisation} autoComplete="off" />
                <Input label="Photo URL" value={photoUrl} onChange={setPhotoUrl} autoComplete="off" />
                <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                  <Button variant="primary" loading={updateDoctor.isPending} disabled={fullName.trim().length === 0} onClick={() => void handleSave()}>
                    Save
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setEditing(false);
                      setEditError(undefined);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 'var(--space-1) var(--space-2)', margin: 0 }}>
                <dt style={{ color: 'var(--color-text-secondary)' }}>Full name</dt>
                <dd style={{ margin: 0 }}>{doctor.fullName}</dd>

                <dt style={{ color: 'var(--color-text-secondary)' }}>Designation</dt>
                <dd style={{ margin: 0 }}>{doctor.designation ?? '—'}</dd>

                <dt style={{ color: 'var(--color-text-secondary)' }}>Specialisation</dt>
                <dd style={{ margin: 0 }}>{doctor.specialisation ?? '—'}</dd>

                <dt style={{ color: 'var(--color-text-secondary)' }}>Photo</dt>
                <dd style={{ margin: 0 }}>{doctor.photoUrl ?? '—'}</dd>

                <dt style={{ color: 'var(--color-text-secondary)' }}>Status</dt>
                <dd style={{ margin: 0 }}>
                  <DoctorActiveDisplay isActive={doctor.isActive} />
                </dd>

                <dt style={{ color: 'var(--color-text-secondary)' }}>Linked account</dt>
                <dd style={{ margin: 0 }}>{doctor.userAccountId ?? 'None — no login (CON-02)'}</dd>

                <dt style={{ color: 'var(--color-text-secondary)' }}>Active rosters</dt>
                <dd style={{ margin: 0 }}>{doctor.activeRosterCount}</dd>

                <dt style={{ color: 'var(--color-text-secondary)' }}>Upcoming sessions</dt>
                <dd style={{ margin: 0 }}>{doctor.upcomingSessionCount}</dd>

                <dt />
                <dd style={{ margin: 0 }}>
                  <Button variant="tertiary" size="sm" onClick={startEditing}>
                    Edit
                  </Button>
                </dd>
              </dl>
            )}
          </Card>

          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
            <Link to="/staff/doctors/$doctorId/roster" params={{ doctorId }} className="cc-button cc-button--secondary cc-button--md">
              Duty roster
            </Link>
            <Link to="/staff/doctors/$doctorId/unavailability" params={{ doctorId }} className="cc-button cc-button--secondary cc-button--md">
              Unavailability
            </Link>
            {doctor.isActive && (
              <Button
                variant="danger"
                onClick={() => {
                  setDialogError(undefined);
                  setOpenDialog('deactivate');
                }}
              >
                Deactivate
              </Button>
            )}
            <Button
              variant="danger"
              onClick={() => {
                setDialogError(undefined);
                setDeleteBlockedMessage(undefined);
                setOpenDialog('delete');
              }}
            >
              Delete
            </Button>
          </div>

          {openDialog === 'deactivate' && (
            <ConfirmDialog
              open
              title={`Deactivate ${doctor.fullName}?`}
              consequence="Upcoming sessions remain scheduled. Cancel them or record unavailability separately to release the bookings."
              confirmLabel="Deactivate"
              cancelLabel="Keep active"
              confirmVariant="danger"
              reason={{ required: true, minLength: 10 }}
              loading={deactivateDoctor.isPending}
              {...(dialogError === undefined ? {} : { errorMessage: dialogError })}
              onConfirm={(reason) => {
                void handleDeactivate(reason);
              }}
              onCancel={() => {
                setOpenDialog(null);
              }}
            />
          )}

          {openDialog === 'delete' && (
            <ConfirmDialog
              open
              title={`Delete ${doctor.fullName}?`}
              consequence="This removes the profile permanently. It only succeeds if no appointment has ever referenced this doctor."
              confirmLabel="Delete"
              cancelLabel="Keep profile"
              confirmVariant="danger"
              loading={deleteDoctor.isPending}
              {...(dialogError === undefined ? {} : { errorMessage: dialogError })}
              onConfirm={() => {
                void handleDelete();
              }}
              onCancel={() => {
                setOpenDialog(null);
              }}
            />
          )}
        </div>
      )}
    </StaffShell>
  );
}
