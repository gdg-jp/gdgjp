import { cva } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import { Slot } from "radix-ui";
import { cloneElement, isValidElement } from "react";
import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from "../../utils";
const buttonVariants = cva("gdg-button", {
  variants: {
    variant: {
      primary: "gdg-button-primary",
      secondary: "gdg-button-secondary",
      outline: "gdg-button-outline",
      ghost: "gdg-button-ghost",
      danger: "gdg-button-danger",
    },
    size: { sm: "gdg-size-sm", md: "gdg-size-md", lg: "gdg-size-lg" },
  },
  defaultVariants: { variant: "primary", size: "md" },
});
export function Button({
  className,
  variant,
  size,
  asChild,
  fullWidth,
  loading,
  disabled,
  children,
  type = "button",
  onClick,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
  ...props
}) {
  const Comp = asChild ? Slot.Root : "button";
  const unavailable = disabled || loading;
  const child =
    asChild && isValidElement(children)
      ? cloneElement(children, {
          onClick: (event) => {
            if (unavailable) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            children.props.onClick?.(event);
          },
          onClickCapture: (event) => {
            if (unavailable) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            children.props.onClickCapture?.(event);
          },
          ...(unavailable ? { "aria-disabled": true, tabIndex: -1 } : {}),
        })
      : children;
  return _jsx(Comp, {
    ...props,
    ...(!asChild
      ? { type, disabled: unavailable }
      : {
          "aria-disabled": unavailable || undefined,
          tabIndex: unavailable ? -1 : props.tabIndex,
        }),
    "aria-busy": loading || undefined,
    className: cn(buttonVariants({ variant, size }), fullWidth && "gdg-button-block", className),
    onClick: (event) => {
      if (unavailable) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      onClick?.(event);
    },
    onPointerDown: (e) => {
      onPointerDown?.(e);
      if (!e.defaultPrevented && !unavailable && e.button === 0)
        e.currentTarget.dataset.pressed = "true";
    },
    onPointerUp: (e) => {
      delete e.currentTarget.dataset.pressed;
      onPointerUp?.(e);
    },
    onPointerCancel: (e) => {
      delete e.currentTarget.dataset.pressed;
      onPointerCancel?.(e);
    },
    onPointerLeave: (e) => {
      delete e.currentTarget.dataset.pressed;
      onPointerLeave?.(e);
    },
    children: asChild
      ? child
      : _jsxs(_Fragment, {
          children: [
            loading && _jsx(LoaderCircle, { className: "gdg-spinner", "aria-hidden": "true" }),
            children,
          ],
        }),
  });
}
