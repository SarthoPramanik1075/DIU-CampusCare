import { useEffect, useState } from 'react';

/**
 * FRONTEND §5.11 — "< 300ms: nothing. A flash of skeleton is worse than a
 * brief pause." Returns `true` only once `active` has stayed `true` for
 * `delayMs` without interruption, so a fast (cached, same-network) response
 * never shows a loading treatment at all.
 */
export function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    if (!active) {
      setElapsed(false);
      return;
    }
    const timer = setTimeout(() => {
      setElapsed(true);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [active, delayMs]);

  return active && elapsed;
}
