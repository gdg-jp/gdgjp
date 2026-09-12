import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
export function Stack({ align, className, ...props }) {
  return _jsx("div", { ...props, "data-align": align, className: cn("gdg-stack", className) });
}
