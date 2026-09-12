import { Slot } from "radix-ui";
import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
export function Link({ className, asChild, ...props }) {
  const Comp = asChild ? Slot.Root : "a";
  return _jsx(Comp, { ...props, className: cn("gdg-link", className) });
}
