import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Bubble, BubbleContent, BubbleGroup, BubbleReactions } from "./Bubble";
const meta = {
  title: "Components/Bubble",
  component: Bubble,
  parameters: { layout: "centered" },
};
export default meta;
export const Conversation = {
  render: () =>
    _jsxs(BubbleGroup, {
      style: { width: 360 },
      children: [
        _jsxs(Bubble, {
          children: [
            _jsx(BubbleContent, {
              children:
                "\u6B21\u56DE\u306EGDG\u30A4\u30D9\u30F3\u30C8\u306B\u3064\u3044\u3066\u78BA\u8A8D\u3057\u307E\u3057\u305F\u3002",
            }),
            _jsx(BubbleReactions, {
              "aria-label": "\u30EA\u30A2\u30AF\u30B7\u30E7\u30F3",
              children: "\uD83D\uDC4D 3",
            }),
          ],
        }),
        _jsx(Bubble, {
          align: "end",
          variant: "tinted",
          children: _jsx(BubbleContent, {
            children:
              "\u3042\u308A\u304C\u3068\u3046\u3054\u3056\u3044\u307E\u3059\u3002\u516C\u958B\u6E96\u5099\u3092\u9032\u3081\u307E\u3059\u3002",
          }),
        }),
      ],
    }),
};
