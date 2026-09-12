import { Tooltip as RT } from "radix-ui";
import { jsx as _jsx } from "react/jsx-runtime";
import { useMotionRef } from "../../hooks";
import { cn } from "../../utils";
export const TooltipProvider = RT.Provider;
export const Tooltip = RT.Root;
export const TooltipTrigger = RT.Trigger;
export function TooltipContent({ ref, className, ...props }) {
  const motionRef = useMotionRef(ref);
  return _jsx(RT.Portal, {
    children: _jsx(RT.Content, {
      ref: motionRef,
      sideOffset: 6,
      ...props,
      className: cn("gdg-popup", "gdg-tooltip", className),
    }),
  });
}
