import { GripVertical } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
const ResizableContext = createContext(null);
const separatorRole = "separator";
function useResizableContext() {
  const context = useContext(ResizableContext);
  if (!context) throw new Error("Resizable parts must be used inside ResizablePanelGroup");
  return context;
}
export function ResizablePanelGroup({ direction = "horizontal", className, children, ...props }) {
  const [panels, setPanels] = useState([]);
  const registerPanel = useCallback((id, defaultSize) => {
    setPanels((current) =>
      current.some((panel) => panel.id === id)
        ? current
        : [...current, { id, size: Math.min(100, Math.max(0, defaultSize)) }],
    );
  }, []);
  const unregisterPanel = useCallback((id) => {
    setPanels((current) => current.filter((panel) => panel.id !== id));
  }, []);
  const setSizes = useCallback((sizes) => {
    setPanels((current) =>
      current.map((panel, index) => ({ ...panel, size: sizes[index] ?? panel.size })),
    );
  }, []);
  return _jsx(ResizableContext.Provider, {
    value: {
      direction,
      panels,
      sizes: panels.map((panel) => panel.size),
      setSizes,
      registerPanel,
      unregisterPanel,
    },
    children: _jsx("div", {
      ...props,
      "data-direction": direction,
      className: cn("gdg-resizable-group", className),
      children: children,
    }),
  });
}
export function ResizablePanel({
  defaultSize,
  minSize = 0,
  maxSize = 100,
  size,
  className,
  children,
  ...props
}) {
  const context = useResizableContext();
  const id = useId();
  useEffect(() => {
    context.registerPanel(id, defaultSize ?? 50);
    return () => context.unregisterPanel(id);
  }, [context.registerPanel, context.unregisterPanel, defaultSize, id]);
  const index = context.panels.findIndex((panel) => panel.id === id);
  const current = size ?? context.sizes[index] ?? defaultSize;
  return _jsx("div", {
    ...props,
    "data-panel-index": index >= 0 ? index : undefined,
    style: {
      ...props.style,
      [context.direction === "horizontal" ? "flexBasis" : "height"]:
        `${Math.min(maxSize, Math.max(minSize, current ?? 50))}%`,
    },
    className: cn("gdg-resizable-panel", className),
    children: children,
  });
}
export function ResizableHandle({ withHandle = false, className, onPointerDown, ...props }) {
  const context = useResizableContext();
  const start = useRef(null);
  const onMove = (event) => {
    const active = start.current;
    if (!active) return;
    const target = active.handle;
    const group = target.parentElement;
    if (!group) return;
    const length = context.direction === "horizontal" ? group.clientWidth : group.clientHeight;
    const delta =
      (((context.direction === "horizontal" ? event.clientX : event.clientY) - active.coordinate) /
        length) *
      100;
    const next = active.sizes.slice();
    const first = Number(target.previousElementSibling?.getAttribute("data-panel-index"));
    const second = Number(target.nextElementSibling?.getAttribute("data-panel-index"));
    if (Number.isNaN(first) || Number.isNaN(second)) return;
    next[first] = Math.max(0, Math.min(100, active.sizes[first] + delta));
    next[second] = Math.max(0, Math.min(100, active.sizes[second] - delta));
    context.setSizes(next);
  };
  const stop = () => {
    start.current = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", stop);
  };
  const begin = (event) => {
    onPointerDown?.(event);
    if (event.defaultPrevented) return;
    const coordinate = context.direction === "horizontal" ? event.clientX : event.clientY;
    start.current = { coordinate, sizes: context.sizes, handle: event.currentTarget };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop, { once: true });
  };
  return _jsx("div", {
    ...props,
    role: separatorRole,
    "aria-orientation": context.direction,
    tabIndex: 0,
    "data-with-handle": withHandle || undefined,
    className: cn("gdg-resizable-handle", className),
    onPointerDown: begin,
    onKeyDown: (event) => {
      const direction = context.direction === "horizontal" ? "ArrowRight" : "ArrowDown";
      const reverse = context.direction === "horizontal" ? "ArrowLeft" : "ArrowUp";
      if (event.key !== direction && event.key !== reverse) return;
      event.preventDefault();
      const delta = event.key === direction ? 2 : -2;
      const index = Number(
        event.currentTarget.previousElementSibling?.getAttribute("data-panel-index"),
      );
      const next = context.sizes.slice();
      if (!Number.isNaN(index) && next[index] !== undefined && next[index + 1] !== undefined) {
        next[index] += delta;
        next[index + 1] -= delta;
        context.setSizes(next);
      }
    },
    children: withHandle && _jsx(GripVertical, { size: 14, "aria-hidden": "true" }),
  });
}
export const Resizable = ResizablePanelGroup;
export const ResizablePanels = ResizablePanelGroup;
