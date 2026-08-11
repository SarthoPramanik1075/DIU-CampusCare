import { describe, expect, it } from 'vitest';

import { formatAppointmentRef } from './appointment-ref.js';

describe('formatAppointmentRef — FR-APT-04', () => {
  it('pads the sequence to 4 digits', () => {
    expect(formatAppointmentRef(2026, 81)).toBe('MED-2026-0081');
  });

  it('does not truncate a sequence wider than the pad width', () => {
    expect(formatAppointmentRef(2026, 12345)).toBe('MED-2026-12345');
  });
});
