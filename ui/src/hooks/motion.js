import { useCallback, useLayoutEffect, useRef, useState } from "react";
/** Radix owns presence/focus. Closing surfaces become inert during their visual exit. */
export function useMotionRef(forwardedRef) {
  const cleanup = useRef(undefined);
  return useCallback(
    (node) => {
      cleanup.current?.();
      let disposeRef;
      if (typeof forwardedRef === "function") disposeRef = forwardedRef(node) || undefined;
      else if (forwardedRef) forwardedRef.current = node;
      if (!node) return;
      const update = () => {
        node.inert = node.dataset.state === "closed";
      };
      update();
      const observer = new MutationObserver(update);
      observer.observe(node, { attributes: true, attributeFilter: ["data-state"] });
      cleanup.current = () => {
        observer.disconnect();
        disposeRef?.();
        cleanup.current = undefined;
      };
      return () => {
        cleanup.current?.();
        if (!disposeRef && typeof forwardedRef === "function") forwardedRef(null);
        else if (forwardedRef && typeof forwardedRef !== "function") forwardedRef.current = null;
      };
    },
    [forwardedRef],
  );
}
/** Select lacks a forceMount API; retain its visual subtree for the CSS exit only. */
export function useExitPresence(open, node) {
  const [retained, setRetained] = useState(open);
  useLayoutEffect(() => {
    if (open) {
      setRetained(true);
      return;
    }
    if (!retained) return;
    const element = node.current;
    const duration = element
      ? Math.max(
          ...getComputedStyle(element)
            .transitionDuration.split(",")
            .map((value) => Number.parseFloat(value) * (value.trim().endsWith("ms") ? 1 : 1000)),
        )
      : 0;
    if (!duration) {
      setRetained(false);
      return;
    }
    const timer = window.setTimeout(() => setRetained(false), duration);
    return () => window.clearTimeout(timer);
  }, [open, retained, node]);
  return open || retained;
}
