import { Popover as RP } from "radix-ui";
import type { ComponentProps } from "react";
import { useMotionRef } from "../../hooks";
import { cn } from "../../utils";

export const Popover = RP.Root;
export const PopoverTrigger = RP.Trigger;
export const PopoverClose = RP.Close;

export function PopoverContent({ ref, className, ...props }: ComponentProps<typeof RP.Content>) {
  const motionRef = useMotionRef(ref);
  return (
    <RP.Portal>
      <RP.Content
        ref={motionRef}
        sideOffset={6}
        {...props}
        className={cn("gdg-popup", "gdg-popover", className)}
      />
    </RP.Portal>
  );
}
