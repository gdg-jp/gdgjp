import { Dialog as RDialog } from "radix-ui";
import type { ComponentProps } from "react";
import { useMotionRef } from "../../hooks";
import { cn } from "../../utils";

export const Drawer = RDialog.Root;
export const DrawerTrigger = RDialog.Trigger;
export const DrawerClose = RDialog.Close;
export const DrawerPortal = RDialog.Portal;

export function DrawerOverlay({ className, ...props }: ComponentProps<typeof RDialog.Overlay>) {
  return <RDialog.Overlay {...props} className={cn("gdg-overlay", className)} />;
}

export function DrawerContent({
  ref,
  className,
  children,
  ...props
}: ComponentProps<typeof RDialog.Content>) {
  const motionRef = useMotionRef(ref);
  return (
    <RDialog.Portal>
      <DrawerOverlay />
      <RDialog.Content ref={motionRef} {...props} className={cn("gdg-drawer", className)}>
        <div className="gdg-drawer-handle" aria-hidden="true" />
        {children}
      </RDialog.Content>
    </RDialog.Portal>
  );
}

export function DrawerHeader({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-drawer-header", className)} />;
}

export function DrawerFooter({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-drawer-footer", className)} />;
}

export function DrawerTitle({ className, ...props }: ComponentProps<typeof RDialog.Title>) {
  return <RDialog.Title {...props} className={cn("gdg-heading", className)} />;
}

export function DrawerDescription({
  className,
  ...props
}: ComponentProps<typeof RDialog.Description>) {
  return <RDialog.Description {...props} className={cn("gdg-text", "gdg-muted", className)} />;
}

export function DrawerHandle({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} aria-hidden="true" className={cn("gdg-drawer-handle", className)} />;
}
