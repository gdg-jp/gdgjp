import { ToggleGroup as RToggleGroup } from "radix-ui";
import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
export function ToggleGroup({ className, ...props }) {
  return _jsx(RToggleGroup.Root, { ...props, className: cn("gdg-toggle-group", className) });
}
export function ToggleGroupItem({ className, ...props }) {
  return _jsx(RToggleGroup.Item, { ...props, className: cn("gdg-toggle-group-item", className) });
}
