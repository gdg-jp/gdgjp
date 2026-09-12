import type { ComponentProps } from "react";
import { cn } from "../../utils";

export function Message({
  align = "start",
  className,
  ...props
}: ComponentProps<"div"> & { align?: "start" | "end" }) {
  return <div {...props} data-align={align} className={cn("gdg-message", className)} />;
}

export function MessageGroup({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-message-group", className)} />;
}

export function MessageAvatar({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-message-avatar", className)} />;
}

export function MessageContent({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-message-content", className)} />;
}

export function MessageHeader({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-message-header", className)} />;
}

export function MessageFooter({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-message-footer", className)} />;
}
