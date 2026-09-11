import { X } from "lucide-react";
import {
  AlertDialog as RA,
  Dialog as RD,
  DropdownMenu as RM,
  Popover as RP,
  Tooltip as RT,
} from "radix-ui";
import type { ComponentProps } from "react";
import { IconButton } from "./foundations";
import { useMotionRef } from "./motion";
import { cn } from "./utils";
export const Dialog = RD.Root;
export const DialogTrigger = RD.Trigger;
export const DialogClose = RD.Close;
export function DialogTitle({ className, ...props }: ComponentProps<typeof RD.Title>) {
  return <RD.Title {...props} className={cn("gdg-heading", className)} />;
}
export function DialogDescription({ className, ...props }: ComponentProps<typeof RD.Description>) {
  return <RD.Description {...props} className={cn("gdg-muted", className)} />;
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
export const Sheet = RD.Root;
export const SheetTrigger = RD.Trigger;
export const SheetClose = RD.Close;
export const SheetTitle = DialogTitle;
export const SheetDescription = DialogDescription;
export function SheetContent({
  className,
  side = "left",
  ...props
}: ComponentProps<typeof DialogContent> & { side?: "left" | "right" }) {
  return <DialogContent {...props} className={cn("gdg-sheet", `gdg-sheet-${side}`, className)} />;
}
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
export const DropdownMenu = RM.Root;
export const DropdownMenuTrigger = RM.Trigger;
export function DropdownMenuContent({
  ref,
  className,
  ...props
}: ComponentProps<typeof RM.Content>) {
  const motionRef = useMotionRef(ref);
  return (
    <RM.Portal>
      <RM.Content
        ref={motionRef}
        sideOffset={4}
        {...props}
        className={cn("gdg-popup", "gdg-menu", className)}
      />
    </RM.Portal>
  );
}
export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof RM.Item>) {
  return <RM.Item {...props} className={cn("gdg-menu-item", className)} />;
}
export const DropdownMenuGroup = RM.Group;
export const DropdownMenuLabel = RM.Label;
export function DropdownMenuSeparator(props: ComponentProps<typeof RM.Separator>) {
  return <RM.Separator {...props} className={cn("gdg-separator", props.className)} />;
}
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
