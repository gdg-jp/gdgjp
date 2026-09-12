import { Dialog as RD } from "radix-ui";
import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
import { DialogContent, DialogDescription, DialogTitle } from "../Dialog";
export const Sheet = RD.Root;
export const SheetTrigger = RD.Trigger;
export const SheetClose = RD.Close;
export const SheetTitle = DialogTitle;
export const SheetDescription = DialogDescription;
export function SheetContent({ className, side = "left", ...props }) {
  return _jsx(DialogContent, {
    ...props,
    className: cn("gdg-sheet", `gdg-sheet-${side}`, className),
  });
}
