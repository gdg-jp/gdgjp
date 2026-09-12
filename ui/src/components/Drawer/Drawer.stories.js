import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from "../Button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "./Drawer";
const meta = {
  title: "Components/Drawer",
  component: Drawer,
  parameters: { layout: "centered" },
};
export default meta;
export const BottomSheet = {
  render: () =>
    _jsxs(Drawer, {
      children: [
        _jsx(DrawerTrigger, {
          asChild: true,
          children: _jsx(Button, {
            variant: "outline",
            children: "\u8A73\u7D30\u3092\u958B\u304F",
          }),
        }),
        _jsxs(DrawerContent, {
          children: [
            _jsxs(DrawerHeader, {
              children: [
                _jsx(DrawerTitle, { children: "\u53C2\u52A0\u65B9\u6CD5" }),
                _jsx(DrawerDescription, {
                  children:
                    "\u30A4\u30D9\u30F3\u30C8\u30DA\u30FC\u30B8\u304B\u3089\u53C2\u52A0\u767B\u9332\u3067\u304D\u307E\u3059\u3002",
                }),
              ],
            }),
            _jsxs(DrawerFooter, {
              children: [
                _jsx(DrawerClose, {
                  asChild: true,
                  children: _jsx(Button, { variant: "outline", children: "\u9589\u3058\u308B" }),
                }),
                _jsx(Button, { children: "\u767B\u9332\u3059\u308B" }),
              ],
            }),
          ],
        }),
      ],
    }),
};
