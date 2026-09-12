import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
export function Inline({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-inline", className) });
}
