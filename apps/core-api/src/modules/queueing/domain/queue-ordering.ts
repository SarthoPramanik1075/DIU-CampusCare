/**
 * Domain layer — DR-6. BR-18/API §4.1: the queue is ordered
 * `is_emergency DESC, serial_number ASC`, computed fresh on every read —
 * never stored (DATABASE §4.3) — because an emergency insertion reorders
 * the *display* without renumbering anyone's serial (EC-09).
 */
export interface QueueOrderable {
  readonly isEmergency: boolean;
  readonly serialNumber: number;
}

export function compareQueueOrder(a: QueueOrderable, b: QueueOrderable): number {
  if (a.isEmergency !== b.isEmergency) return a.isEmergency ? -1 : 1;
  return a.serialNumber - b.serialNumber;
}

export function orderQueue<T extends QueueOrderable>(entries: readonly T[]): T[] {
  return [...entries].sort(compareQueueOrder);
}
