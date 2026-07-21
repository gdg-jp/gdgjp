"use client";

import { Dialog as DialogPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "~/lib/utils";

function Sheet({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetTitle({ ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title data-slot="sheet-title" {...props} />;
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-overlay backdrop-blur-sm duration-[var(--motion-duration-enter)] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-[var(--motion-duration-exit)] data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:duration-100",
        className,
      )}
      {...props}
    />
  );
}

function SheetContent({
  className,
  children,
  side = "bottom",
  overlayClassName,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  side?: "bottom" | "left";
  overlayClassName?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <SheetOverlay className={overlayClassName} />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "fixed z-50 flex flex-col overflow-hidden bg-popover text-popover-foreground shadow-xl outline-none duration-[var(--motion-duration-enter)] data-[state=closed]:animate-out data-[state=closed]:duration-[var(--motion-duration-exit)] data-[state=open]:animate-in motion-reduce:duration-100",
          side === "bottom" &&
            "inset-x-0 bottom-0 max-h-[90vh] rounded-t-xl data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
          side === "left" &&
            "inset-y-0 left-0 w-80 max-w-[85vw] data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left",
          className,
        )}
        {...props}
      >
        {side === "bottom" ? (
          <div className="flex shrink-0 justify-center pt-3 pb-1" aria-hidden>
            <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
          </div>
        ) : null}
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export { Sheet, SheetClose, SheetContent, SheetOverlay, SheetTitle, SheetTrigger };
