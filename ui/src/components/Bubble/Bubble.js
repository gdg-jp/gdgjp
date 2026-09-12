import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
export function Bubble({ variant = "default", align = "start", className, ...props }) {
  return _jsx("div", {
    ...props,
    "data-variant": variant,
    "data-align": align,
    className: cn("gdg-bubble", className),
  });
}
export function BubbleContent({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-bubble-content", className) });
}
export function BubbleReactions({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-bubble-reactions", className) });
}
export function BubbleGroup({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-bubble-group", className) });
}
