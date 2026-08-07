import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Input } from './Input.js';

function ControlledInput(props: { readonly error?: string; readonly help?: string }) {
  const [value, setValue] = useState('');
  return <Input label="Student ID" value={value} onChange={setValue} {...props} />;
}

describe('Input', () => {
  it('the label is always visible, never a placeholder-as-label', () => {
    render(<ControlledInput />);
    expect(screen.getByLabelText('Student ID')).toBeInTheDocument();
  });

  it('calls onChange as the user types', async () => {
    const onChange = vi.fn();
    render(<Input label="Student ID" value="" onChange={onChange} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Student ID'), 'ab');
    expect(onChange).toHaveBeenNthCalledWith(1, 'a');
    expect(onChange).toHaveBeenNthCalledWith(2, 'b');
  });

  it('an error is three signals at once: aria-invalid, role=alert text, and the field is described by it', () => {
    render(<ControlledInput error="That student ID isn't recognised." />);
    const field = screen.getByLabelText('Student ID');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("That student ID isn't recognised.");
    expect(field.getAttribute('aria-describedby')).toContain(alert.id);
  });

  it('marks a required field with aria-required and the required attribute', () => {
    render(<Input label="Email" value="" onChange={vi.fn()} required />);
    const field = screen.getByLabelText('Email', { exact: false });
    expect(field).toHaveAttribute('aria-required', 'true');
    expect(field).toBeRequired();
  });
});
