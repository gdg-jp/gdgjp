import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
export function ButtonGroup({ orientation = "horizontal", className, ...props }) {
  return _jsx("div", {
    ...props,
    role: props.role ?? "group",
    "data-orientation": orientation,
    className: cn("gdg-button-group", className),
  });
}
export function ButtonGroupSeparator({ orientation = "vertical", className, ...props }) {
  return _jsx("hr", {
    ...props,
    "aria-orientation": orientation,
    "data-orientation": orientation,
    className: cn("gdg-button-group-separator", className),
  });
}
export function ButtonGroupText({ className, ...props }) {
  return _jsx("span", { ...props, className: cn("gdg-button-group-text", className) });
}
