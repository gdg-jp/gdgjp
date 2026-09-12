import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Badge } from "../Badge";
import { Card } from "./Card";
const meta = {
  title: "Components/Card",
  component: Card,
  parameters: { layout: "centered" },
};
export default meta;
export const Default = {
  render: () =>
    _jsx(Card, {
      style: { width: 320 },
      children: _jsxs("div", {
        className: "gdg-stack",
        children: [
          _jsxs("div", {
            className: "gdg-toolbar",
            children: [
              _jsx("h2", {
                className: "gdg-heading",
                children: "\u6B21\u56DE\u306E\u30A4\u30D9\u30F3\u30C8",
              }),
              _jsx(Badge, { tone: "success", children: "\u516C\u958B\u4E2D" }),
            ],
          }),
          _jsx("p", {
            className: "gdg-text gdg-muted",
            children:
              "\u958B\u767A\u8005\u540C\u58EB\u3067\u5B66\u3073\u3001\u3064\u306A\u304C\u308B\u4E00\u65E5\u3002",
          }),
        ],
      }),
    }),
};
