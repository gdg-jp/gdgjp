import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from "./Button";
const meta = {
  title: "Components/Button",
  component: Button,
  parameters: { layout: "centered" },
  args: { children: "保存" },
};
export default meta;
export const Primary = {};
export const Variants = {
  render: () =>
    _jsxs("div", {
      className: "gdg-inline",
      children: [
        _jsx(Button, { variant: "primary", children: "Primary" }),
        _jsx(Button, { variant: "secondary", children: "Secondary" }),
        _jsx(Button, { variant: "outline", children: "Outline" }),
        _jsx(Button, { variant: "ghost", children: "Ghost" }),
        _jsx(Button, { variant: "danger", children: "Danger" }),
      ],
    }),
};
export const Sizes = {
  render: () =>
    _jsxs("div", {
      className: "gdg-inline",
      children: [
        _jsx(Button, { size: "sm", children: "\u5C0F" }),
        _jsx(Button, { size: "md", children: "\u6A19\u6E96" }),
        _jsx(Button, { size: "lg", children: "\u5927" }),
      ],
    }),
};
export const Loading = { args: { loading: true, children: "保存中" } };
export const FullWidth = {
  render: () =>
    _jsx("div", {
      style: { width: 320 },
      children: _jsx(Button, { fullWidth: true, children: "\u5909\u66F4\u3092\u4FDD\u5B58" }),
    }),
};
export const AsLink = {
  render: () =>
    _jsx(Button, {
      asChild: true,
      variant: "outline",
      children: _jsx("a", { href: "#details", children: "\u8A73\u7D30\u3092\u898B\u308B" }),
    }),
};
