import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Heading } from "../Heading";
export function EmptyState({ title, description, action }) {
  return _jsxs("div", {
    className: "gdg-empty",
    children: [
      _jsx(Heading, { level: 2, children: title }),
      description && _jsx("p", { className: "gdg-muted", children: description }),
      action,
    ],
  });
}
