import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
export function Empty({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-empty-component", className) });
}
export function EmptyHeader({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-empty-header", className) });
}
export function EmptyMedia({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-empty-media", className) });
}
export function EmptyTitle({ className, ...props }) {
  return _jsx("h3", { ...props, className: cn("gdg-empty-title", className) });
}
export function EmptyDescription({ className, ...props }) {
  return _jsx("p", { ...props, className: cn("gdg-empty-description", className) });
}
export function EmptyContent({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-empty-content", className) });
}
