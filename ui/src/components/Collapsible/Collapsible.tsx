import { Collapsible as RCollapsible } from "radix-ui";
import { type ComponentProps, type Ref, useCallback, useRef } from "react";
import { useMotionRef } from "../../hooks";
import { cn } from "../../utils";

export const Collapsible = RCollapsible.Root;
export const CollapsibleTrigger = RCollapsible.Trigger;

function useCollapsibleContentRef<T extends HTMLElement>(forwardedRef?: Ref<T>) {
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
      const measureHeight = () => {
        const radixHeight = Number.parseFloat(
          node.style.getPropertyValue("--radix-collapsible-content-height"),
        );
        return node.scrollHeight || (Number.isFinite(radixHeight) ? radixHeight : 0);
      };
      const syncState = (animate: boolean) => {
        if (frame !== undefined) {
          cancelAnimationFrame(frame);
          frame = undefined;
        }

        const open = node.dataset.state === "open";
        const height = open ? measureHeight() : 0;
        const opacity = open ? 1 : 0;
        if (!animate) {
          node.style.height = `${height}px`;
          node.style.opacity = `${opacity}`;
          return;
        }

        frame = requestAnimationFrame(() => {
          frame = undefined;
          node.style.height = `${height}px`;
          node.style.opacity = `${opacity}`;
        });
      };

      syncState(false);
      const observer = new MutationObserver(() => syncState(true));
      observer.observe(node, { attributes: true, attributeFilter: ["data-state"] });
      cleanupRef.current = () => {
        if (frame !== undefined) cancelAnimationFrame(frame);
        observer.disconnect();
        cleanupMotion?.();
        cleanupRef.current = undefined;
      };
      return cleanupRef.current;
    },
    [motionRef],
  );
}

export function CollapsibleContent({
  ref,
  className,
  forceMount = true,
  ...props
}: ComponentProps<typeof RCollapsible.Content>) {
  const motionRef = useCollapsibleContentRef(ref);
  return (
    <RCollapsible.Content
      ref={motionRef}
      forceMount={forceMount}
      {...props}
      className={cn("gdg-collapsible-content", className)}
    />
  );
}
