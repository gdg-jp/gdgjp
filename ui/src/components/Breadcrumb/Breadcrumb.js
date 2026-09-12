import { jsx as _jsx } from "react/jsx-runtime";
export function Breadcrumb({ children, ...props }) {
  return _jsx("nav", {
    "aria-label": "\u30D1\u30F3\u304F\u305A",
    ...props,
    children: _jsx("ol", { className: "gdg-breadcrumb", children: children }),
  });
}
