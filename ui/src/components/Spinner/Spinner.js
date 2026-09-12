import { LoaderCircle } from "lucide-react";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from "../../utils";
export function Spinner({ label = "読み込み中", className, ...props }) {
  return _jsxs("output", {
    ...props,
    className: cn("gdg-inline", className),
    children: [
      _jsx(LoaderCircle, { className: "gdg-spinner", "aria-hidden": "true" }),
      _jsx("span", { className: "gdg-sr-only", children: label }),
    ],
  });
}
