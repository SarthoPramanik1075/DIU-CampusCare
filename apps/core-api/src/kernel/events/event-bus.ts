/**
 * The in-process event bus — ARCHITECTURE §3.1, §5.5.
 *
 * Domain modules communicate only through this bus or a published module
 * interface (DR-2) — never by importing each other's internals. Events are
 * plain data identified by a string type; there is deliberately no shared
 * "Event" base class or registry here, because that would be exactly the
 * kind of cross-module coupling DR-2 exists to prevent — a module publishes
 * whatever shape its own domain defines, and a subscriber that wants to read
 * it agrees on that shape out of band (a shared type in a package both may
 * depend on, not a dependency on the publishing module itself).
 *
 * One event bus instance per process. `EstimateSlipped` never leaves this
 * process, and `CounselingRequestSubmitted` never enters it — the vault has
 * its own, entirely separate bus (ARCHITECTURE §5.5: "Counseling events do
 * not enter the Core event bus").
 */
export type EventHandler<T> = (event: T) => Promise<void> | void;

export class EventBus {
  private readonly handlers = new Map<string, Set<EventHandler<never>>>();

  /** Returns an unsubscribe function. */
  subscribe<T>(eventType: string, handler: EventHandler<T>): () => void {
    let set = this.handlers.get(eventType);
    if (set === undefined) {
      set = new Set();
      this.handlers.set(eventType, set);
    }
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }

  /**
   * Runs every subscriber for `eventType`. All handlers run even if one
   * throws — one subscriber's bug must not prevent another from reacting to
   * the same event — but the publisher is told something failed rather than
   * having it disappear silently, because a subscriber throwing is a genuine
   * defect, not a business-rule outcome (ARCHITECTURE §10.5 draws that line
   * at the domain layer; this is infrastructure, where an uncaught throw is
   * exactly the right way to surface a programming error).
   */
  // `event` is intentionally `unknown`, not a second generic parameter: publish
  // and subscribe are independent calls with no shared type witness between
  // them (a subscriber's `T` is fixed at subscribe time, unrelated to any
  // particular publish call), so a type parameter here would be
  // decorative — it could not check that `event` actually matches what any
  // subscriber expects.
  async publish(eventType: string, event: unknown): Promise<void> {
    const set = this.handlers.get(eventType);
    if (set === undefined || set.size === 0) return;

    // A handler that throws synchronously (rather than returning a rejected
    // promise) would otherwise escape `.map()` itself, before
    // `Promise.allSettled` ever receives a promise to settle — aborting
    // dispatch to every handler that hadn't run yet. Wrapping each call in an
    // `async` arrow guarantees a promise is always returned, converting a
    // synchronous throw into an ordinary rejection so every handler still
    // runs regardless of how an earlier one failed.
    const outcomes = await Promise.allSettled(
      [...set].map(async (handler) => handler(event as never)),
    );
    const failures = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
    );
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((f) => f.reason as unknown),
        `${String(failures.length)} of ${String(outcomes.length)} handler(s) for "${eventType}" failed.`,
      );
    }
  }
}
