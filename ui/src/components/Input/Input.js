import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
import { useField } from "../FormField/field-context";
export function Input({ className, ...props }) {
  const field = useField(props);
  return _jsx("input", { ...props, ...field, className: cn("gdg-input", className) });
}
