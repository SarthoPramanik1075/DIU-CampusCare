import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmDialog } from './ConfirmDialog.js';

describe('ConfirmDialog', () => {
  it('renders the title, consequence and button labels when open', () => {
    render(
      <ConfirmDialog
        open
        title="Deactivate this account?"
        consequence="This account has 2 upcoming appointments. They'll be cancelled and the student notified."
        confirmLabel="Deactivate"
        cancelLabel="Keep account"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Deactivate this account?' })).toBeInTheDocument();
    expect(screen.getByText(/upcoming appointments/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep account' })).toBeInTheDocument();
  });

  it('disables confirm until a required reason meets the minimum length', async () => {
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        title="Suspend this account?"
        consequence="The account will be signed out and unable to sign in again."
        confirmLabel="Suspend"
        cancelLabel="Keep account"
        reason={{ required: true, minLength: 10 }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const confirmButton = screen.getByRole('button', { name: 'Suspend' });
    expect(confirmButton).toHaveAttribute('aria-disabled', 'true');

    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Repeated policy violations');
    expect(confirmButton).not.toHaveAttribute('aria-disabled');
  });

  it('calls onConfirm with the trimmed reason', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Suspend this account?"
        consequence="The account will be signed out and unable to sign in again."
        confirmLabel="Suspend"
        cancelLabel="Keep account"
        reason={{ required: true, minLength: 10 }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), '  Repeated policy violations  ');
    await user.click(screen.getByRole('button', { name: 'Suspend' }));
    expect(onConfirm).toHaveBeenCalledWith('Repeated policy violations');
  });

  it('calls onCancel when the cancel button is clicked', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Suspend this account?"
        consequence="The account will be signed out and unable to sign in again."
        confirmLabel="Suspend"
        cancelLabel="Keep account"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Keep account' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
