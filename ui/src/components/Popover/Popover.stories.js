import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from "../Button";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "./Popover";
const meta = {
  title: "Components/Popover",
  component: Popover,
  parameters: { layout: "centered" },
};
export default meta;
export const Default = {
  render: () =>
    _jsxs(Popover, {
      children: [
        _jsx(PopoverTrigger, {
          asChild: true,
          children: _jsx(Button, { variant: "outline", children: "\u88DC\u8DB3\u60C5\u5831" }),
        }),
        _jsx(PopoverContent, {
          "aria-label": "\u30A4\u30D9\u30F3\u30C8\u306E\u88DC\u8DB3\u60C5\u5831",
          children: _jsxs("div", {
            className: "gdg-stack",
            children: [
              _jsx("strong", { children: "\u958B\u50AC\u5F62\u5F0F" }),
              _jsx("span", {
                children:
                  "\u4F1A\u5834\u3068\u30AA\u30F3\u30E9\u30A4\u30F3\u306E\u540C\u6642\u958B\u50AC\u3067\u3059\u3002",
              }),
              _jsx(PopoverClose, {
                asChild: true,
                children: _jsx(Button, { variant: "ghost", children: "\u9589\u3058\u308B" }),
              }),
            ],
          }),
        }),
      ],
    }),
};
