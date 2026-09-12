import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Avatar } from "../Avatar";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageGroup,
  MessageHeader,
} from "./Message";
const meta = {
  title: "Components/Message",
  component: Message,
  parameters: { layout: "centered" },
};
export default meta;
export const Conversation = {
  render: () =>
    _jsxs(MessageGroup, {
      style: { width: 420 },
      children: [
        _jsxs(Message, {
          children: [
            _jsx(MessageAvatar, { children: _jsx(Avatar, { alt: "GDG", fallback: "GD" }) }),
            _jsxs(MessageContent, {
              children: [
                _jsx(MessageHeader, { children: "GDG Japan \u00B7 14:20" }),
                _jsx("div", {
                  className: "gdg-bubble-content",
                  children: "\u8CC7\u6599\u3092\u5171\u6709\u3057\u307E\u3057\u305F\u3002",
                }),
                _jsx(MessageFooter, { children: "\u65E2\u8AAD" }),
              ],
            }),
          ],
        }),
        _jsx(Message, {
          align: "end",
          children: _jsxs(MessageContent, {
            children: [
              _jsx(MessageHeader, { children: "\u3042\u306A\u305F \u00B7 14:22" }),
              _jsx("div", {
                className: "gdg-bubble-content",
                children: "\u78BA\u8A8D\u3057\u307E\u3059\u3002",
              }),
            ],
          }),
        }),
      ],
    }),
};
