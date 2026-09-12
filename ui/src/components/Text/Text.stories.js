import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Text } from "./Text";
const meta = {
  title: "Components/Text",
  component: Text,
  parameters: { layout: "centered" },
  args: { children: "学び、つながり、共有するコミュニティ。" },
};
export default meta;
export const Default = {};
export const SizesAndTone = {
  render: () =>
    _jsxs("div", {
      className: "gdg-stack",
      children: [
        _jsx(Text, { size: "md", children: "\u672C\u6587\u306E\u30C6\u30AD\u30B9\u30C8" }),
        _jsx(Text, {
          size: "sm",
          children: "\u64CD\u4F5C\u3084\u88DC\u8DB3\u306B\u4F7F\u3046\u30C6\u30AD\u30B9\u30C8",
        }),
        _jsx(Text, {
          size: "xs",
          tone: "muted",
          children:
            "\u72B6\u614B\u3084\u6642\u523B\u306B\u4F7F\u3046\u88DC\u52A9\u30C6\u30AD\u30B9\u30C8",
        }),
      ],
    }),
};
