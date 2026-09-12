import { ChevronDown } from "lucide-react";
import { Accordion as RAccordion } from "radix-ui";
import { useCallback, useRef } from "react";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMotionRef } from "../../hooks";
import { cn } from "../../utils";
export const Accordion = RAccordion.Root;
function useAccordionContentRef(forwardedRef) {
  const motionRef = useMotionRef(forwardedRef);
  const cleanupRef = useRef(undefined);
  return useCallback(
    (node) => {
      cleanupRef.current?.();
      cleanupRef.current = undefined;
      const cleanupMotion = motionRef(node);
      if (!node) {
        cleanupMotion?.();
        return;
      }
      let frame;
      const inner = node.firstElementChild;
      const measureHeight = () => inner?.getBoundingClientRect().height ?? node.scrollHeight;
      const setHeight = (height) => {
        node.style.setProperty("--gdg-accordion-height", `${height}px`);
      };
      const syncHeight = (animate) => {
        if (frame !== undefined) {
          cancelAnimationFrame(frame);
          frame = undefined;
        }
        const open = node.dataset.state === "open";
        const target = open ? measureHeight() : 0;
        if (!animate) {
          setHeight(target);
          return;
        }
        setHeight(open ? 0 : measureHeight());
        frame = requestAnimationFrame(() => {
          frame = undefined;
          setHeight(target);
        });
      };
      syncHeight(false);
      const observer = new MutationObserver(() => syncHeight(true));
      observer.observe(node, { attributes: true, attributeFilter: ["data-state"] });
      const resizeObserver =
        typeof ResizeObserver === "undefined" || !inner
          ? undefined
          : new ResizeObserver(() => {
              if (node.dataset.state === "open") setHeight(measureHeight());
            });
      if (resizeObserver && inner) resizeObserver.observe(inner);
      cleanupRef.current = () => {
        if (frame !== undefined) cancelAnimationFrame(frame);
        observer.disconnect();
        resizeObserver?.disconnect();
        cleanupMotion?.();
        cleanupRef.current = undefined;
      };
      return cleanupRef.current;
    },
    [motionRef],
  );
}
export function AccordionItem({ className, ...props }) {
  return _jsx(RAccordion.Item, { ...props, className: cn("gdg-accordion-item", className) });
}
export function AccordionTrigger({ className, children, ...props }) {
  return _jsx(RAccordion.Header, {
    className: "gdg-accordion-heading",
    children: _jsxs(RAccordion.Trigger, {
      ...props,
      className: cn("gdg-accordion-trigger", className),
      children: [
        children,
        _jsx(ChevronDown, { className: "gdg-accordion-chevron", "aria-hidden": "true", size: 16 }),
      ],
    }),
  });
}
export function AccordionContent({ ref, className, children, forceMount = true, ...props }) {
  const motionRef = useAccordionContentRef(ref);
  return _jsx(RAccordion.Content, {
    ref: motionRef,
    forceMount: forceMount,
    ...props,
    className: cn("gdg-accordion-content", className),
    children: _jsx("div", { className: "gdg-accordion-inner", children: children }),
  });
}
