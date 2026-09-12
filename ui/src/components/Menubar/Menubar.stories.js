import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Menubar, MenubarContent, MenubarItem, MenubarMenu, MenubarTrigger } from "./Menubar";
const meta = {
  title: "Components/Menubar",
  component: Menubar,
  parameters: { layout: "centered" },
};
export default meta;
export const Menu = {
  render: () =>
    _jsxs(Menubar, {
      children: [
        _jsxs(MenubarMenu, {
          children: [
            _jsx(MenubarTrigger, { children: "\u30D5\u30A1\u30A4\u30EB" }),
            _jsxs(MenubarContent, {
              children: [
                _jsx(MenubarItem, { children: "\u65B0\u898F\u4F5C\u6210" }),
                _jsx(MenubarItem, { children: "\u958B\u304F" }),
              ],
            }),
          ],
        }),
        _jsxs(MenubarMenu, {
          children: [
            _jsx(MenubarTrigger, { children: "\u30D8\u30EB\u30D7" }),
            _jsx(MenubarContent, {
              children: _jsx(MenubarItem, { children: "\u4F7F\u3044\u65B9" }),
            }),
          ],
        }),
      ],
    }),
};
