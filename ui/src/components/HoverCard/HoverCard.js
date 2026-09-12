import { HoverCard as RHoverCard } from "radix-ui";
import { jsx as _jsx } from "react/jsx-runtime";
import { useMotionRef } from "../../hooks";
import { cn } from "../../utils";
export const HoverCard = RHoverCard.Root;
export const HoverCardTrigger = RHoverCard.Trigger;
export function HoverCardContent({ ref, className, ...props }) {
  const motionRef = useMotionRef(ref);
  return _jsx(RHoverCard.Portal, {
    children: _jsx(RHoverCard.Content, {
      ref: motionRef,
      sideOffset: 6,
      ...props,
      className: cn("gdg-popup", "gdg-hover-card", className),
    }),
  });
}
export const HoverCardArrow = RHoverCard.Arrow;
