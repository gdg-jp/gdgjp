import { Toast as RToast } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../utils";

export const ToastProvider = RToast.Provider;

export function ToastViewport({ className, ...props }: ComponentProps<typeof RToast.Viewport>) {
  return <RToast.Viewport {...props} className={cn("gdg-toast-viewport", className)} />;
}

export function Toast({ className, ...props }: ComponentProps<typeof RToast.Root>) {
  return <RToast.Root {...props} className={cn("gdg-toast-root", className)} />;
}

export function ToastTitle({ className, ...props }: ComponentProps<typeof RToast.Title>) {
  return <RToast.Title {...props} className={cn("gdg-toast-title", className)} />;
}

export function ToastDescription({
  className,
  ...props
}: ComponentProps<typeof RToast.Description>) {
  return <RToast.Description {...props} className={cn("gdg-toast-description", className)} />;
}

export function ToastAction({ className, ...props }: ComponentProps<typeof RToast.Action>) {
  return <RToast.Action {...props} className={cn("gdg-toast-action", className)} />;
}

export function ToastClose({ className, ...props }: ComponentProps<typeof RToast.Close>) {
  return <RToast.Close {...props} className={cn("gdg-toast-close", className)} />;
}
