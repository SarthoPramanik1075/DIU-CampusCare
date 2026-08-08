import { useEffect, useId, useRef, useState, type JSX } from 'react';

import './Dialog.css';
import { Banner } from './Banner.js';
import { Button, type ButtonVariant } from './Button.js';
import { Input } from './Input.js';

export interface ConfirmDialogReasonConfig {
  readonly required: boolean;
  readonly minLength: number;
}

export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly title: string;
  /** NFR-USE-08 (FRONTEND §5.5) — states the effect in numbers. Required; there is no "Are you sure?" default. */
  readonly consequence: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly confirmVariant?: ButtonVariant;
  readonly reason?: ConfirmDialogReasonConfig;
  readonly loading?: boolean;
  /** A server-side rejection (e.g. `CONFLICT_STALE_VERSION`) surfaced without closing the dialog, so the reason the caller already typed isn't lost. */
  readonly errorMessage?: string;
  readonly onConfirm: (reason?: string) => void;
  readonly onCancel: () => void;
}

/**
 * FRONTEND §5.5. Built on the native `<dialog>` element rather than a
 * hand-rolled focus trap: `showModal()` already gives correct focus
 * containment, an inert background, and `Esc`-to-close for free — the
 * `close` event is the single place that syncs back to the caller,
 * regardless of whether the close came from `Esc`, a backdrop click, or the
 * Cancel button. Native autofocus lands on the first focusable element,
 * which is the Cancel button because it renders first in the markup (the
 * spec's "initial focus lands on the cancel/safe action").
 */
export function ConfirmDialog(props: ConfirmDialogProps): JSX.Element {
  const {
    open,
    title,
    consequence,
    confirmLabel,
    cancelLabel,
    confirmVariant = 'danger',
    reason,
    loading = false,
    errorMessage,
    onConfirm,
    onCancel,
  } = props;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [reasonValue, setReasonValue] = useState('');
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      setReasonValue('');
      dialog.showModal();
      // The reason field, when present, precedes the actions in DOM order,
      // so the native autofocus-first-focusable-element algorithm would
      // otherwise land on it instead. §5.5 requires focus on the safe
      // action specifically: "a keyboard user hitting Enter reflexively
      // does not destroy anything."
      cancelRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const reasonLength = reasonValue.trim().length;
  const reasonMet = reason === undefined || reasonLength >= reason.minLength;

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events -- backdrop-click-to-cancel on the native <dialog>; Esc already reaches the same outcome via the `cancel` event, the keyboard-equivalent path this rule checks for.
    <dialog
      ref={dialogRef}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descId}
      className="cc-dialog"
      onClose={onCancel}
      onClick={(event) => {
        if (event.target === dialogRef.current) dialogRef.current.close();
      }}
    >
      <div className="cc-dialog__content">
        <h2 id={titleId} className="cc-dialog__title">
          {title}
        </h2>
        <p id={descId} className="cc-dialog__consequence">
          {consequence}
        </p>
        {errorMessage !== undefined && <Banner tone="danger" message={errorMessage} />}
        {reason !== undefined && (
          <>
            <Input label="Reason" value={reasonValue} onChange={setReasonValue} required={reason.required} />
            <p className="cc-dialog__counter">
              {reasonLength} / {reason.minLength} minimum {reasonMet ? '✓' : ''}
            </p>
          </>
        )}
        <div className="cc-dialog__actions">
          <Button
            ref={cancelRef}
            variant="secondary"
            onClick={() => {
              dialogRef.current?.close();
            }}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={confirmVariant}
            loading={loading}
            disabled={!reasonMet}
            {...(reasonMet ? {} : { disabledReason: `Reason must be at least ${String(reason.minLength)} characters.` })}
            onClick={() => {
              onConfirm(reason === undefined ? undefined : reasonValue.trim());
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
