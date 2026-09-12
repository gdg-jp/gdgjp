import { ChevronDown } from "lucide-react";
import { Accordion as RAccordion } from "radix-ui";
import { type ComponentProps, type Ref, useCallback, useRef } from "react";
import { useMotionRef } from "../../hooks";
import { cn } from "../../utils";

export const Accordion = RAccordion.Root;

function useAccordionContentRef<T extends HTMLElement>(forwardedRef?: Ref<T>) {
  const motionRef = useMotionRef(forwardedRef);
  const cleanupRef = useRef<(() => void) | undefined>(undefined);

  return useCallback(
    (node: T | null) => {
      cleanupRef.current?.();
      cleanupRef.current = undefined;
      const cleanupMotion = motionRef(node);
      if (!node) {
        cleanupMotion?.();
        return;
      }

      let frame: number | undefined;
      const inner = node.firstElementChild;
      const measureHeight = () => inner?.getBoundingClientRect().height ?? node.scrollHeight;
      const setHeight = (height: number) => {
        node.style.setProperty("--gdg-accordion-height", `${height}px`);
      };
      const syncHeight = (animate: boolean) => {
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

export function AccordionItem({ className, ...props }: ComponentProps<typeof RAccordion.Item>) {
  return <RAccordion.Item {...props} className={cn("gdg-accordion-item", className)} />;
}

export function AccordionTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof RAccordion.Trigger>) {
  return (
    <RAccordion.Header className="gdg-accordion-heading">
      <RAccordion.Trigger {...props} className={cn("gdg-accordion-trigger", className)}>
        {children}
        <ChevronDown className="gdg-accordion-chevron" aria-hidden="true" size={16} />
      </RAccordion.Trigger>
    </RAccordion.Header>
  );
}

export function AccordionContent({
  ref,
  className,
  children,
  forceMount = true,
  ...props
}: ComponentProps<typeof RAccordion.Content>) {
  const motionRef = useAccordionContentRef(ref);
  return (
    <RAccordion.Content
      ref={motionRef}
      forceMount={forceMount}
      {...props}
      className={cn("gdg-accordion-content", className)}
    >
      <div className="gdg-accordion-inner">{children}</div>
    </RAccordion.Content>
  );
}
