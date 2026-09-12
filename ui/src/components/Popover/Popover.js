import { Popover as RP } from "radix-ui";
import { jsx as _jsx } from "react/jsx-runtime";
import { useMotionRef } from "../../hooks";
import { cn } from "../../utils";
export const Popover = RP.Root;
export const PopoverTrigger = RP.Trigger;
export const PopoverClose = RP.Close;
export function PopoverContent({ ref, className, ...props }) {
  const motionRef = useMotionRef(ref);
  return _jsx(RP.Portal, {
    children: _jsx(RP.Content, {
      ref: motionRef,
      sideOffset: 6,
      ...props,
      className: cn("gdg-popup", "gdg-popover", className),
    }),
  });
}
