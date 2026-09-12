import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Heading } from "../Heading";
export function PageHeader({ title, description, actions }) {
  return _jsxs("header", {
    className: "gdg-page-header",
    children: [
      _jsxs("div", {
        children: [
          _jsx(Heading, { level: 1, children: title }),
          description && _jsx("p", { className: "gdg-muted", children: description }),
        ],
      }),
      actions && _jsx("div", { className: "gdg-inline", children: actions }),
    ],
  });
}
