import { jsx as _jsx } from "react/jsx-runtime";
import { DirectionProvider } from "./Direction";
const meta = {
  title: "Components/Direction",
  component: DirectionProvider,
  parameters: { layout: "centered" },
};
export default meta;
export const RightToLeft = {
  args: {},
  render: () =>
    _jsx(DirectionProvider, {
      dir: "rtl",
      children: _jsx("div", {
        className: "gdg-story-surface",
        style: { width: 260, padding: 16, borderRadius: 16, background: "var(--gdg-surface)" },
        children: "\u65B9\u5411\u3092\u5207\u308A\u66FF\u3048\u305F\u30EC\u30A4\u30A2\u30A6\u30C8",
      }),
    }),
};
