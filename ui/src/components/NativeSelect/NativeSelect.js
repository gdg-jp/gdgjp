import { ChevronDown } from "lucide-react";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from "../../utils";
import { useField } from "../FormField/field-context";
export function NativeSelect({ className, children, ...props }) {
  const field = useField(props);
  return _jsxs("div", {
    className: "gdg-native-select-wrap",
    children: [
      _jsx("select", {
        ...props,
        ...field,
        className: cn("gdg-input", "gdg-native-select", className),
        children: children,
      }),
      _jsx(ChevronDown, { className: "gdg-native-select-icon", size: 16, "aria-hidden": "true" }),
    ],
  });
}
export function NativeSelectOption({ className, ...props }) {
  return _jsx("option", { ...props, className: className });
}
export function NativeSelectOptGroup({ className, ...props }) {
  return _jsx("optgroup", { ...props, className: className });
}
