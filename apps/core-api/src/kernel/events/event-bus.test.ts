import { describe, expect, it, vi } from 'vitest';

import { EventBus } from './event-bus.js';

interface AppointmentBooked {
  readonly appointmentId: string;
}

describe('EventBus', () => {
  it('delivers a published event to every subscriber', async () => {
    const bus = new EventBus();
    const first = vi.fn();
    const second = vi.fn();
    bus.subscribe<AppointmentBooked>('AppointmentBooked', first);
    bus.subscribe<AppointmentBooked>('AppointmentBooked', second);

    await bus.publish('AppointmentBooked', { appointmentId: 'a1' });

    expect(first).toHaveBeenCalledWith({ appointmentId: 'a1' });
    expect(second).toHaveBeenCalledWith({ appointmentId: 'a1' });
  });

  it('does nothing, without throwing, for an event type with no subscribers', async () => {
    const bus = new EventBus();
    await expect(bus.publish('NothingListensToThis', {})).resolves.toBeUndefined();
  });

  it('does not deliver to a subscriber of a different event type', async () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.subscribe('WalkInInserted', handler);
    await bus.publish('AppointmentBooked', {});
    expect(handler).not.toHaveBeenCalled();
  });

  it('unsubscribe stops further delivery', async () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const unsubscribe = bus.subscribe('AppointmentBooked', handler);
    unsubscribe();
    await bus.publish('AppointmentBooked', {});
    expect(handler).not.toHaveBeenCalled();
  });

  it('runs every handler even when one throws, then reports the failure', async () => {
    const bus = new EventBus();
    const succeeded = vi.fn();
    bus.subscribe('AppointmentBooked', () => {
      throw new Error('handler bug');
    });
    bus.subscribe('AppointmentBooked', succeeded);

    await expect(bus.publish('AppointmentBooked', {})).rejects.toThrow(AggregateError);
    expect(succeeded).toHaveBeenCalled();
  });

  it('waits for async handlers before resolving', async () => {
    const bus = new EventBus();
    let completed = false;
    bus.subscribe('AppointmentBooked', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      completed = true;
    });
    await bus.publish('AppointmentBooked', {});
    expect(completed).toBe(true);
  });

  it('aggregates every rejection reason when multiple handlers fail', async () => {
    const bus = new EventBus();
    bus.subscribe('X', () => {
      throw new Error('first');
    });
    bus.subscribe('X', () => {
      throw new Error('second');
    });

    try {
      await bus.publish('X', {});
      expect.fail('expected publish to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      const messages = (error as AggregateError).errors.map((e: unknown) =>
        e instanceof Error ? e.message : String(e),
      );
      expect(messages.sort()).toEqual(['first', 'second']);
    }
  });
});
