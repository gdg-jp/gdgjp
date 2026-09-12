import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from "../Button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "./Dialog";
const meta = {
  title: "Components/Dialog",
  component: Dialog,
  parameters: { layout: "centered" },
};
export default meta;
export const Default = {
  render: () =>
    _jsxs(Dialog, {
      children: [
        _jsx(DialogTrigger, {
          asChild: true,
          children: _jsx(Button, { children: "\u30A4\u30D9\u30F3\u30C8\u3092\u7DE8\u96C6" }),
        }),
        _jsxs(DialogContent, {
          children: [
            _jsx(DialogTitle, { children: "\u30A4\u30D9\u30F3\u30C8\u3092\u7DE8\u96C6" }),
            _jsx(DialogDescription, {
              children:
                "\u53C2\u52A0\u8005\u306B\u4F1D\u308F\u308B\u540D\u524D\u3092\u8A2D\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
            }),
            _jsx("input", {
              className: "gdg-input",
              "aria-label": "\u30A4\u30D9\u30F3\u30C8\u540D",
              defaultValue: "GDG Apps Meetup",
            }),
            _jsxs("div", {
              className: "gdg-inline",
              children: [
                _jsx(Button, { children: "\u4FDD\u5B58" }),
                _jsx(DialogClose, {
                  asChild: true,
                  children: _jsx(Button, {
                    variant: "outline",
                    children: "\u30AD\u30E3\u30F3\u30BB\u30EB",
                  }),
                }),
              ],
            }),
          ],
        }),
      ],
    }),
};
