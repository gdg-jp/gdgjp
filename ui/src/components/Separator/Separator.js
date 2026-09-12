import { Separator as RSeparator } from "radix-ui";
import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
export function Separator({ className, ...props }) {
  return _jsx(RSeparator.Root, { ...props, className: cn("gdg-separator", className) });
}
