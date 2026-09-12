import { Label as RLabel } from "radix-ui";
import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
export function Label({ className, ...props }) {
  return _jsx(RLabel.Root, { ...props, className: cn("gdg-label", className) });
}
