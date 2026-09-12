import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
export function Message({ align = "start", className, ...props }) {
  return _jsx("div", { ...props, "data-align": align, className: cn("gdg-message", className) });
}
export function MessageGroup({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-message-group", className) });
}
export function MessageAvatar({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-message-avatar", className) });
}
export function MessageContent({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-message-content", className) });
}
export function MessageHeader({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-message-header", className) });
}
export function MessageFooter({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-message-footer", className) });
}
