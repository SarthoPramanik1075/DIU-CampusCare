import { ROLE_NAMES } from '@campuscare/shared-types';
import { Link } from '@tanstack/react-router';
import { useState, type JSX } from 'react';

import { AccountStatusDisplay } from '../features/accounts/AccountStatusDisplay.js';
import type { ActiveAppointmentSummaryDto } from '../features/accounts/api.js';
import { RoleAssignmentDialog } from '../features/accounts/RoleAssignmentDialog.js';
import {
  useAccountDetail,
  useActivateAccount,
  useDeactivateAccount,
  useSuspendAccount,
  useUpdateAccount,
} from '../features/accounts/use-accounts.js';
import type { SessionDto } from '../features/auth/api.js';
import { ApiError } from '../infrastructure/api-client.js';
import { AdminShell } from '../shared/AdminShell.js';
import { Banner } from '../shared/primitives/Banner.js';
import { Button, type ButtonVariant } from '../shared/primitives/Button.js';
import { Card } from '../shared/primitives/Card.js';
import { ConfirmDialog } from '../shared/primitives/ConfirmDialog.js';
import { Input } from '../shared/primitives/Input.js';
import { Skeleton } from '../shared/Skeleton.js';

export interface AccountDetailPageProps {
  readonly session: SessionDto;
  readonly userId: string;
}

/** API §1.15/1.16/1.17 — mirrored client-side, same reasoning as `password-complexity.ts`'s VR-02 mirror: these are the documented status-transition rules, not tunable policy. */
function canSuspend(status: string): boolean {
  return status === 'active' || status === 'pending';
}
function canActivate(status: string): boolean {
  return status !== 'active';
}
function canDeactivate(status: string): boolean {
  return status !== 'deactivated';
}

const DEFAULT_DEACTIVATE_CONSEQUENCE = 'This account will be signed out immediately and unable to sign in again.';

type LifecycleAction = 'suspend' | 'activate' | 'deactivate' | null;

/** A-03 (FRONTEND §10.6). This read writes `data_access_log` (FR-AUD-03) on the backend. */
export function AccountDetailPage({ session, userId }: AccountDetailPageProps): JSX.Element {
  const accountQuery = useAccountDetail(userId);
  const updateAccount = useUpdateAccount(userId);
  const suspendAccount = useSuspendAccount(userId);
  const activateAccount = useActivateAccount(userId);
  const deactivateAccount = useDeactivateAccount(userId);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [nameError, setNameError] = useState<string | undefined>(undefined);

  const [openAction, setOpenAction] = useState<LifecycleAction>(null);
  const [dialogError, setDialogError] = useState<string | undefined>(undefined);
  const [deactivateConsequence, setDeactivateConsequence] = useState(DEFAULT_DEACTIVATE_CONSEQUENCE);
  const [deactivateConfirmLabel, setDeactivateConfirmLabel] = useState('Deactivate');
  const [confirmedImpact, setConfirmedImpact] = useState(false);

  const [roleDialogOpen, setRoleDialogOpen] = useState(false);

  const account = accountQuery.data;

  function openDeactivateDialog(): void {
    setDeactivateConsequence(DEFAULT_DEACTIVATE_CONSEQUENCE);
    setDeactivateConfirmLabel('Deactivate');
    setConfirmedImpact(false);
    setDialogError(undefined);
    setOpenAction('deactivate');
  }

  function closeLifecycleDialog(): void {
    setOpenAction(null);
    setDialogError(undefined);
  }

  async function handleSaveName(): Promise<void> {
    if (account === undefined) return;
    setNameError(undefined);
    try {
      await updateAccount.mutateAsync({ input: { fullName: nameDraft, version: account.version }, csrfToken: session.csrfToken });
      setEditingName(false);
    } catch (error) {
      setNameError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
    }
  }

  async function handleSuspend(reason?: string): Promise<void> {
    if (account === undefined || reason === undefined) return;
    setDialogError(undefined);
    try {
      await suspendAccount.mutateAsync({ reason, version: account.version, csrfToken: session.csrfToken });
      closeLifecycleDialog();
    } catch (error) {
      setDialogError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
    }
  }

  async function handleActivate(reason?: string): Promise<void> {
    if (account === undefined || reason === undefined) return;
    setDialogError(undefined);
    try {
      await activateAccount.mutateAsync({ reason, version: account.version, csrfToken: session.csrfToken });
      closeLifecycleDialog();
    } catch (error) {
      setDialogError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
    }
  }

  async function handleDeactivate(reason?: string): Promise<void> {
    if (account === undefined || reason === undefined) return;
    setDialogError(undefined);
    try {
      await deactivateAccount.mutateAsync({ reason, version: account.version, confirmedImpact, csrfToken: session.csrfToken });
      closeLifecycleDialog();
      setConfirmedImpact(false);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CONFIRMATION_REQUIRED') {
        const appointments = (error.details?.activeAppointments as readonly ActiveAppointmentSummaryDto[] | undefined) ?? [];
        setDeactivateConsequence(error.message);
        setDeactivateConfirmLabel(`Deactivate ${String(appointments.length)}`);
        setConfirmedImpact(true);
      } else {
        setDialogError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
      }
    }
  }

  const lifecycleDialogProps: {
    readonly title: string;
    readonly consequence: string;
    readonly confirmLabel: string;
    readonly confirmVariant: ButtonVariant;
    readonly onConfirm: (reason?: string) => void;
    readonly loading: boolean;
  } | null =
    openAction === 'suspend'
      ? {
          title: 'Suspend this account?',
          consequence: 'The account will be signed out immediately and unable to sign in until reactivated.',
          confirmLabel: 'Suspend',
          confirmVariant: 'danger',
          onConfirm: (reason) => {
            void handleSuspend(reason);
          },
          loading: suspendAccount.isPending,
        }
      : openAction === 'activate'
        ? {
            title: 'Activate this account?',
            consequence: 'The account will be able to sign in again.',
            confirmLabel: 'Activate',
            confirmVariant: 'primary',
            onConfirm: (reason) => {
              void handleActivate(reason);
            },
            loading: activateAccount.isPending,
          }
        : openAction === 'deactivate'
          ? {
              title: 'Deactivate this account?',
              consequence: deactivateConsequence,
              confirmLabel: deactivateConfirmLabel,
              confirmVariant: 'danger',
              onConfirm: (reason) => {
                void handleDeactivate(reason);
              },
              loading: deactivateAccount.isPending,
            }
          : null;

  return (
    <AdminShell session={session} pageTitle={account?.fullName ?? 'Account'}>
      <p style={{ marginTop: 0 }}>
        <Link to="/admin/users">← Accounts</Link>
      </p>

      {accountQuery.isPending && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }} aria-busy="true">
          <Skeleton width="100%" height="160px" />
        </div>
      )}

      {accountQuery.isError && (
        <Banner
          tone="danger"
          message={accountQuery.error instanceof ApiError ? accountQuery.error.message : 'This account could not be loaded.'}
        />
      )}

      {account !== undefined && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', maxWidth: '640px' }}>
          <Card title="Account">
            <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 'var(--space-1) var(--space-2)', margin: 0 }}>
              <dt style={{ color: 'var(--color-text-secondary)' }}>Name</dt>
              <dd style={{ margin: 0 }}>
                {editingName ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', maxWidth: '320px' }}>
                    <Input
                      label="Full name"
                      value={nameDraft}
                      onChange={setNameDraft}
                      required
                      {...(nameError === undefined ? {} : { error: nameError })}
                    />
                    <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                      <Button variant="primary" loading={updateAccount.isPending} onClick={() => void handleSaveName()}>
                        Save
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setEditingName(false);
                          setNameError(undefined);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                    {account.fullName}
                    <Button
                      variant="tertiary"
                      size="sm"
                      onClick={() => {
                        setNameDraft(account.fullName);
                        setEditingName(true);
                      }}
                    >
                      Edit
                    </Button>
                  </span>
                )}
              </dd>

              <dt style={{ color: 'var(--color-text-secondary)' }}>Email</dt>
              <dd style={{ margin: 0 }}>{account.email}</dd>

              <dt style={{ color: 'var(--color-text-secondary)' }}>Status</dt>
              <dd style={{ margin: 0 }}>
                <AccountStatusDisplay status={account.status} />
              </dd>

              <dt style={{ color: 'var(--color-text-secondary)' }}>Sign-in method</dt>
              <dd style={{ margin: 0 }}>{account.authMethod === 'sso' ? 'DIU single sign-on' : 'Local password'}</dd>

              <dt style={{ color: 'var(--color-text-secondary)' }}>Roles</dt>
              <dd style={{ margin: 0 }}>
                {account.roles.length === 0 ? '—' : account.roles.map((role) => ROLE_NAMES[role.code]).join(', ')}
              </dd>

              <dt style={{ color: 'var(--color-text-secondary)' }}>Student ref</dt>
              <dd style={{ margin: 0 }}>{account.studentProfile?.studentRef ?? '—'}</dd>

              <dt style={{ color: 'var(--color-text-secondary)' }}>Last login</dt>
              <dd style={{ margin: 0 }}>
                {account.lastLoginAt === null ? 'Never' : new Date(account.lastLoginAt).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}
              </dd>
            </dl>
          </Card>

          <div style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap' }}>
            <Button
              variant="secondary"
              onClick={() => {
                setRoleDialogOpen(true);
              }}
            >
              Manage roles
            </Button>
            {canSuspend(account.status) && (
              <Button
                variant="danger"
                onClick={() => {
                  setDialogError(undefined);
                  setOpenAction('suspend');
                }}
              >
                Suspend
              </Button>
            )}
            {canActivate(account.status) && (
              <Button
                variant="primary"
                onClick={() => {
                  setDialogError(undefined);
                  setOpenAction('activate');
                }}
              >
                Activate
              </Button>
            )}
            {canDeactivate(account.status) && (
              <Button variant="danger" onClick={openDeactivateDialog}>
                Deactivate
              </Button>
            )}
          </div>

          <RoleAssignmentDialog
            open={roleDialogOpen}
            account={account}
            csrfToken={session.csrfToken}
            onClose={() => {
              setRoleDialogOpen(false);
            }}
          />

          {lifecycleDialogProps !== null && (
            <ConfirmDialog
              open={openAction !== null}
              title={lifecycleDialogProps.title}
              consequence={lifecycleDialogProps.consequence}
              confirmLabel={lifecycleDialogProps.confirmLabel}
              cancelLabel="Keep account"
              confirmVariant={lifecycleDialogProps.confirmVariant}
              reason={{ required: true, minLength: 10 }}
              loading={lifecycleDialogProps.loading}
              {...(dialogError === undefined ? {} : { errorMessage: dialogError })}
              onConfirm={lifecycleDialogProps.onConfirm}
              onCancel={closeLifecycleDialog}
            />
          )}
        </div>
      )}
    </AdminShell>
  );
}
