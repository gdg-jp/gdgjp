import { Tooltip as RT } from "radix-ui";
import type { ComponentProps } from "react";
import { useMotionRef } from "../../hooks";
import { cn } from "../../utils";

export const TooltipProvider = RT.Provider;
export const Tooltip = RT.Root;
export const TooltipTrigger = RT.Trigger;

export function TooltipContent({ ref, className, ...props }: ComponentProps<typeof RT.Content>) {
  const motionRef = useMotionRef(ref);
  return (
    <RT.Portal>
      <RT.Content
        ref={motionRef}
        sideOffset={6}
        {...props}
        className={cn("gdg-popup", "gdg-tooltip", className)}
      />
    </RT.Portal>
  );
}
