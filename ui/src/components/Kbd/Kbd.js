import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
export function Kbd({ className, ...props }) {
  return _jsx("kbd", { ...props, className: cn("gdg-kbd", className) });
}
export function KbdGroup({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-kbd-group", className) });
}
