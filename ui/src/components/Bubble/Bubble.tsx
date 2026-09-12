import type { ComponentProps } from "react";
import { cn } from "../../utils";

export type BubbleVariant =
  | "default"
  | "secondary"
  | "muted"
  | "tinted"
  | "outline"
  | "ghost"
  | "destructive";

export function Bubble({
  variant = "default",
  align = "start",
  className,
  ...props
}: ComponentProps<"div"> & { variant?: BubbleVariant; align?: "start" | "end" }) {
  return (
    <div
      {...props}
      data-variant={variant}
      data-align={align}
      className={cn("gdg-bubble", className)}
    />
  );
}

export function BubbleContent({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-bubble-content", className)} />;
}

export function BubbleReactions({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-bubble-reactions", className)} />;
}

export function BubbleGroup({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-bubble-group", className)} />;
}
