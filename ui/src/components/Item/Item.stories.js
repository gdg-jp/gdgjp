import { CalendarDays } from "lucide-react";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from "../Button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "./Item";
const meta = {
  title: "Components/Item",
  component: Item,
  parameters: { layout: "centered" },
};
export default meta;
export const Event = {
  render: () =>
    _jsxs(Item, {
      variant: "outline",
      style: { width: 420 },
      children: [
        _jsx(ItemMedia, { children: _jsx(CalendarDays, { size: 20, "aria-hidden": "true" }) }),
        _jsxs(ItemContent, {
          children: [
            _jsx(ItemTitle, { children: "DevFest Kansai" }),
            _jsx(ItemDescription, { children: "2026\u5E7410\u670817\u65E5 \u00B7 \u5927\u962A" }),
          ],
        }),
        _jsx(ItemActions, {
          children: _jsx(Button, { size: "sm", variant: "ghost", children: "\u8A73\u7D30" }),
        }),
      ],
    }),
};
