import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
export function Skeleton({ className, ...props }) {
  return _jsx("div", { "aria-hidden": "true", ...props, className: cn("gdg-skeleton", className) });
}
