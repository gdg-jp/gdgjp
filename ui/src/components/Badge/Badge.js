import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
export function Badge({ className, tone = "neutral", ...props }) {
  return _jsx("span", { ...props, className: cn("gdg-badge", `gdg-tone-${tone}`, className) });
}
