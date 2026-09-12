import { Check, Minus } from "lucide-react";
import { Checkbox as RC } from "radix-ui";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from "../../utils";
import { useField } from "../FormField/field-context";
export function Checkbox({ className, ...props }) {
  const field = useField(props);
  return _jsx(RC.Root, {
    ...props,
    ...field,
    className: cn("gdg-checkbox", className),
    children: _jsxs(RC.Indicator, {
      forceMount: true,
      className: "gdg-checkbox-indicator",
      children: [
        _jsx(Check, { size: 14, className: "gdg-check-mark" }),
        _jsx(Minus, { size: 14, className: "gdg-check-mixed" }),
      ],
    }),
  });
}
