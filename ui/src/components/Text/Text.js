import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
export function Text({ className, tone = "default", size = "md", ...props }) {
  return _jsx("p", {
    ...props,
    className: cn("gdg-text", `gdg-text-${size}`, tone === "muted" && "gdg-muted", className),
  });
}
