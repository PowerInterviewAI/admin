"use client";

import { useEffect, useRef } from "react";

/**
 * Runs `onTick` on an interval for as long as `active`, one call at a time.
 *
 * The next tick is scheduled only after the previous one settles, so a slow round trip cannot
 * stack requests on a tab left open. `onTick` is read through a ref, which is what lets a caller
 * pass a closure over fresh props without restarting - and therefore resetting - the timer on
 * every render.
 *
 * No state is written here, keeping this clear of the project's ban on `react-hooks/
 * set-state-in-effect`: the effect only owns a timer, and whatever `onTick` sets happens later, in
 * an async callback.
 */
export function usePoll(active: boolean, intervalMs: number, onTick: () => Promise<void>): void {
  const tick = useRef(onTick);
  useEffect(() => {
    tick.current = onTick;
  });

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const run = async () => {
      await tick.current();
      if (!cancelled) timer = setTimeout(() => void run(), intervalMs);
    };

    timer = setTimeout(() => void run(), intervalMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, intervalMs]);
}
