import { X } from "lucide-react";
import { Dialog as RD } from "radix-ui";
import type { ComponentProps } from "react";
import { useMotionRef } from "../../hooks";
import { cn } from "../../utils";
import { IconButton } from "../IconButton";

export const Dialog = RD.Root;
export const DialogTrigger = RD.Trigger;
export const DialogClose = RD.Close;

export function DialogTitle({ className, ...props }: ComponentProps<typeof RD.Title>) {
  return <RD.Title {...props} className={cn("gdg-heading", className)} />;
}

export function DialogDescription({ className, ...props }: ComponentProps<typeof RD.Description>) {
  return <RD.Description {...props} className={cn("gdg-text gdg-muted", className)} />;
}

export function DialogContent({
  ref,
  className,
  children,
  closeLabel = "閉じる",
  ...props
}: ComponentProps<typeof RD.Content> & { closeLabel?: string }) {
  const motionRef = useMotionRef(ref);
  return (
    <RD.Portal>
      <RD.Overlay className="gdg-overlay" />
      <RD.Content ref={motionRef} {...props} className={cn("gdg-dialog", className)}>
        {children}
        <RD.Close asChild>
          <IconButton aria-label={closeLabel} variant="ghost" className="gdg-dialog-close">
            <X size={18} />
          </IconButton>
        </RD.Close>
      </RD.Content>
    </RD.Portal>
  );
}
