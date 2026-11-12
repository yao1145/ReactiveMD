import { useSyncExternalStore } from 'react';

const subscribeNothing = () => () => {};

/**
 * False on the server and during the hydration pass, true afterwards.
 * Client-only libraries such as Mafs use it to keep the first client render
 * identical to the static server markup.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNothing, () => true, () => false);
}
