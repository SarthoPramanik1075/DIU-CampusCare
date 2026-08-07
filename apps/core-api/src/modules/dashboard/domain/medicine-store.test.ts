import { describe, expect, it } from 'vitest';

import { computeMedicineStoreState } from './medicine-store.js';

describe('computeMedicineStoreState — BR-42', () => {
  it('is closed with no hours or times when nothing is configured', () => {
    expect(computeMedicineStoreState('10:00:00', null, null)).toEqual({
      isOpen: false,
      opensAt: null,
      closesAt: null,
      stateSource: 'scheduled_hours',
    });
  });

  it('is open when the current time falls within scheduled hours', () => {
    expect(computeMedicineStoreState('10:00:00', { opensAt: '09:00:00', closesAt: '17:00:00' }, null)).toEqual({
      isOpen: true,
      opensAt: '09:00:00',
      closesAt: '17:00:00',
      stateSource: 'scheduled_hours',
    });
  });

  it('is closed before opening time and at/after closing time', () => {
    const hours = { opensAt: '09:00:00', closesAt: '17:00:00' };
    expect(computeMedicineStoreState('08:59:59', hours, null).isOpen).toBe(false);
    expect(computeMedicineStoreState('17:00:00', hours, null).isOpen).toBe(false);
    expect(computeMedicineStoreState('16:59:59', hours, null).isOpen).toBe(true);
  });

  it('a same-day override wins over scheduled hours — BR-42', () => {
    const hours = { opensAt: '09:00:00', closesAt: '17:00:00' };
    expect(computeMedicineStoreState('10:00:00', hours, { isClosed: true })).toEqual({
      isOpen: false,
      opensAt: '09:00:00',
      closesAt: '17:00:00',
      stateSource: 'manual_override',
    });
  });

  it('an override forcing open still reports manual_override as the source', () => {
    const hours = { opensAt: '09:00:00', closesAt: '17:00:00' };
    expect(computeMedicineStoreState('20:00:00', hours, { isClosed: false }).stateSource).toBe('manual_override');
  });
});
