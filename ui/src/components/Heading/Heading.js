import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
export function Heading({ level = 2, className, ...props }) {
  const Tag = `h${level}`;
  return _jsx(Tag, { ...props, className: cn("gdg-heading", className) });
}
