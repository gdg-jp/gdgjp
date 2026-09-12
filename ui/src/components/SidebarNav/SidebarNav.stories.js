import { CalendarDays, Link2, Settings } from "lucide-react";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { SidebarNav } from "./SidebarNav";
const meta = {
  title: "Components/SidebarNav",
  component: SidebarNav,
  parameters: { layout: "centered" },
};
export default meta;
export const Default = {
  render: () =>
    _jsxs(SidebarNav, {
      "aria-label": "\u30E1\u30A4\u30F3\u30CA\u30D3\u30B2\u30FC\u30B7\u30E7\u30F3",
      children: [
        _jsxs("a", {
          href: "#events",
          "aria-current": "page",
          children: [_jsx(CalendarDays, { size: 18 }), "\u30A4\u30D9\u30F3\u30C8"],
        }),
        _jsxs("a", { href: "#links", children: [_jsx(Link2, { size: 18 }), "\u30EA\u30F3\u30AF"] }),
        _jsxs("a", { href: "#settings", children: [_jsx(Settings, { size: 18 }), "\u8A2D\u5B9A"] }),
      ],
    }),
};
