import { describe, expect, it } from 'vitest';

import { orderQueue, type QueueOrderable } from './queue-ordering.js';

function entry(serialNumber: number, isEmergency = false): QueueOrderable {
  return { serialNumber, isEmergency };
}

describe('orderQueue — BR-18, API §4.1', () => {
  it('orders by serial ascending when no emergencies are present', () => {
    const ordered = orderQueue([entry(3), entry(1), entry(2)]);
    expect(ordered.map((item) => item.serialNumber)).toEqual([1, 2, 3]);
  });

  it('places every emergency ahead of every non-emergency, regardless of serial', () => {
    const ordered = orderQueue([entry(1), entry(50, true), entry(2), entry(3)]);
    expect(ordered.map((item) => item.serialNumber)).toEqual([50, 1, 2, 3]);
  });

  it('orders multiple emergencies by serial ascending among themselves (EC-12: insertion order)', () => {
    const ordered = orderQueue([entry(10, true), entry(2), entry(5, true)]);
    expect(ordered.map((item) => item.serialNumber)).toEqual([5, 10, 2]);
  });

  it('does not mutate the input array', () => {
    const input = [entry(3), entry(1)];
    const ordered = orderQueue(input);
    expect(input.map((item) => item.serialNumber)).toEqual([3, 1]);
    expect(ordered).not.toBe(input);
  });
});
