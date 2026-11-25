import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useLatest } from "./latest";

const subscribeNever = () => () => {};

export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

export function useClientValue<T extends string | number | boolean | null | undefined>(
  read: () => T,
  serverValue: T,
): T {
  return useSyncExternalStore(subscribeNever, read, () => serverValue);
}

export function useMediaQuery(query: string, serverValue = false): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

export function useValueChange<T>(value: T, onChange: (value: T, previous: T) => void): void {
  const latest = useLatest(onChange);
  const previous = useRef(value);
  useEffect(() => {
    if (Object.is(previous.current, value)) return;
    const before = previous.current;
    previous.current = value;
    latest.current(value, before);
  }, [value, latest]);
}
