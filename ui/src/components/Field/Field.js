import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
export function FieldSet({ className, ...props }) {
  return _jsx("fieldset", { ...props, className: cn("gdg-field-set", className) });
}
export function FieldLegend({ variant = "legend", className, ...props }) {
  return _jsx("legend", {
    ...props,
    "data-variant": variant,
    className: cn("gdg-field-legend", className),
  });
}
export function FieldGroup({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-field-group", className) });
}
export function Field({ className, ...props }) {
  return _jsx("div", {
    ...props,
    role: props.role ?? "group",
    className: cn("gdg-field-primitive", className),
  });
}
export function FieldContent({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-field-content", className) });
}
export function FieldLabel({ className, ...props }) {
  return _jsx("label", {
    ...props,
    htmlFor: props.htmlFor,
    className: cn("gdg-field-label", className),
  });
}
export function FieldTitle({ className, ...props }) {
  return _jsx("div", { ...props, className: cn("gdg-field-title", className) });
}
export function FieldDescription({ className, ...props }) {
  return _jsx("p", { ...props, className: cn("gdg-field-description", className) });
}
export function FieldSeparator({ className, children, ...props }) {
  return _jsx("div", {
    ...props,
    className: cn("gdg-field-separator", className),
    children: children && _jsx("span", { children: children }),
  });
}
export function FieldError({ errors, issues, children, className, ...props }) {
  const messages = [...(errors ?? []), ...(issues ?? [])]
    .map((error) => error?.message)
    .filter(Boolean);
  return _jsx("p", {
    ...props,
    role: "alert",
    className: cn("gdg-field-error", className),
    children:
      messages.length > 1
        ? _jsx("ul", {
            children: messages.map((message) => _jsx("li", { children: message }, String(message))),
          })
        : (messages[0] ?? children),
  });
}
