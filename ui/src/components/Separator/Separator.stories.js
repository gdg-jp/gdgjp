import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Separator } from "./Separator";
const meta = {
  title: "Components/Separator",
  component: Separator,
  parameters: { layout: "centered" },
};
export default meta;
export const Horizontal = {
  render: () =>
    _jsxs("div", {
      style: { width: 320 },
      children: [
        _jsx("p", { className: "gdg-text", children: "\u30A4\u30D9\u30F3\u30C8\u8A73\u7D30" }),
        _jsx(Separator, {}),
        _jsx("p", { className: "gdg-text", children: "\u53C2\u52A0\u767B\u9332" }),
      ],
    }),
};
export const Vertical = {
  render: () =>
    _jsxs("div", {
      className: "gdg-inline",
      style: { height: 40 },
      children: [
        _jsx("span", { children: "\u6982\u8981" }),
        _jsx(Separator, { orientation: "vertical" }),
        _jsx("span", { children: "\u8A73\u7D30" }),
      ],
    }),
};
