import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
export function Item({ variant = "default", size = "default", className, ...props }) {
  return _jsx("div", {
    ...props,
    "data-variant": variant,
    "data-size": size,
    className: cn("gdg-item", className),
  });
}
export function ItemGroup({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-item-group", className) });
}
export function ItemMedia({ variant = "icon", className, ...props }) {
  return _jsx("div", {
    ...props,
    "data-variant": variant,
    className: cn("gdg-item-media", className),
  });
}
export function ItemContent({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-item-content", className) });
}
export function ItemTitle({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-item-title", className) });
}
export function ItemDescription({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-item-description", className) });
}
export function ItemActions({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-item-actions", className) });
}
export function ItemHeader({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-item-header", className) });
}
export function ItemFooter({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-item-footer", className) });
}
export function ItemSeparator({ className, ...props }) {
  return _jsx("hr", { ...props, className: cn("gdg-item-separator", className) });
}
