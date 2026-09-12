import { AlertDialog as RA } from "radix-ui";
import type { ComponentProps } from "react";
import { useMotionRef } from "../../hooks";
import { cn } from "../../utils";

export const AlertDialog = RA.Root;
export const AlertDialogTrigger = RA.Trigger;
export const AlertDialogAction = RA.Action;
export const AlertDialogCancel = RA.Cancel;
export const AlertDialogTitle = RA.Title;
export const AlertDialogDescription = RA.Description;

export function AlertDialogContent({
  ref,
  className,
  ...props
}: ComponentProps<typeof RA.Content>) {
  const motionRef = useMotionRef(ref);
  return (
    <RA.Portal>
      <RA.Overlay className="gdg-overlay" />
      <RA.Content ref={motionRef} {...props} className={cn("gdg-dialog", className)} />
    </RA.Portal>
  );
}
