import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False in the server HTML and while React hydrates it, true after. Controls
 * that only work with JavaScript stay disabled until then, so a tap on a slow
 * phone is not silently dropped.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
