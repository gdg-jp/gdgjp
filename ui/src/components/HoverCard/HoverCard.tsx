import { HoverCard as RHoverCard } from "radix-ui";
import type { ComponentProps } from "react";
import { useMotionRef } from "../../hooks";
import { cn } from "../../utils";

export const HoverCard = RHoverCard.Root;
export const HoverCardTrigger = RHoverCard.Trigger;

export function HoverCardContent({
  ref,
  className,
  ...props
}: ComponentProps<typeof RHoverCard.Content>) {
  const motionRef = useMotionRef(ref);
  return (
    <RHoverCard.Portal>
      <RHoverCard.Content
        ref={motionRef}
        sideOffset={6}
        {...props}
        className={cn("gdg-popup", "gdg-hover-card", className)}
      />
    </RHoverCard.Portal>
  );
}

export const HoverCardArrow = RHoverCard.Arrow;
