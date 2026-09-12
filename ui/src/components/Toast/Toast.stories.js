import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import {
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "./Toast";
const meta = {
  title: "Components/Toast",
  component: Toast,
  parameters: { layout: "centered" },
};
export default meta;
export const Saved = {
  render: () =>
    _jsxs(ToastProvider, {
      children: [
        _jsxs(Toast, {
          open: true,
          children: [
            _jsx(ToastTitle, { children: "\u4FDD\u5B58\u3057\u307E\u3057\u305F" }),
            _jsx(ToastDescription, {
              children:
                "\u30A4\u30D9\u30F3\u30C8\u60C5\u5831\u3092\u66F4\u65B0\u3057\u307E\u3057\u305F\u3002",
            }),
            _jsx(ToastAction, {
              altText: "\u5143\u306B\u623B\u3059",
              children: "\u5143\u306B\u623B\u3059",
            }),
            _jsx(ToastClose, {
              "aria-label": "\u901A\u77E5\u3092\u9589\u3058\u308B",
              children: "\u00D7",
            }),
          ],
        }),
        _jsx(ToastViewport, {}),
      ],
    }),
};
