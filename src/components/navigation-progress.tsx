"use client";

import { useLinkStatus } from "next/link";
import { useEffect, useSyncExternalStore } from "react";

/**
 * How many navigations are in flight, held outside React so that the things which know they are
 * pending (a `useTransition`, a `<Link>`) and the things which show it (the bar, the page dim) do
 * not have to share an ancestor. A count rather than a flag: a filter change and a sidebar click
 * can overlap, and the first to finish must not clear the other's indicator.
 */
let inFlight = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function trackPending() {
  inFlight += 1;
  emit();
  return () => {
    inFlight -= 1;
    emit();
  };
}

/** Reports a pending navigation for as long as `pending` is true. */
export function usePendingNavigation(pending: boolean) {
  useEffect(() => {
    if (!pending) return;
    return trackPending();
  }, [pending]);
}

export function useIsNavigating(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => inFlight > 0,
    () => false,
  );
}

/**
 * Drop inside any `<Link>` so its click shows up in the bar. `useLinkStatus` only reports for the
 * link it is a descendant of, and stays false when the route was already prefetched - which is the
 * case where the skeleton appears at once and nothing needs saying.
 */
export function LinkPending() {
  usePendingNavigation(useLinkStatus().pending);
  return null;
}

/**
 * Mounted only while something is pending, so the animation and its delay restart on every
 * navigation: the delay is what keeps a fast one from flashing a bar nobody had time to read.
 */
export function NavigationProgress() {
  const navigating = useIsNavigating();
  if (!navigating) return null;

  return (
    <div
      role="progressbar"
      aria-label="Loading"
      className="nav-progress pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden"
    >
      <div className="nav-progress-bar h-full w-1/3 bg-primary" />
    </div>
  );
}
