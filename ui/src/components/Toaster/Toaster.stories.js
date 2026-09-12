import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from "../Button";
import { Toaster, toast } from "./Toaster";
const meta = {
  title: "Components/Toaster",
  component: Toaster,
  parameters: { layout: "centered" },
};
export default meta;
export const Notifications = {
  render: () =>
    _jsxs(_Fragment, {
      children: [
        _jsxs("div", {
          className: "gdg-inline",
          children: [
            _jsx(Button, {
              onClick: () => toast.success("変更を保存しました"),
              children: "\u6210\u529F",
            }),
            _jsx(Button, {
              variant: "outline",
              onClick: () => toast.error("保存できませんでした"),
              children: "\u30A8\u30E9\u30FC",
            }),
          ],
        }),
        _jsx(Toaster, {}),
      ],
    }),
};
