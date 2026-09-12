import { Dialog as RD } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../utils";
import { DialogContent, DialogDescription, DialogTitle } from "../Dialog";

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
