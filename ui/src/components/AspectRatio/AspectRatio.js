import { AspectRatio as RAspectRatio } from "radix-ui";
import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../../utils";
export function AspectRatio({ ratio = 16 / 9, className, ...props }) {
  return _jsx(RAspectRatio.Root, {
    ...props,
    ratio: ratio,
    className: cn("gdg-aspect-ratio", className),
  });
}
