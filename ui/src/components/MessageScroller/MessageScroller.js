import { ArrowDown, ArrowUp } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from "../../utils";
import { Button } from "../Button";
const MessageScrollerContext = createContext(null);
function useMessageScrollerContext() {
  const context = useContext(MessageScrollerContext);
  if (!context)
    throw new Error("MessageScroller parts must be used inside MessageScrollerProvider");
  return context;
}
export function MessageScrollerProvider({ initialPosition = "end", follow = false, children }) {
  const [viewport, setViewport] = useState(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);
  const initialised = useRef(false);
  const update = useCallback(() => {
    if (!viewport) return;
    setAtStart(viewport.scrollTop <= 1);
    setAtEnd(viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 1);
  }, [viewport]);
  const scrollTo = useCallback(
    (position) => {
      viewport?.scrollTo({
        top: position === "start" ? 0 : viewport.scrollHeight,
        behavior: "smooth",
      });
    },
    [viewport],
  );
  const scrollToMessage = useCallback((messageId) => {
    document.getElementById(messageId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  useEffect(() => {
    if (!viewport) return;
    viewport.addEventListener("scroll", update, { passive: true });
    update();
    if (!initialised.current) {
      viewport.scrollTop = initialPosition === "end" ? viewport.scrollHeight : 0;
      initialised.current = true;
      update();
    }
    return () => viewport.removeEventListener("scroll", update);
  }, [initialPosition, update, viewport]);
  useEffect(() => {
    if (!viewport) return;
    const handleContentChange = () => {
      const wasAtEnd = viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 1;
      update();
      if (follow && wasAtEnd) {
        window.requestAnimationFrame(() => scrollTo("end"));
      }
    };
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(handleContentChange);
    resizeObserver?.observe(viewport);
    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? undefined
        : new MutationObserver(handleContentChange);
    mutationObserver?.observe(viewport, { childList: true, subtree: true, characterData: true });
    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [follow, scrollTo, update, viewport]);
  return _jsxs(MessageScrollerContext.Provider, {
    value: { viewport, setViewport, atStart, atEnd, scrollTo, scrollToMessage },
    children: [_jsx(MessageScrollerFollow, { follow: follow }), children],
  });
}
function MessageScrollerFollow({ follow }) {
  const context = useMessageScrollerContext();
  useEffect(() => {
    if (follow && context.atEnd) context.scrollTo("end");
  }, [context.atEnd, context.scrollTo, follow]);
  return null;
}
export function MessageScroller({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-message-scroller", className) });
}
export function MessageScrollerViewport({ ref, className, children, ...props }) {
  const context = useMessageScrollerContext();
  const setRef = (node) => {
    context.setViewport(node);
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };
  return _jsx("div", {
    ...props,
    ref: setRef,
    tabIndex: props.tabIndex ?? 0,
    role: props.role ?? "log",
    className: cn("gdg-message-scroller-viewport", className),
    children: children,
  });
}
export function MessageScrollerContent({ className, ...props }) {
  return _jsx("div", {
    ...props,
    "aria-live": props["aria-live"] ?? "polite",
    className: cn("gdg-message-scroller-content", className),
  });
}
export function MessageScrollerItem({ messageId, scrollAnchor, className, ...props }) {
  return _jsx("div", {
    ...props,
    id: messageId,
    "data-scroll-anchor": scrollAnchor || undefined,
    className: cn("gdg-message-scroller-item", className),
  });
}
export function MessageScrollerButton({ to = "end", children, className, ...props }) {
  const context = useMessageScrollerContext();
  const disabled = to === "end" ? context.atEnd : context.atStart;
  return _jsx(Button, {
    ...props,
    type: props.type ?? "button",
    variant: props.variant ?? "outline",
    size: props.size ?? "sm",
    disabled: props.disabled ?? disabled,
    "aria-label": props["aria-label"] ?? (to === "end" ? "最新へ移動" : "先頭へ移動"),
    className: cn("gdg-message-scroller-button", className),
    onClick: (event) => {
      props.onClick?.(event);
      if (!event.defaultPrevented) context.scrollTo(to);
    },
    children:
      children ??
      (to === "end"
        ? _jsx(ArrowDown, { size: 16, "aria-hidden": "true" })
        : _jsx(ArrowUp, { size: 16, "aria-hidden": "true" })),
  });
}
