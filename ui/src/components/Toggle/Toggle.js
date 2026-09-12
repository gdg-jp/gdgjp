import { Toggle as RToggle } from "radix-ui";
import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
export function Toggle({ className, ...props }) {
  return _jsx(RToggle.Root, { ...props, className: cn("gdg-toggle", className) });
}
