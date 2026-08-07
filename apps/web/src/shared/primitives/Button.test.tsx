import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './Button.js';

describe('Button', () => {
  it('renders its label and fires onClick when activated', async () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" onClick={onClick}>
        Confirm booking
      </Button>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('activates on Enter and Space — FRONTEND §5.1 keyboard requirement', async () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" onClick={onClick}>
        Confirm booking
      </Button>,
    );
    const user = userEvent.setup();
    await user.tab();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('does not fire onClick when disabled, and exposes the reason', async () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" disabled disabledReason="Needs a connection" onClick={onClick}>
        Sync now
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Sync now' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Needs a connection')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('a loading button is aria-busy and remains focusable', () => {
    render(
      <Button variant="primary" loading>
        Booking…
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Booking…' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    // A loading button is not the native `disabled` attribute — FRONTEND
    // §5.1 requires it to retain focus, which a natively disabled element
    // cannot do.
    expect(button).not.toBeDisabled();
  });
});
