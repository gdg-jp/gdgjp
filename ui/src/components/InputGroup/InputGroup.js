import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
import { Button } from "../Button";
import { Input } from "../Input";
import { Textarea } from "../Textarea";
export function InputGroup({ className, ...props }) {
  return _jsx("div", {
    ...props,
    role: props.role ?? "group",
    className: cn("gdg-input-group", className),
  });
}
export function InputGroupAddon({ align = "inline-start", className, ...props }) {
  return _jsx("div", {
    ...props,
    "data-align": align,
    className: cn("gdg-input-group-addon", className),
  });
}
export function InputGroupText({ className, ...props }) {
  return _jsx("span", { ...props, className: cn("gdg-input-group-text", className) });
}
export function InputGroupInput({ className, ...props }) {
  return _jsx(Input, { ...props, className: cn("gdg-input-group-input", className) });
}
export function InputGroupTextarea({ className, ...props }) {
  return _jsx(Textarea, { ...props, className: cn("gdg-input-group-textarea", className) });
}
export function InputGroupButton({ className, ...props }) {
  return _jsx(Button, {
    ...props,
    size: props.size ?? "sm",
    variant: props.variant ?? "ghost",
    className: cn("gdg-input-group-button", className),
  });
}
