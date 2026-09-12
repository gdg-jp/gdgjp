import { X } from "lucide-react";
import {
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  cloneElement,
  isValidElement,
} from "react";
import { cn } from "../../utils";
import { Button, type ButtonProps } from "../Button";

export type AttachmentState = "idle" | "uploading" | "processing" | "error" | "done";
export type AttachmentSize = "default" | "sm" | "xs";

export function Attachment({
  state = "done",
  size = "default",
  orientation = "horizontal",
  className,
  ...props
}: ComponentProps<"div"> & {
  state?: AttachmentState;
  size?: AttachmentSize;
  orientation?: "horizontal" | "vertical";
}) {
  return (
    <div
      {...props}
      data-state={state}
      data-size={size}
      data-orientation={orientation}
      aria-busy={state === "uploading" || state === "processing" || undefined}
      className={cn("gdg-attachment", className)}
    />
  );
}

export function AttachmentMedia({
  variant = "icon",
  className,
  ...props
}: ComponentProps<"div"> & { variant?: "icon" | "image" }) {
  return (
    <div {...props} data-variant={variant} className={cn("gdg-attachment-media", className)} />
  );
}

export function AttachmentContent({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-attachment-content", className)} />;
}

export function AttachmentTitle({ className, ...props }: ComponentProps<"strong">) {
  return <strong {...props} className={cn("gdg-attachment-title", className)} />;
}

export function AttachmentDescription({ className, ...props }: ComponentProps<"span">) {
  return <span {...props} className={cn("gdg-attachment-description", className)} />;
}

export function AttachmentActions({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-attachment-actions", className)} />;
}

export function AttachmentAction({ className, children, ...props }: ButtonProps) {
  return (
    <Button
      {...props}
      size={props.size ?? "sm"}
      variant={props.variant ?? "ghost"}
      className={cn("gdg-attachment-action", className)}
    >
      {children ?? <X size={16} aria-hidden="true" />}
    </Button>
  );
}

export function AttachmentTrigger({
  render,
  className,
  ...props
}: ComponentProps<"button"> & { render?: ReactElement<ComponentProps<"button">> }) {
  if (render && isValidElement(render)) {
    return cloneElement(render, {
      ...props,
      className: cn("gdg-attachment-trigger", render.props.className, className),
    });
  }
  return (
    <button
      {...props}
      type={props.type ?? "button"}
      className={cn("gdg-attachment-trigger", className)}
    />
  );
}

export function AttachmentGroup({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("gdg-attachment-group", className)} />;
}

export type AttachmentPartProps = { children?: ReactNode; className?: string };
