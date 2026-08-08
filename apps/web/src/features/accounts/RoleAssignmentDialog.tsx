import type { AuthenticatedRoleCode } from '@campuscare/shared-types';
import { useEffect, useId, useRef, useState, type JSX } from 'react';

import { ApiError } from '../../infrastructure/api-client.js';
import '../../shared/primitives/Dialog.css';
import { Banner } from '../../shared/primitives/Banner.js';
import { Button } from '../../shared/primitives/Button.js';
import { Input } from '../../shared/primitives/Input.js';

import type { AccountDetailDto } from './api.js';
import { useGrantRole, useRevokeRole, useRoleCatalogue } from './use-accounts.js';

export interface RoleAssignmentDialogProps {
  readonly open: boolean;
  readonly account: AccountDetailDto;
  readonly csrfToken: string;
  readonly onClose: () => void;
}

const REASON_MIN_LENGTH = 10;

/**
 * A-04. The API grants/revokes one role per request (`POST …/roles`,
 * `DELETE …/roles/{code}`) — there is no batch endpoint — so each checkbox
 * toggle here is its own request against the shared reason field, rather
 * than a client-side diff submitted as one call the backend doesn't support.
 *
 * The spec's "`CNP` is disabled unless the account is flagged clinical
 * staff" cannot be implemented here: `GET/PATCH /users/{id}` deliberately
 * omits `isClinicalStaff` from the wire shape (see `api.ts`'s
 * `AccountDetailDto` comment), so this dialog has no client-side signal to
 * gate on. Every checkbox stays enabled once a reason is entered, and a
 * `CNP` grant on a non-clinical-staff account is refused by the server's
 * VR-04 check, surfaced here as the same banner any other rejection uses.
 */
export function RoleAssignmentDialog({ open, account, csrfToken, onClose }: RoleAssignmentDialogProps): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const roleCatalogue = useRoleCatalogue();
  const grantRole = useGrantRole(account.userId);
  const revokeRole = useRevokeRole(account.userId);
  const [reason, setReason] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      setReason('');
      setErrorMessage(undefined);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const reasonLength = reason.trim().length;
  const reasonMet = reasonLength >= REASON_MIN_LENGTH;
  const heldCodes = new Set(account.roles.map((role) => role.code));
  const assignableRoles = (roleCatalogue.data?.items ?? []).filter((role) => role.assignableByAdmin);
  const busy = grantRole.isPending || revokeRole.isPending;

  async function handleToggle(roleCode: AuthenticatedRoleCode, currentlyHeld: boolean): Promise<void> {
    setErrorMessage(undefined);
    try {
      if (currentlyHeld) {
        await revokeRole.mutateAsync({ roleCode, reason: reason.trim(), csrfToken });
      } else {
        await grantRole.mutateAsync({ roleCode, reason: reason.trim(), csrfToken });
      }
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
    }
  }

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events -- backdrop-click-to-cancel on the native <dialog>; Esc already reaches the same outcome via the browser's own default handling, the keyboard-equivalent path this rule checks for.
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="cc-dialog cc-dialog--form"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) dialogRef.current.close();
      }}
    >
      <div className="cc-dialog__content">
        <h2 id={titleId} className="cc-dialog__title">
          Roles — {account.fullName}
        </h2>

        {errorMessage !== undefined && <Banner tone="danger" message={errorMessage} />}

        <Input label="Reason for this change" value={reason} onChange={setReason} required />
        <p className="cc-dialog__counter">
          {reasonLength} / {REASON_MIN_LENGTH} minimum {reasonMet ? '✓' : ''}
        </p>

        <fieldset style={{ border: 'none', padding: 0, margin: 0 }} disabled={!reasonMet || busy}>
          <legend className="cc-dialog__section-label">Roles held</legend>
          {roleCatalogue.isPending && <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>Loading role catalogue…</p>}
          {assignableRoles.map((role) => {
            const held = heldCodes.has(role.code);
            return (
              <div key={role.code} className="cc-dialog__checkbox-row">
                <input
                  id={`role-toggle-${role.code}`}
                  type="checkbox"
                  checked={held}
                  onChange={() => {
                    void handleToggle(role.code as AuthenticatedRoleCode, held);
                  }}
                />
                <label htmlFor={`role-toggle-${role.code}`} className="cc-dialog__checkbox-label">
                  {role.name}
                  {role.code === 'CNP' && (
                    <span className="cc-dialog__checkbox-note">
                      This does not by itself give access to counseling records. A Counseling Professional must add
                      them to the clinical roster separately.
                    </span>
                  )}
                </label>
              </div>
            );
          })}
        </fieldset>
        {!reasonMet && (
          <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
            Enter a reason of at least {REASON_MIN_LENGTH} characters to change a role.
          </p>
        )}

        <div className="cc-dialog__actions">
          <Button
            variant="secondary"
            onClick={() => {
              dialogRef.current?.close();
            }}
          >
            Close
          </Button>
        </div>
      </div>
    </dialog>
  );
}
