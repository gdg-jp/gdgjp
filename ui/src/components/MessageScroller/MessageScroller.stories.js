import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "./MessageScroller";
const meta = {
  title: "Components/MessageScroller",
  component: MessageScroller,
  parameters: { layout: "centered" },
};
export default meta;
export const LatestMessages = {
  render: () =>
    _jsx(MessageScrollerProvider, {
      initialPosition: "end",
      children: _jsxs(MessageScroller, {
        style: { width: 400, height: 220, flex: "none" },
        children: [
          _jsx(MessageScrollerViewport, {
            "aria-label": "\u30E1\u30C3\u30BB\u30FC\u30B8\u5C65\u6B74",
            children: _jsx(MessageScrollerContent, {
              children: Array.from({ length: 8 }, (_, index) =>
                _jsxs(
                  MessageScrollerItem,
                  {
                    messageId: `message-${index + 1}`,
                    children: [
                      index + 1,
                      ". \u30A4\u30D9\u30F3\u30C8\u904B\u55B6\u30C1\u30FC\u30E0\u304B\u3089\u306E\u304A\u77E5\u3089\u305B\u3067\u3059\u3002",
                    ],
                  },
                  `message-${index + 1}`,
                ),
              ),
            }),
          }),
          _jsx(MessageScrollerButton, {}),
        ],
      }),
    }),
};
