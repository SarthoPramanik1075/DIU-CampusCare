import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Banner } from './Banner.js';

describe('Banner', () => {
  it('info and success tones use role=status', () => {
    render(<Banner tone="info" message="Booking is paused on your account until 18 August." />);
    expect(screen.getByRole('status')).toHaveTextContent('paused');
  });

  it('warning and danger tones use role=alert', () => {
    render(<Banner tone="danger" message="Something went wrong." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong.');
  });

  it('an info/success banner can be dismissed', async () => {
    const onDismiss = vi.fn();
    render(<Banner tone="info" message="Heads up." onDismiss={onDismiss} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('a warning/danger banner has no dismiss control — it conveys an active constraint', () => {
    // @ts-expect-error — onDismiss does not exist on the warning/danger arm
    // of the discriminated union; this is the type-level enforcement from
    // FRONTEND §5.8 under test, not an accident.
    render(<Banner tone="warning" message="You are offline." onDismiss={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
  });
});
