import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from "../Button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./Tooltip";
const meta = {
  title: "Components/Tooltip",
  component: Tooltip,
  parameters: { layout: "centered" },
};
export default meta;
export const Default = {
  render: () =>
    _jsxs(Tooltip, {
      children: [
        _jsx(TooltipTrigger, {
          asChild: true,
          children: _jsx(Button, {
            variant: "outline",
            children: "\u30AB\u30FC\u30BD\u30EB\u3092\u5408\u308F\u305B\u308B",
          }),
        }),
        _jsx(TooltipContent, {
          children:
            "\u77ED\u3044\u88DC\u8DB3\u8AAC\u660E\u3092\u8868\u793A\u3057\u307E\u3059\u3002",
        }),
      ],
    }),
};
