import { Switch as RS } from "radix-ui";
import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
import { useField } from "../FormField/field-context";
export function Switch({ className, ...props }) {
  const field = useField(props);
  return _jsx(RS.Root, {
    ...props,
    ...field,
    className: cn("gdg-switch", className),
    children: _jsx(RS.Thumb, { className: "gdg-switch-thumb" }),
  });
}
