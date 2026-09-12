import { MoreHorizontal, Plus, Settings } from "lucide-react";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { IconButton } from "./IconButton";
const meta = {
  title: "Components/IconButton",
  component: IconButton,
  parameters: { layout: "centered" },
  args: { "aria-label": "設定", children: _jsx(Settings, { size: 18 }) },
};
export default meta;
export const Default = {};
export const Actions = {
  render: () =>
    _jsxs("div", {
      className: "gdg-inline",
      children: [
        _jsx(IconButton, { "aria-label": "\u8FFD\u52A0", children: _jsx(Plus, { size: 18 }) }),
        _jsx(IconButton, {
          "aria-label": "\u305D\u306E\u4ED6",
          variant: "ghost",
          children: _jsx(MoreHorizontal, { size: 18 }),
        }),
      ],
    }),
};
