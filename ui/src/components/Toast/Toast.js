import { Toast as RToast } from "radix-ui";
import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
export const ToastProvider = RToast.Provider;
export function ToastViewport({ className, ...props }) {
  return _jsx(RToast.Viewport, { ...props, className: cn("gdg-toast-viewport", className) });
}
export function Toast({ className, ...props }) {
  return _jsx(RToast.Root, { ...props, className: cn("gdg-toast-root", className) });
}
export function ToastTitle({ className, ...props }) {
  return _jsx(RToast.Title, { ...props, className: cn("gdg-toast-title", className) });
}
export function ToastDescription({ className, ...props }) {
  return _jsx(RToast.Description, { ...props, className: cn("gdg-toast-description", className) });
}
export function ToastAction({ className, ...props }) {
  return _jsx(RToast.Action, { ...props, className: cn("gdg-toast-action", className) });
}
export function ToastClose({ className, ...props }) {
  return _jsx(RToast.Close, { ...props, className: cn("gdg-toast-close", className) });
}
