import { useEffect } from "react";
import type { RefObject } from "react";
import { useLatest } from "./latest";

type EventMapOf<T> = T extends Window
  ? WindowEventMap
  : T extends Document
    ? DocumentEventMap
    : T extends HTMLElement
      ? HTMLElementEventMap
      : T extends MediaQueryList
        ? MediaQueryListEventMap
        : T extends WebSocket
          ? WebSocketEventMap
          : Record<string, Event>;

type EventOf<T, K extends string> = K extends keyof EventMapOf<T> ? EventMapOf<T>[K] : Event;

export type EventListenerTarget<T extends EventTarget> = T | RefObject<T | null> | null | undefined;

export type ListenerOptions = {
  capture?: boolean;
  passive?: boolean;
  once?: boolean;
};

function resolveTarget(
  target: "window" | "document" | EventListenerTarget<EventTarget>,
): EventTarget | null {
  if (target === "window") return typeof window === "undefined" ? null : window;
  if (target === "document") return typeof document === "undefined" ? null : document;
  if (!target) return null;
  if ("current" in target) return target.current;
  return target;
}

export function useEventListener<K extends keyof WindowEventMap & string>(
  target: "window",
  type: K,
  listener: (event: WindowEventMap[K]) => void,
  options?: ListenerOptions,
): void;
export function useEventListener<K extends keyof DocumentEventMap & string>(
  target: "document",
  type: K,
  listener: (event: DocumentEventMap[K]) => void,
  options?: ListenerOptions,
): void;
export function useEventListener<T extends EventTarget, K extends string>(
  target: EventListenerTarget<T>,
  type: K,
  listener: (event: EventOf<T, K>) => void,
  options?: ListenerOptions,
): void;
export function useEventListener(
  target: "window" | "document" | EventListenerTarget<EventTarget>,
  type: string,
  listener: (event: Event) => void,
  { capture = false, passive, once = false }: ListenerOptions = {},
): void {
  const latest = useLatest(listener);
  const element = typeof target === "object" && target && "current" in target ? null : target;
  const ref = typeof target === "object" && target && "current" in target ? target : null;
  useEffect(() => {
    const resolved = resolveTarget(ref ?? element);
    if (!resolved) return;
    const handle = (event: Event) => latest.current(event);
    resolved.addEventListener(type, handle, { capture, passive, once });
    return () => resolved.removeEventListener(type, handle, { capture });
  }, [element, ref, type, capture, passive, once, latest]);
}
