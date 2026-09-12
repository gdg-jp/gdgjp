import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
import { useField } from "../FormField/field-context";
export function Textarea({ className, ...props }) {
  const field = useField(props);
  return _jsx("textarea", {
    ...props,
    ...field,
    className: cn("gdg-input", "gdg-textarea", className),
  });
}
