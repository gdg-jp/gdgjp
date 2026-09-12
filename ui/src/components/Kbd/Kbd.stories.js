import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Kbd, KbdGroup } from "./Kbd";
const meta = {
  title: "Components/Kbd",
  component: Kbd,
  parameters: { layout: "centered" },
};
export default meta;
export const Shortcut = {
  render: () =>
    _jsxs(KbdGroup, {
      "aria-label": "\u30AD\u30FC\u30DC\u30FC\u30C9\u30B7\u30E7\u30FC\u30C8\u30AB\u30C3\u30C8",
      children: [_jsx(Kbd, { children: "\u2318" }), _jsx(Kbd, { children: "K" })],
    }),
};
