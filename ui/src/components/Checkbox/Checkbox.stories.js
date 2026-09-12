import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Checkbox } from "./Checkbox";
const meta = {
  title: "Components/Checkbox",
  component: Checkbox,
  parameters: { layout: "centered" },
};
export default meta;
export const Default = {
  render: () =>
    _jsxs("div", {
      className: "gdg-inline",
      children: [
        _jsx(Checkbox, { id: "terms" }),
        _jsx("label", {
          htmlFor: "terms",
          children: "\u53C2\u52A0\u898F\u7D04\u306B\u540C\u610F\u3059\u308B",
        }),
      ],
    }),
};
export const Checked = {
  render: () =>
    _jsxs("div", {
      className: "gdg-inline",
      children: [
        _jsx(Checkbox, { id: "notifications", defaultChecked: true }),
        _jsx("label", {
          htmlFor: "notifications",
          children: "\u901A\u77E5\u3092\u53D7\u3051\u53D6\u308B",
        }),
      ],
    }),
};
export const Indeterminate = {
  render: () =>
    _jsxs("div", {
      className: "gdg-inline",
      children: [
        _jsx(Checkbox, { id: "partial", defaultChecked: "indeterminate" }),
        _jsx("label", { htmlFor: "partial", children: "\u4E00\u90E8\u9078\u629E" }),
      ],
    }),
};
