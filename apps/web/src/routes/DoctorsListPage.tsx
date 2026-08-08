import { Link } from '@tanstack/react-router';
import { useState, type JSX } from 'react';

import type { SessionDto } from '../features/auth/api.js';
import type { DoctorDetailDto, DoctorListFilters } from '../features/doctors/api.js';
import { CreateDoctorDialog } from '../features/doctors/CreateDoctorDialog.js';
import { DoctorActiveDisplay } from '../features/doctors/DoctorActiveDisplay.js';
import { useDeactivateDoctor, useDoctorsList } from '../features/doctors/use-doctors.js';
import { ApiError } from '../infrastructure/api-client.js';
import { Banner } from '../shared/primitives/Banner.js';
import { Button } from '../shared/primitives/Button.js';
import { ConfirmDialog } from '../shared/primitives/ConfirmDialog.js';
import { Input } from '../shared/primitives/Input.js';
import { Skeleton } from '../shared/Skeleton.js';
import { StaffShell } from '../shared/StaffShell.js';

import './DoctorsListPage.css';

export interface DoctorsListSearch {
  readonly isActive?: boolean;
}

export interface DoctorsListPageProps {
  readonly session: SessionDto;
  readonly search: DoctorsListSearch;
  readonly onSearchChange: (next: DoctorsListSearch) => void;
  readonly onCreated: (doctor: DoctorDetailDto) => void;
}

/**
 * F-09 (FRONTEND §10.4). The wireframe's table also names "rosters" and
 * "upcoming sessions" columns, but API §3.1's `GET /doctors` list response
 * carries only name/designation/specialisation/active/version — those two
 * counts exist only on the per-doctor detail read. Fetching every row's
 * detail to populate two list columns would be an N+1 query pattern for a
 * page whose whole point is to stay fast with many doctors, so this table
 * shows what the list endpoint actually returns; the counts are real and
 * visible one click away on the detail page instead.
 */
export function DoctorsListPage({ session, search, onSearchChange, onCreated }: DoctorsListPageProps): JSX.Element {
  const [queryText, setQueryText] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<{ readonly doctorId: string; readonly fullName: string; readonly version: number } | null>(null);
  const [dialogError, setDialogError] = useState<string | undefined>(undefined);

  const filters: DoctorListFilters = { ...search, ...(queryText.trim().length >= 2 ? { q: queryText.trim() } : {}) };
  const doctors = useDoctorsList(filters);
  const deactivateDoctor = useDeactivateDoctor(deactivateTarget?.doctorId ?? '');

  const searchTooShort = doctors.error instanceof ApiError && doctors.error.code === 'VALIDATION_FAILED';

  async function handleDeactivate(reason?: string): Promise<void> {
    if (deactivateTarget === null || reason === undefined) return;
    setDialogError(undefined);
    try {
      await deactivateDoctor.mutateAsync({ reason, version: deactivateTarget.version, csrfToken: session.csrfToken });
      setDeactivateTarget(null);
    } catch (error) {
      setDialogError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
    }
  }

  return (
    <StaffShell session={session} pageTitle="Doctors">
      <form
        className="cc-doctors-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <div className="cc-doctors-toolbar__search">
          <Input label="Search" value={queryText} onChange={setQueryText} placeholder="Name or specialisation" type="search" />
        </div>
        <div className="cc-doctors-toolbar__field">
          <label htmlFor="doctors-active-filter">Status</label>
          <select
            id="doctors-active-filter"
            value={search.isActive === undefined ? '' : String(search.isActive)}
            onChange={(event) => {
              const { value } = event.target;
              onSearchChange(value.length > 0 ? { isActive: value === 'true' } : {});
            }}
          >
            <option value="">All</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </div>
        <Button
          variant="primary"
          icon="plus"
          onClick={() => {
            setCreateOpen(true);
          }}
        >
          Add doctor
        </Button>
      </form>

      {doctors.isPending && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }} aria-busy="true">
          <Skeleton width="100%" height="40px" />
          <Skeleton width="100%" height="40px" />
          <Skeleton width="100%" height="40px" />
        </div>
      )}

      {doctors.isError && !searchTooShort && <Banner tone="danger" message="Doctors couldn't be loaded right now. Try refreshing the page." />}

      {doctors.data?.items.length === 0 && <p style={{ color: 'var(--color-text-secondary)' }}>No doctors match those filters.</p>}

      {doctors.data !== undefined && doctors.data.items.length > 0 && (
        <table className="cc-doctors-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Designation</th>
              <th scope="col">Specialisation</th>
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {doctors.data.items.map((doctor) => (
              <tr key={doctor.doctorId}>
                <td>
                  <Link to="/staff/doctors/$doctorId" params={{ doctorId: doctor.doctorId }}>
                    {doctor.fullName}
                  </Link>
                </td>
                <td>{doctor.designation ?? '—'}</td>
                <td>{doctor.specialisation ?? '—'}</td>
                <td>
                  <DoctorActiveDisplay isActive={doctor.isActive} />
                </td>
                <td className="cc-doctors-table__actions">
                  <Link to="/staff/doctors/$doctorId" params={{ doctorId: doctor.doctorId }}>
                    Edit
                  </Link>
                  {doctor.isActive && (
                    <Button
                      variant="tertiary"
                      size="sm"
                      onClick={() => {
                        setDialogError(undefined);
                        setDeactivateTarget({ doctorId: doctor.doctorId, fullName: doctor.fullName, version: doctor.version });
                      }}
                    >
                      Deactivate
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <CreateDoctorDialog
        open={createOpen}
        csrfToken={session.csrfToken}
        onCreated={(doctor) => {
          setCreateOpen(false);
          onCreated(doctor);
        }}
        onCancel={() => {
          setCreateOpen(false);
        }}
      />

      {deactivateTarget !== null && (
        <ConfirmDialog
          open
          title={`Deactivate ${deactivateTarget.fullName}?`}
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
            setDeactivateTarget(null);
          }}
        />
      )}
    </StaffShell>
  );
}
