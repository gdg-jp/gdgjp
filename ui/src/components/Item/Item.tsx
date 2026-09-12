import type { ComponentProps } from "react";
import { cn } from "../../utils";

export function Item({
  variant = "default",
  size = "default",
  className,
  ...props
}: ComponentProps<"div"> & { variant?: "default" | "outline" | "muted"; size?: "default" | "sm" }) {
  return (
    <div {...props} data-variant={variant} data-size={size} className={cn("gdg-item", className)} />
  );
}

export function ItemGroup({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-item-group", className)} />;
}

export function ItemMedia({
  variant = "icon",
  className,
  ...props
}: ComponentProps<"div"> & { variant?: "icon" | "avatar" | "image" }) {
  return <div {...props} data-variant={variant} className={cn("gdg-item-media", className)} />;
}

export function ItemContent({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-item-content", className)} />;
}

export function ItemTitle({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-item-title", className)} />;
}

export function ItemDescription({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-item-description", className)} />;
}

export function ItemActions({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-item-actions", className)} />;
}

export function ItemHeader({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-item-header", className)} />;
}

export function ItemFooter({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-item-footer", className)} />;
}

export function ItemSeparator({ className, ...props }: ComponentProps<"hr">) {
  return <hr {...props} className={cn("gdg-item-separator", className)} />;
}
