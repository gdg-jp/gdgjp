import { Tabs as RTabs } from "radix-ui";
import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
export const Tabs = RTabs.Root;
export function TabsList({ className, ...props }) {
  return _jsx(RTabs.List, { ...props, className: cn("gdg-tabs-list", className) });
}
export function TabsTrigger({ className, ...props }) {
  return _jsx(RTabs.Trigger, { ...props, className: cn("gdg-tabs-trigger", className) });
}
export function TabsContent({ className, ...props }) {
  return _jsx(RTabs.Content, { ...props, className: cn("gdg-tabs-content", className) });
}
