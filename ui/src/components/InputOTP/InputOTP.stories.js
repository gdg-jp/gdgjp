import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "./InputOTP";
const meta = {
  title: "Components/InputOTP",
  component: InputOTP,
  parameters: { layout: "centered" },
};
export default meta;
export const SixDigits = {
  render: () =>
    _jsxs(InputOTP, {
      defaultValue: "12",
      maxLength: 6,
      "aria-label": "\u78BA\u8A8D\u30B3\u30FC\u30C9",
      children: [
        _jsx(InputOTPGroup, {
          children: [0, 1, 2].map((index) => _jsx(InputOTPSlot, { index: index }, index)),
        }),
        _jsx(InputOTPSeparator, {}),
        _jsx(InputOTPGroup, {
          children: [3, 4, 5].map((index) => _jsx(InputOTPSlot, { index: index }, index)),
        }),
      ],
    }),
};
