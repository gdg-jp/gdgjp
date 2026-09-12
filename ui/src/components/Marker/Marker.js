import { cloneElement, isValidElement } from "react";
import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
export function Marker({ variant = "default", render, className, children, ...props }) {
  const classNames = cn("gdg-marker", `gdg-marker-${variant}`, className);
  if (render && isValidElement(render)) {
    return cloneElement(render, {
      ...props,
      className: cn(classNames, render.props.className),
    });
  }
  return _jsx("div", { ...props, className: classNames, children: children });
}
export function MarkerIcon({ className, ...props }) {
  return _jsx("span", {
    ...props,
    "aria-hidden": "true",
    className: cn("gdg-marker-icon", className),
  });
}
export function MarkerContent({ className, ...props }) {
  return _jsx("span", { ...props, className: cn("gdg-marker-content", className) });
}
