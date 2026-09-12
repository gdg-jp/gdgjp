import { Dialog as RDialog } from "radix-ui";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMotionRef } from "../../hooks";
import { cn } from "../../utils";
export const Drawer = RDialog.Root;
export const DrawerTrigger = RDialog.Trigger;
export const DrawerClose = RDialog.Close;
export const DrawerPortal = RDialog.Portal;
export function DrawerOverlay({ className, ...props }) {
  return _jsx(RDialog.Overlay, { ...props, className: cn("gdg-overlay", className) });
}
export function DrawerContent({ ref, className, children, ...props }) {
  const motionRef = useMotionRef(ref);
  return _jsxs(RDialog.Portal, {
    children: [
      _jsx(DrawerOverlay, {}),
      _jsxs(RDialog.Content, {
        ref: motionRef,
        ...props,
        className: cn("gdg-drawer", className),
        children: [
          _jsx("div", { className: "gdg-drawer-handle", "aria-hidden": "true" }),
          children,
        ],
      }),
    ],
  });
}
export function DrawerHeader({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-drawer-header", className) });
}
export function DrawerFooter({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-drawer-footer", className) });
}
export function DrawerTitle({ className, ...props }) {
  return _jsx(RDialog.Title, { ...props, className: cn("gdg-heading", className) });
}
export function DrawerDescription({ className, ...props }) {
  return _jsx(RDialog.Description, { ...props, className: cn("gdg-text", "gdg-muted", className) });
}
export function DrawerHandle({ className, ...props }) {
  return _jsx("div", {
    ...props,
    "aria-hidden": "true",
    className: cn("gdg-drawer-handle", className),
  });
}
