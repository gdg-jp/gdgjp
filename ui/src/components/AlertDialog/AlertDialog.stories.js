import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from "../Button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./AlertDialog";
const meta = {
  title: "Components/AlertDialog",
  component: AlertDialog,
  parameters: { layout: "centered" },
};
export default meta;
export const Confirmation = {
  render: () =>
    _jsxs(AlertDialog, {
      children: [
        _jsx(AlertDialogTrigger, {
          asChild: true,
          children: _jsx(Button, {
            variant: "danger",
            children: "\u30A4\u30D9\u30F3\u30C8\u3092\u524A\u9664",
          }),
        }),
        _jsxs(AlertDialogContent, {
          children: [
            _jsx(AlertDialogTitle, {
              children: "\u30A4\u30D9\u30F3\u30C8\u3092\u524A\u9664\u3057\u307E\u3059\u304B\uFF1F",
            }),
            _jsx(AlertDialogDescription, {
              children:
                "\u3053\u306E\u64CD\u4F5C\u306F\u53D6\u308A\u6D88\u305B\u307E\u305B\u3093\u3002\u524A\u9664\u3059\u308B\u524D\u306B\u5185\u5BB9\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
            }),
            _jsxs("div", {
              className: "gdg-inline",
              children: [
                _jsx(AlertDialogCancel, {
                  asChild: true,
                  children: _jsx(Button, {
                    variant: "outline",
                    children: "\u30AD\u30E3\u30F3\u30BB\u30EB",
                  }),
                }),
                _jsx(AlertDialogAction, {
                  asChild: true,
                  children: _jsx(Button, {
                    variant: "danger",
                    children: "\u524A\u9664\u3059\u308B",
                  }),
                }),
              ],
            }),
          ],
        }),
      ],
    }),
};
