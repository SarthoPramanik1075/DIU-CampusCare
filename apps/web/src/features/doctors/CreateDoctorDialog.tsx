import { useEffect, useId, useRef, useState, type JSX } from 'react';

import { ApiError } from '../../infrastructure/api-client.js';
import '../../shared/primitives/Dialog.css';
import { Banner } from '../../shared/primitives/Banner.js';
import { Button } from '../../shared/primitives/Button.js';
import { Input } from '../../shared/primitives/Input.js';

import type { DoctorDetailDto } from './api.js';
import { useCreateDoctor } from './use-doctors.js';

export interface CreateDoctorDialogProps {
  readonly open: boolean;
  readonly csrfToken: string;
  readonly onCreated: (doctor: DoctorDetailDto) => void;
  readonly onCancel: () => void;
}

/** F-10's create half — `POST /api/v1/doctors` (API §3.1). No login field: CON-02 says doctors need no account, so linking one is left to a later, optional step, never asked for here. */
export function CreateDoctorDialog({ open, csrfToken, onCreated, onCancel }: CreateDoctorDialogProps): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const createDoctor = useCreateDoctor();
  const titleId = useId();

  const [fullName, setFullName] = useState('');
  const [designation, setDesignation] = useState('');
  const [specialisation, setSpecialisation] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      setFullName('');
      setDesignation('');
      setSpecialisation('');
      setErrorMessage(undefined);
      createDoctor.reset();
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, createDoctor]);

  async function handleSubmit(): Promise<void> {
    setErrorMessage(undefined);
    try {
      const doctor = await createDoctor.mutateAsync({
        input: {
          fullName,
          designation: designation.trim().length > 0 ? designation.trim() : null,
          specialisation: specialisation.trim().length > 0 ? specialisation.trim() : null,
          photoUrl: null,
        },
        csrfToken,
      });
      onCreated(doctor);
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
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
          Add doctor
        </h2>

        {errorMessage !== undefined && <Banner tone="danger" message={errorMessage} />}

        <Input label="Full name" value={fullName} onChange={setFullName} required autoComplete="off" />
        <Input label="Designation" value={designation} onChange={setDesignation} placeholder="Consultant" autoComplete="off" />
        <Input label="Specialisation" value={specialisation} onChange={setSpecialisation} placeholder="General Medicine" autoComplete="off" />

        <div className="cc-dialog__actions">
          <Button
            variant="secondary"
            onClick={() => {
              dialogRef.current?.close();
            }}
          >
            Cancel
          </Button>
          <Button variant="primary" type="submit" loading={createDoctor.isPending} disabled={fullName.trim().length === 0}>
            Add doctor
          </Button>
        </div>
      </form>
    </dialog>
  );
}
