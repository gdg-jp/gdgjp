import { type VariantProps, cva } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";

import { cn } from "~/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,opacity,transform] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40",
        outline:
          "bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:hover:bg-input/50",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  type = "button",
  disabled,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";
  const pointerFeedback = asChild
    ? { onPointerDown, onPointerUp, onPointerCancel, onPointerLeave }
    : {
        onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
          if (!disabled && event.button === 0) event.currentTarget.dataset.pointerPressed = "true";
          onPointerDown?.(event);
        },
        onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
          delete event.currentTarget.dataset.pointerPressed;
          onPointerUp?.(event);
        },
        onPointerCancel: (event: React.PointerEvent<HTMLButtonElement>) => {
          delete event.currentTarget.dataset.pointerPressed;
          onPointerCancel?.(event);
        },
        onPointerLeave: (event: React.PointerEvent<HTMLButtonElement>) => {
          delete event.currentTarget.dataset.pointerPressed;
          onPointerLeave?.(event);
        },
      };

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(
        buttonVariants({ variant, size, className }),
        !asChild &&
          "duration-[var(--motion-duration-micro)] ease-[var(--motion-ease-out)] data-[pointer-pressed=true]:scale-[0.96] motion-reduce:duration-100 motion-reduce:data-[pointer-pressed=true]:scale-100",
      )}
      {...(!asChild ? { type } : {})}
      disabled={disabled}
      {...pointerFeedback}
      {...props}
    />
  );
}

export { Button, buttonVariants };
