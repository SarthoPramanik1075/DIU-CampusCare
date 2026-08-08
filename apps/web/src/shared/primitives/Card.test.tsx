import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Card } from './Card.js';

describe('Card', () => {
  it('renders children', () => {
    render(<Card>Hello</Card>);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('renders an optional title as a heading', () => {
    render(<Card title="Today">content</Card>);
    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument();
  });

  it('omits the heading when no title is given', () => {
    render(<Card>content</Card>);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });
});
