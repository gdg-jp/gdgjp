import { Progress as RProgress } from "radix-ui";
import { createContext, useContext } from "react";
import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
const ProgressValueContext = createContext(undefined);
export function Progress({ className, value, ...props }) {
  return _jsx(ProgressValueContext.Provider, {
    value: value,
    children: _jsx(RProgress.Root, {
      ...props,
      value: value,
      "aria-label": props["aria-label"] ?? "進捗",
      className: cn("gdg-progress", className),
    }),
  });
}
export function ProgressIndicator({ className, style, ...props }) {
  const value = useContext(ProgressValueContext);
  const transform =
    value == null ? undefined : `translateX(-${100 - Math.min(100, Math.max(0, value))}%)`;
  return _jsx(RProgress.Indicator, {
    ...props,
    style: { transform, ...style },
    className: cn("gdg-progress-indicator", className),
  });
}
