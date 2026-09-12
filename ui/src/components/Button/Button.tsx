import { type VariantProps, cva } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import { Slot } from "radix-ui";
import { type ComponentProps, type ReactElement, cloneElement, isValidElement } from "react";
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

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean; loading?: boolean };

export function Button({
  className,
  variant,
  size,
  asChild,
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
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  const unavailable = disabled || loading;
  const child =
    asChild && isValidElement(children)
      ? cloneElement(children as ReactElement<ComponentProps<"button">>, {
          onClick: (event) => {
            if (unavailable) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            (children.props as ComponentProps<"button">).onClick?.(event);
          },
          onClickCapture: (event) => {
            if (unavailable) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            (children.props as ComponentProps<"button">).onClickCapture?.(event);
          },
          ...(unavailable ? { "aria-disabled": true, tabIndex: -1 } : {}),
        })
      : children;
  return (
    <Comp
      {...props}
      {...(!asChild
        ? { type, disabled: unavailable }
        : {
            "aria-disabled": unavailable || undefined,
            tabIndex: unavailable ? -1 : props.tabIndex,
          })}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      onClick={(event) => {
        if (unavailable) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onClick?.(event);
      }}
      onPointerDown={(e) => {
        onPointerDown?.(e);
        if (!e.defaultPrevented && !unavailable && e.button === 0)
          e.currentTarget.dataset.pressed = "true";
      }}
      onPointerUp={(e) => {
        delete e.currentTarget.dataset.pressed;
        onPointerUp?.(e);
      }}
      onPointerCancel={(e) => {
        delete e.currentTarget.dataset.pressed;
        onPointerCancel?.(e);
      }}
      onPointerLeave={(e) => {
        delete e.currentTarget.dataset.pressed;
        onPointerLeave?.(e);
      }}
    >
      {asChild ? (
        child
      ) : (
        <>
          {loading && <LoaderCircle className="gdg-spinner" aria-hidden="true" />}
          {children}
        </>
      )}
    </Comp>
  );
}
