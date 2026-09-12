import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from "../Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./DropdownMenu";
const meta = {
  title: "Components/DropdownMenu",
  component: DropdownMenu,
  parameters: { layout: "centered" },
};
export default meta;
export const Default = {
  render: () =>
    _jsxs(DropdownMenu, {
      children: [
        _jsx(DropdownMenuTrigger, {
          asChild: true,
          children: _jsx(Button, {
            variant: "outline",
            children: "\u30A4\u30D9\u30F3\u30C8\u306E\u64CD\u4F5C",
          }),
        }),
        _jsxs(DropdownMenuContent, {
          children: [
            _jsx(DropdownMenuLabel, { children: "\u30A4\u30D9\u30F3\u30C8" }),
            _jsxs(DropdownMenuGroup, {
              children: [
                _jsx(DropdownMenuItem, { children: "\u7DE8\u96C6" }),
                _jsx(DropdownMenuItem, { children: "\u30EA\u30F3\u30AF\u3092\u30B3\u30D4\u30FC" }),
              ],
            }),
            _jsx(DropdownMenuSeparator, {}),
            _jsx(DropdownMenuItem, {
              disabled: true,
              children: "\u30A2\u30FC\u30AB\u30A4\u30D6\uFF08\u6E96\u5099\u4E2D\uFF09",
            }),
          ],
        }),
      ],
    }),
};
