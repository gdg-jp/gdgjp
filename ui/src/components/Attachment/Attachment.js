import { X } from "lucide-react";
import { cloneElement, isValidElement } from "react";
import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
import { Button } from "../Button";
export function Attachment({
  state = "done",
  size = "default",
  orientation = "horizontal",
  className,
  ...props
}) {
  return _jsx("div", {
    ...props,
    "data-state": state,
    "data-size": size,
    "data-orientation": orientation,
    "aria-busy": state === "uploading" || state === "processing" || undefined,
    className: cn("gdg-attachment", className),
  });
}
export function AttachmentMedia({ variant = "icon", className, ...props }) {
  return _jsx("div", {
    ...props,
    "data-variant": variant,
    className: cn("gdg-attachment-media", className),
  });
}
export function AttachmentContent({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-attachment-content", className) });
}
export function AttachmentTitle({ className, ...props }) {
  return _jsx("strong", { ...props, className: cn("gdg-attachment-title", className) });
}
export function AttachmentDescription({ className, ...props }) {
  return _jsx("span", { ...props, className: cn("gdg-attachment-description", className) });
}
export function AttachmentActions({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-attachment-actions", className) });
}
export function AttachmentAction({ className, children, ...props }) {
  return _jsx(Button, {
    ...props,
    size: props.size ?? "sm",
    variant: props.variant ?? "ghost",
    className: cn("gdg-attachment-action", className),
    children: children ?? _jsx(X, { size: 16, "aria-hidden": "true" }),
  });
}
export function AttachmentTrigger({ render, className, ...props }) {
  if (render && isValidElement(render)) {
    return cloneElement(render, {
      ...props,
      className: cn("gdg-attachment-trigger", render.props.className, className),
    });
  }
  return _jsx("button", {
    ...props,
    type: props.type ?? "button",
    className: cn("gdg-attachment-trigger", className),
  });
}
export function AttachmentGroup({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-attachment-group", className) });
}
