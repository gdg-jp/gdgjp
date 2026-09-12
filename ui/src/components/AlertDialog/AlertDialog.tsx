import { AlertDialog as RA } from "radix-ui";
import type { ComponentProps } from "react";
import { useMotionRef } from "../../hooks";
import { cn } from "../../utils";

export const AlertDialog = RA.Root;
export const AlertDialogTrigger = RA.Trigger;
export const AlertDialogAction = RA.Action;
export const AlertDialogCancel = RA.Cancel;

export function AlertDialogTitle({ className, ...props }: ComponentProps<typeof RA.Title>) {
  return <RA.Title {...props} className={cn("gdg-heading", className)} />;
}

export function AlertDialogDescription({
  className,
  ...props
}: ComponentProps<typeof RA.Description>) {
  return <RA.Description {...props} className={cn("gdg-text gdg-muted", className)} />;
}

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
