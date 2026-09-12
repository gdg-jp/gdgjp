import { CalendarDays, Settings, Users } from "lucide-react";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AppShell } from "./AppShell";
const navigation = _jsxs("nav", {
  className: "gdg-sidebar-nav",
  "aria-label": "\u30E1\u30A4\u30F3",
  children: [
    _jsxs("a", {
      href: "#events",
      "aria-current": "page",
      children: [_jsx(CalendarDays, { size: 18 }), "\u30A4\u30D9\u30F3\u30C8"],
    }),
    _jsxs("a", {
      href: "#members",
      children: [_jsx(Users, { size: 18 }), "\u30E1\u30F3\u30D0\u30FC"],
    }),
    _jsxs("a", { href: "#settings", children: [_jsx(Settings, { size: 18 }), "\u8A2D\u5B9A"] }),
  ],
});
const meta = {
  title: "Components/AppShell",
  component: AppShell,
  parameters: { layout: "fullscreen" },
  args: {
    brand: "GDG Apps",
    navigation,
    header: _jsx("span", {
      className: "gdg-muted",
      children: "\u30B3\u30DF\u30E5\u30CB\u30C6\u30A3\u7BA1\u7406",
    }),
    children: _jsxs("div", {
      className: "gdg-stack",
      children: [
        _jsx("h1", { className: "gdg-heading", children: "\u30A4\u30D9\u30F3\u30C8" }),
        _jsx("p", {
          className: "gdg-text",
          children:
            "\u30B3\u30DF\u30E5\u30CB\u30C6\u30A3\u306E\u6B21\u306E\u4E00\u6B69\u3092\u3001\u3053\u3053\u304B\u3089\u3002",
        }),
      ],
    }),
  },
};
export default meta;
export const Default = {};
