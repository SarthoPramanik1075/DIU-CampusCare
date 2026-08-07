import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusBadge } from './StatusBadge.js';

describe('StatusBadge', () => {
  it('renders the label as text, independent of colour — FRONTEND §5.2 / O3', () => {
    render(<StatusBadge tone="warning" icon="clock" label="Waiting" />);
    expect(screen.getByText('Waiting')).toBeInTheDocument();
  });

  it('the icon is aria-hidden — the label alone carries the accessible name', () => {
    const { container } = render(<StatusBadge tone="danger" icon="x" label="No-show" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('is not interactive — no role, no button, no link', () => {
    render(<StatusBadge tone="info" icon="info" label="Booked" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
