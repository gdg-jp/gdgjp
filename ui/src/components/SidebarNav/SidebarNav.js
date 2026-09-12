import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
export function SidebarNav({ children, className, ...props }) {
  return _jsx("nav", { ...props, className: cn("gdg-sidebar-nav", className), children: children });
}
