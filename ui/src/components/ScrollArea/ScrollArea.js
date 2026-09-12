import { ScrollArea as RScrollArea } from "radix-ui";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from "../../utils";
export function ScrollArea({ className, children, ...props }) {
  return _jsxs(RScrollArea.Root, {
    ...props,
    className: cn("gdg-scroll-area", className),
    children: [
      _jsx(ScrollAreaViewport, { children: children }),
      _jsx(ScrollAreaScrollbar, { orientation: "vertical" }),
      _jsx(ScrollAreaScrollbar, { orientation: "horizontal" }),
      _jsx(ScrollAreaCorner, {}),
    ],
  });
}
export function ScrollAreaScrollbar({ className, ...props }) {
  return _jsx(RScrollArea.Scrollbar, {
    ...props,
    className: cn("gdg-scroll-area-scrollbar", className),
    children: _jsx(ScrollAreaThumb, {}),
  });
}
export function ScrollAreaViewport({ className, ...props }) {
  return _jsx(RScrollArea.Viewport, {
    ...props,
    className: cn("gdg-scroll-area-viewport", className),
  });
}
export function ScrollAreaThumb({ className, ...props }) {
  return _jsx(RScrollArea.Thumb, { ...props, className: cn("gdg-scroll-area-thumb", className) });
}
export function ScrollAreaCorner({ className, ...props }) {
  return _jsx(RScrollArea.Corner, { ...props, className: cn("gdg-scroll-area-corner", className) });
}
