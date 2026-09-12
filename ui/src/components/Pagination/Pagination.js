import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from "../Button";
export function Pagination({ page, pageCount, onPageChange, label = "ページ切替" }) {
  return _jsxs("nav", {
    className: "gdg-inline",
    "aria-label": label,
    children: [
      _jsx(Button, {
        variant: "outline",
        disabled: page <= 1,
        onClick: () => onPageChange(page - 1),
        children: "\u524D\u3078",
      }),
      _jsxs("span", {
        "aria-live": "polite",
        children: [pageCount === 0 ? 0 : page, " / ", pageCount],
      }),
      _jsx(Button, {
        variant: "outline",
        disabled: page >= pageCount,
        onClick: () => onPageChange(page + 1),
        children: "\u6B21\u3078",
      }),
    ],
  });
}
