import type { AuthenticatedRoleCode } from '@campuscare/shared-types';
import { useEffect, useId, useRef, useState, type JSX } from 'react';

import { ApiError } from '../../infrastructure/api-client.js';
import '../../shared/primitives/Dialog.css';
import { Banner } from '../../shared/primitives/Banner.js';
import { Button } from '../../shared/primitives/Button.js';
import { Input } from '../../shared/primitives/Input.js';

import type { AccountDetailDto } from './api.js';
import { useCreateAccount, useRoleCatalogue } from './use-accounts.js';

export interface CreateAccountDialogProps {
  readonly open: boolean;
  readonly csrfToken: string;
  readonly onCreated: (account: AccountDetailDto) => void;
  readonly onCancel: () => void;
}

/**
 * A-02's `[ + Create account ]` action, backed by `POST /api/v1/users`
 * (FR-AUTH-02). `STU` never appears as a choice — student accounts are
 * provisioned by SSO, never by an Administrator (BR-05) — and the
 * catalogue's own `assignableByAdmin` flag is what filters it, not a
 * hand-maintained list here.
 */
export function CreateAccountDialog({ open, csrfToken, onCreated, onCancel }: CreateAccountDialogProps): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const roleCatalogue = useRoleCatalogue();
  const createAccount = useCreateAccount();
  const titleId = useId();

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [authMethod, setAuthMethod] = useState<'sso' | 'local'>('local');
  const [selectedRoles, setSelectedRoles] = useState<readonly AuthenticatedRoleCode[]>([]);
  const [isClinicalStaff, setIsClinicalStaff] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      setEmail('');
      setFullName('');
      setAuthMethod('local');
      setSelectedRoles([]);
      setIsClinicalStaff(false);
      setErrorMessage(undefined);
      createAccount.reset();
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, createAccount]);

  function toggleRole(role: AuthenticatedRoleCode): void {
    setSelectedRoles((current) => (current.includes(role) ? current.filter((code) => code !== role) : [...current, role]));
  }

  async function handleSubmit(): Promise<void> {
    setErrorMessage(undefined);
    try {
      const account = await createAccount.mutateAsync({
        input: { email, fullName, authMethod, roles: selectedRoles, isClinicalStaff },
        csrfToken,
      });
      onCreated(account);
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
    }
  }

  const assignableRoles = (roleCatalogue.data?.items ?? []).filter((role) => role.assignableByAdmin);
  const canSubmit = email.length > 0 && fullName.length > 0 && selectedRoles.length > 0;

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events -- backdrop-click-to-cancel on the native <dialog>; Esc already reaches the same outcome via the browser's own default handling, the keyboard-equivalent path this rule checks for.
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
          Create account
        </h2>

        {errorMessage !== undefined && <Banner tone="danger" message={errorMessage} />}

        <Input label="DIU institutional email" type="email" value={email} onChange={setEmail} required autoComplete="off" />
        <Input label="Full name" value={fullName} onChange={setFullName} required autoComplete="off" />

        <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
          <legend className="cc-dialog__section-label">Sign-in method</legend>
          <label className="cc-dialog__checkbox-row">
            <input
              type="radio"
              name="authMethod"
              checked={authMethod === 'local'}
              onChange={() => {
                setAuthMethod('local');
              }}
            />
            Local password (emailed a first-use link)
          </label>
          <label className="cc-dialog__checkbox-row">
            <input
              type="radio"
              name="authMethod"
              checked={authMethod === 'sso'}
              onChange={() => {
                setAuthMethod('sso');
              }}
            />
            DIU single sign-on
          </label>
        </fieldset>

        <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
          <legend className="cc-dialog__section-label">Roles</legend>
          {roleCatalogue.isPending && <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>Loading role catalogue…</p>}
          {assignableRoles.map((role) => (
            <div key={role.code} className="cc-dialog__checkbox-row">
              <input
                id={`role-${role.code}`}
                type="checkbox"
                checked={selectedRoles.includes(role.code as AuthenticatedRoleCode)}
                onChange={() => {
                  toggleRole(role.code as AuthenticatedRoleCode);
                }}
              />
              <label htmlFor={`role-${role.code}`} className="cc-dialog__checkbox-label">
                {role.name}
                {role.requiresClinicalStaff && (
                  <span className="cc-dialog__checkbox-note">Requires the account to be flagged clinical staff.</span>
                )}
              </label>
            </div>
          ))}
        </fieldset>

        {selectedRoles.includes('CNP') && (
          <label className="cc-dialog__checkbox-row">
            <input
              type="checkbox"
              checked={isClinicalStaff}
              onChange={(event) => {
                setIsClinicalStaff(event.target.checked);
              }}
            />
            <span className="cc-dialog__checkbox-label">
              Flag as clinical staff
              <span className="cc-dialog__checkbox-note">
                This does not by itself give access to counseling records. A Counseling Professional must add them to the
                clinical roster separately.
              </span>
            </span>
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
          <Button variant="primary" type="submit" loading={createAccount.isPending} disabled={!canSubmit}>
            Create account
          </Button>
        </div>
      </form>
    </dialog>
  );
}
