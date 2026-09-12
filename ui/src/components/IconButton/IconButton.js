import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
import { Button } from "../Button";
export function IconButton({ "aria-label": label, className, ...props }) {
  return _jsx(Button, {
    ...props,
    "aria-label": label,
    className: cn("gdg-icon-button", className),
  });
}
