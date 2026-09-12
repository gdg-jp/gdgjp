import { RadioGroup as RR } from "radix-ui";
import { useContext } from "react";
import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
import { FieldContext, useField } from "../FormField/field-context";
export function RadioGroup({ className, ...props }) {
  const field = useField(props);
  const context = useContext(FieldContext);
  return _jsx(RR.Root, {
    "aria-labelledby": context ? `${context.id}-label` : undefined,
    ...props,
    ...field,
    className: cn("gdg-stack", className),
  });
}
export function RadioGroupItem({ className, ...props }) {
  return _jsx(RR.Item, {
    ...props,
    className: cn("gdg-radio", className),
    children: _jsx(RR.Indicator, { forceMount: true, className: "gdg-radio-indicator" }),
  });
}
