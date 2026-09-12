import { AlertDialog as RA } from "radix-ui";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMotionRef } from "../../hooks";
import { cn } from "../../utils";
export const AlertDialog = RA.Root;
export const AlertDialogTrigger = RA.Trigger;
export const AlertDialogAction = RA.Action;
export const AlertDialogCancel = RA.Cancel;
export function AlertDialogTitle({ className, ...props }) {
  return _jsx(RA.Title, { ...props, className: cn("gdg-heading", className) });
}
export function AlertDialogDescription({ className, ...props }) {
  return _jsx(RA.Description, { ...props, className: cn("gdg-text gdg-muted", className) });
}
export function AlertDialogContent({ ref, className, ...props }) {
  const motionRef = useMotionRef(ref);
  return _jsxs(RA.Portal, {
    children: [
      _jsx(RA.Overlay, { className: "gdg-overlay" }),
      _jsx(RA.Content, { ref: motionRef, ...props, className: cn("gdg-dialog", className) }),
    ],
  });
}
