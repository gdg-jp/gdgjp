import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from "../../utils";
export function Alert({ tone = "info", title, children, className, ...props }) {
  const Icon =
    tone === "danger"
      ? CircleAlert
      : tone === "warning"
        ? TriangleAlert
        : tone === "success"
          ? CircleCheck
          : Info;
  return _jsxs("div", {
    role: tone === "danger" ? "alert" : "status",
    ...props,
    className: cn("gdg-alert", `gdg-tone-${tone}`, className),
    children: [
      _jsx(Icon, { size: 20, "aria-hidden": "true" }),
      _jsxs("div", {
        children: [
          _jsx("strong", { children: title }),
          children && _jsx("div", { children: children }),
        ],
      }),
    ],
  });
}
