import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
export function Table({ className, scrollLabel = "表を横にスクロール", ...props }) {
  return _jsx("section", {
    "aria-label": scrollLabel,
    tabIndex: 0,
    className: "gdg-table-scroll",
    children: _jsx("table", { ...props, className: cn("gdg-table", className) }),
  });
}
