import { useRef, useCallback } from 'react';

/**
 * Returns a stable trigger that coalesces bursts of calls into a single run of `fn`.
 * - Calls in the same tick collapse into one run scheduled on the next macrotask.
 * - Calls while a run is in flight collapse into exactly one trailing run.
 * This keeps reactive hooks from re-querying SQLite once per emitted row event.
 */
export function useCoalescedRunner(fn: () => Promise<void>): () => void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const state = useRef({
    scheduled: false,
    running: false,
    rerun: false
  });

  return useCallback(() => {
    const s = state.current;
    if (s.running) {
      s.rerun = true;
      return;
    }
    if (s.scheduled) return;
    s.scheduled = true;
    setTimeout(async () => {
      s.scheduled = false;
      s.running = true;
      try {
        do {
          s.rerun = false;
          await fnRef.current();
        } while (s.rerun);
      } finally {
        s.running = false;
      }
    }, 0);
  }, []);
}
