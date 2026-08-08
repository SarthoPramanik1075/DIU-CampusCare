import { useEffect, useId, useRef, useState, type JSX } from 'react';

import { ApiError } from '../../infrastructure/api-client.js';
import '../../shared/primitives/Dialog.css';
import { Banner } from '../../shared/primitives/Banner.js';
import { Button } from '../../shared/primitives/Button.js';
import { Input } from '../../shared/primitives/Input.js';

import type { CreateServiceCalendarEntriesResultDto } from './api.js';
import { useCreateServiceCalendarEntries } from './use-service-calendar.js';

export interface CloseDayDialogProps {
  readonly open: boolean;
  readonly defaultDate: string;
  readonly csrfToken: string;
  readonly onCreated: (result: CreateServiceCalendarEntriesResultDto) => void;
  readonly onCancel: () => void;
}

/** A-06's create half (API §8.3). `isServiceDay` defaults to closed; the "reopen as a working day" checkbox covers the rarer explicit-override case the same field supports. */
export function CloseDayDialog({ open, defaultDate, csrfToken, onCreated, onCancel }: CloseDayDialogProps): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const createEntries = useCreateServiceCalendarEntries();

  const [fromDate, setFromDate] = useState(defaultDate);
  const [toDate, setToDate] = useState(defaultDate);
  const [reason, setReason] = useState('');
  const [forceOpen, setForceOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      setFromDate(defaultDate);
      setToDate(defaultDate);
      setReason('');
      setForceOpen(false);
      setErrorMessage(undefined);
      createEntries.reset();
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, defaultDate, createEntries]);

  async function handleSubmit(): Promise<void> {
    setErrorMessage(undefined);
    try {
      const result = await createEntries.mutateAsync({
        input: { fromDate, toDate, reason, isServiceDay: forceOpen },
        csrfToken,
      });
      onCreated(result);
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
          {forceOpen ? 'Mark as a working day' : 'Close a date'}
        </h2>

        {errorMessage !== undefined && <Banner tone="danger" message={errorMessage} />}

        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <div style={{ flex: 1 }}>
            <label htmlFor="calendar-from-date" className="cc-field__label">
              From
            </label>
            <input id="calendar-from-date" type="date" value={fromDate} onChange={(event) => { setFromDate(event.target.value); }} required />
          </div>
          <div style={{ flex: 1 }}>
            <label htmlFor="calendar-to-date" className="cc-field__label">
              To
            </label>
            <input id="calendar-to-date" type="date" value={toDate} onChange={(event) => { setToDate(event.target.value); }} required />
          </div>
        </div>

        <Input label="Reason" value={reason} onChange={setReason} required autoComplete="off" />

        <label className="cc-dialog__checkbox-row">
          <input type="checkbox" checked={forceOpen} onChange={(event) => { setForceOpen(event.target.checked); }} />
          Reopen it as a working day instead of closing it
        </label>

        <div className="cc-dialog__actions">
          <Button
            variant="secondary"
            onClick={() => {
              dialogRef.current?.close();
            }}
          >
            Cancel
          </Button>
          <Button variant="primary" type="submit" loading={createEntries.isPending} disabled={reason.trim().length === 0}>
            {forceOpen ? 'Mark open' : 'Close'}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
