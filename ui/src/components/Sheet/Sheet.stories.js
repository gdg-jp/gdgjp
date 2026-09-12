import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from "../Button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "./Sheet";
const meta = {
  title: "Components/Sheet",
  component: Sheet,
  parameters: { layout: "centered" },
};
export default meta;
export const Right = {
  render: () =>
    _jsxs(Sheet, {
      children: [
        _jsx(SheetTrigger, {
          asChild: true,
          children: _jsx(Button, {
            variant: "outline",
            children: "\u8A2D\u5B9A\u3092\u958B\u304F",
          }),
        }),
        _jsxs(SheetContent, {
          side: "right",
          children: [
            _jsx(SheetTitle, { children: "\u8868\u793A\u8A2D\u5B9A" }),
            _jsx(SheetDescription, {
              children:
                "\u8868\u793A\u306B\u95A2\u3059\u308B\u8A2D\u5B9A\u3092\u5909\u66F4\u3057\u307E\u3059\u3002",
            }),
            _jsx(SheetClose, {
              asChild: true,
              children: _jsx(Button, { variant: "outline", children: "\u9589\u3058\u308B" }),
            }),
          ],
        }),
      ],
    }),
};
