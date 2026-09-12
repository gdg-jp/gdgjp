import { useId } from "react";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from "../../utils";
import { FieldContext } from "./field-context";
export function FormField({
  id: suppliedId,
  label,
  description,
  error,
  required,
  disabled,
  children,
  className,
}) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  return _jsx(FieldContext.Provider, {
    value: {
      id,
      description:
        [description && `${id}-help`, error && `${id}-error`].filter(Boolean).join(" ") ||
        undefined,
      invalid: !!error,
      required,
      disabled,
    },
    children: _jsxs("div", {
      className: cn("gdg-field", className),
      children: [
        _jsxs("label", {
          id: `${id}-label`,
          htmlFor: id,
          children: [label, required && _jsx("span", { "aria-hidden": "true", children: " *" })],
        }),
        children,
        description &&
          _jsx("p", { id: `${id}-help`, className: "gdg-field-help", children: description }),
        error && _jsx("p", { id: `${id}-error`, className: "gdg-field-error", children: error }),
      ],
    }),
  });
}
