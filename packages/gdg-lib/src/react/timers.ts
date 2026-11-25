import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLatest } from "./latest";

export function useInterval(callback: () => void, delayMs: number | null): void {
  const latest = useLatest(callback);
  useEffect(() => {
    if (delayMs === null) return;
    const id = setInterval(() => latest.current(), delayMs);
    return () => clearInterval(id);
  }, [delayMs, latest]);
}

export function useNow(intervalMs: number | null = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useInterval(() => setNow(Date.now()), intervalMs);
  return now;
}

export type TimeoutHandle = {
  start: (callback: () => void, delayMs: number) => void;
  cancel: () => void;
};

export function useTimeout(): TimeoutHandle {
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const handle = useMemo<TimeoutHandle>(
    () => ({
      start(callback, delayMs) {
        clearTimeout(pending.current);
        pending.current = setTimeout(() => {
          pending.current = undefined;
          callback();
        }, delayMs);
      },
      cancel() {
        clearTimeout(pending.current);
        pending.current = undefined;
      },
    }),
    [],
  );
  useEffect(() => handle.cancel, [handle]);
  return handle;
}

export function useTransientValue<T>(
  durationMs: number,
): [value: T | null, show: (value: T) => void, clear: () => void] {
  const [value, setValue] = useState<T | null>(null);
  const timeout = useTimeout();
  const show = useCallback(
    (next: T) => {
      setValue(() => next);
      timeout.start(() => setValue(null), durationMs);
    },
    [durationMs, timeout],
  );
  const clear = useCallback(() => {
    timeout.cancel();
    setValue(null);
  }, [timeout]);
  return [value, show, clear];
}

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(() => value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export type DebouncedCallback<Args extends unknown[]> = {
  run: (...args: Args) => void;
  flush: () => void;
  cancel: () => void;
};

export function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delayMs: number,
): DebouncedCallback<Args> {
  const latest = useLatest(callback);
  const pending = useRef<{ id: ReturnType<typeof setTimeout>; args: Args } | null>(null);
  const debounced = useMemo<DebouncedCallback<Args>>(
    () => ({
      run(...args) {
        if (pending.current) clearTimeout(pending.current.id);
        const id = setTimeout(() => {
          pending.current = null;
          latest.current(...args);
        }, delayMs);
        pending.current = { id, args };
      },
      flush() {
        const current = pending.current;
        if (!current) return;
        clearTimeout(current.id);
        pending.current = null;
        latest.current(...current.args);
      },
      cancel() {
        if (pending.current) clearTimeout(pending.current.id);
        pending.current = null;
      },
    }),
    [delayMs, latest],
  );
  useEffect(() => debounced.cancel, [debounced]);
  return debounced;
}

export function useAnimationFrame(
  callback: (time: number, deltaMs: number) => void,
  active = true,
): void {
  const latest = useLatest(callback);
  useEffect(() => {
    if (!active || typeof requestAnimationFrame === "undefined") return;
    let previous: number | undefined;
    let frame = requestAnimationFrame(function loop(time) {
      const delta = previous === undefined ? 0 : time - previous;
      previous = time;
      latest.current(time, delta);
      frame = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(frame);
  }, [active, latest]);
}
