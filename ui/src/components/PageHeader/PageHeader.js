import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from "../../utils";
import { Heading } from "../Heading";
export function PageHeader({ title, description, actions, back, className }) {
  const header = _jsxs("header", {
    className: cn("gdg-page-header", className),
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
  if (back) {
    return _jsxs("div", { className: "gdg-page-header-with-back", children: [back, header] });
  }
  return header;
}
