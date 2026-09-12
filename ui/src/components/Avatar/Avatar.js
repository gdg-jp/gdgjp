import { Avatar as RAvatar } from "radix-ui";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from "../../utils";
export function Avatar({ src, alt, fallback, className, ...props }) {
  return _jsxs(RAvatar.Root, {
    ...props,
    className: cn("gdg-avatar", className),
    children: [
      _jsx(RAvatar.Image, { src: src, alt: alt }),
      _jsx(RAvatar.Fallback, { role: "img", "aria-label": alt, children: fallback }),
    ],
  });
}
