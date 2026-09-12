import { X } from "lucide-react";
import { Dialog as RD } from "radix-ui";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMotionRef } from "../../hooks";
import { cn } from "../../utils";
import { IconButton } from "../IconButton";
export const Dialog = RD.Root;
export const DialogTrigger = RD.Trigger;
export const DialogClose = RD.Close;
export function DialogTitle({ className, ...props }) {
  return _jsx(RD.Title, { ...props, className: cn("gdg-heading", className) });
}
export function DialogDescription({ className, ...props }) {
  return _jsx(RD.Description, { ...props, className: cn("gdg-text gdg-muted", className) });
}
export function DialogContent({ ref, className, children, closeLabel = "閉じる", ...props }) {
  const motionRef = useMotionRef(ref);
  return _jsxs(RD.Portal, {
    children: [
      _jsx(RD.Overlay, { className: "gdg-overlay" }),
      _jsxs(RD.Content, {
        ref: motionRef,
        ...props,
        className: cn("gdg-dialog", className),
        children: [
          children,
          _jsx(RD.Close, {
            asChild: true,
            children: _jsx(IconButton, {
              "aria-label": closeLabel,
              variant: "ghost",
              className: "gdg-dialog-close",
              children: _jsx(X, { size: 18 }),
            }),
          }),
        ],
      }),
    ],
  });
}
