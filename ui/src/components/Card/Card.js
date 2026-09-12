import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
export function Card({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-card", className) });
}
