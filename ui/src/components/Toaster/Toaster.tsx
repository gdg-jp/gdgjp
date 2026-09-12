import type { ComponentProps } from "react";
import { Toaster as Sonner, toast } from "sonner";
import { useTheme } from "../../themes";
import { cn } from "../../utils";

export { toast };

export function Toaster(props: ComponentProps<typeof Sonner>) {
  const { resolvedTheme } = useTheme();
  return (
    <Sonner
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      position="bottom-right"
      closeButton
      {...props}
      className={cn("gdg-toaster", props.className)}
      style={{
        zIndex: "var(--gdg-layer-toast)",
        fontFamily: "var(--gdg-font-sans)",
        ...props.style,
      }}
      toastOptions={{
        ...props.toastOptions,
        className: cn("gdg-toast", props.toastOptions?.className),
        style: {
          background: "var(--gdg-surface)",
          color: "var(--gdg-text)",
          border: "none",
          borderRadius: "var(--gdg-radius-md)",
          boxShadow: "var(--gdg-shadow-md)",
          fontFamily: "var(--gdg-font-sans)",
          transition: "var(--gdg-toast-transition)",
          ...props.toastOptions?.style,
        },
      }}
    />
  );
}
