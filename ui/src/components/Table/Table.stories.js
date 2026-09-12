import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Badge } from "../Badge";
import { Link } from "../Link";
import { Table } from "./Table";
const meta = {
  title: "Components/Table",
  component: Table,
  parameters: { layout: "centered" },
};
export default meta;
export const Default = {
  render: () =>
    _jsxs(Table, {
      children: [
        _jsx("caption", { children: "\u958B\u50AC\u4E88\u5B9A\u306E\u30A4\u30D9\u30F3\u30C8" }),
        _jsx("thead", {
          children: _jsxs("tr", {
            children: [
              _jsx("th", { scope: "col", children: "\u30A4\u30D9\u30F3\u30C8\u540D" }),
              _jsx("th", { scope: "col", children: "\u958B\u50AC\u65E5" }),
              _jsx("th", { scope: "col", children: "\u72B6\u614B" }),
            ],
          }),
        }),
        _jsxs("tbody", {
          children: [
            _jsxs("tr", {
              children: [
                _jsx("td", {
                  children: _jsx(Link, { href: "#meetup", children: "GDG Apps Meetup" }),
                }),
                _jsx("td", { children: "2026/09/26" }),
                _jsx("td", {
                  children: _jsx(Badge, { tone: "success", children: "\u516C\u958B\u4E2D" }),
                }),
              ],
            }),
            _jsxs("tr", {
              children: [
                _jsx("td", {
                  children: _jsx(Link, { href: "#workshop", children: "Cloud Workshop" }),
                }),
                _jsx("td", { children: "2026/10/10" }),
                _jsx("td", { children: _jsx(Badge, { children: "\u4E0B\u66F8\u304D" }) }),
              ],
            }),
          ],
        }),
      ],
    }),
};
