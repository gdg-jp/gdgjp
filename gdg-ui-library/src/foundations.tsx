import { type VariantProps, cva } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import { Avatar as RAvatar, Separator as RSeparator, Slot } from "radix-ui";
import {
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  cloneElement,
  isValidElement,
} from "react";
import { cn } from "./utils";

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
export function IconButton({
  "aria-label": label,
  className,
  ...props
}: ButtonProps & { "aria-label": string }) {
  return <Button {...props} aria-label={label} className={cn("gdg-icon-button", className)} />;
}
export function Link({
  className,
  asChild,
  ...props
}: ComponentProps<"a"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "a";
  return <Comp {...props} className={cn("gdg-link", className)} />;
}
export function Text({
  className,
  tone = "default",
  size = "md",
  ...props
}: ComponentProps<"p"> & { tone?: "default" | "muted"; size?: "xs" | "sm" | "md" }) {
  return (
    <p
      {...props}
      className={cn("gdg-text", `gdg-text-${size}`, tone === "muted" && "gdg-muted", className)}
    />
  );
}
export function Heading({
  level = 2,
  className,
  ...props
}: ComponentProps<"h2"> & { level?: 1 | 2 | 3 | 4 | 5 | 6 }) {
  const Tag = `h${level}` as "h2";
  return <Tag {...props} className={cn("gdg-heading", className)} />;
}
export function Stack({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-stack", className)} />;
}
export function Inline({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-inline", className)} />;
}
export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-card", className)} />;
}
export function Separator({ className, ...props }: ComponentProps<typeof RSeparator.Root>) {
  return <RSeparator.Root {...props} className={cn("gdg-separator", className)} />;
}
export type Tone = "neutral" | "info" | "success" | "warning" | "danger";
export function Badge({
  className,
  tone = "neutral",
  ...props
}: ComponentProps<"span"> & { tone?: Tone }) {
  return <span {...props} className={cn("gdg-badge", `gdg-tone-${tone}`, className)} />;
}
export function Avatar({
  src,
  alt,
  fallback,
  className,
  ...props
}: ComponentProps<typeof RAvatar.Root> & { src?: string; alt: string; fallback: ReactNode }) {
  return (
    <RAvatar.Root {...props} className={cn("gdg-avatar", className)}>
      <RAvatar.Image src={src} alt={alt} />
      <RAvatar.Fallback role="img" aria-label={alt}>
        {fallback}
      </RAvatar.Fallback>
    </RAvatar.Root>
  );
}
