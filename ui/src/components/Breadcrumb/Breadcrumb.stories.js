import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link } from "../Link";
import { Breadcrumb } from "./Breadcrumb";
const meta = {
  title: "Components/Breadcrumb",
  component: Breadcrumb,
  parameters: { layout: "centered" },
};
export default meta;
export const Default = {
  render: () =>
    _jsxs(Breadcrumb, {
      children: [
        _jsx("li", { children: _jsx(Link, { href: "#home", children: "\u30DB\u30FC\u30E0" }) }),
        _jsx("li", {
          children: _jsx(Link, { href: "#events", children: "\u30A4\u30D9\u30F3\u30C8" }),
        }),
        _jsx("li", { "aria-current": "page", children: "GDG Apps \u306E\u7D39\u4ECB" }),
      ],
    }),
};
