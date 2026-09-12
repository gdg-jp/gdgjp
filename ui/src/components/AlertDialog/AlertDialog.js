import { AlertDialog as RA } from "radix-ui";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMotionRef } from "../../hooks";
import { cn } from "../../utils";
export const AlertDialog = RA.Root;
export const AlertDialogTrigger = RA.Trigger;
export const AlertDialogAction = RA.Action;
export const AlertDialogCancel = RA.Cancel;
export const AlertDialogTitle = RA.Title;
export const AlertDialogDescription = RA.Description;
export function AlertDialogContent({ ref, className, ...props }) {
  const motionRef = useMotionRef(ref);
  return _jsxs(RA.Portal, {
    children: [
      _jsx(RA.Overlay, { className: "gdg-overlay" }),
      _jsx(RA.Content, { ref: motionRef, ...props, className: cn("gdg-dialog", className) }),
    ],
  });
}
