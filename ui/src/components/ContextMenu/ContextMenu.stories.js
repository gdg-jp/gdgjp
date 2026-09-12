import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from "../Button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./ContextMenu";
const meta = {
  title: "Components/ContextMenu",
  component: ContextMenu,
  parameters: { layout: "centered" },
};
export default meta;
export const Actions = {
  render: () =>
    _jsxs(ContextMenu, {
      children: [
        _jsx(ContextMenuTrigger, {
          asChild: true,
          children: _jsx(Button, {
            variant: "outline",
            children: "\u53F3\u30AF\u30EA\u30C3\u30AF\u3057\u3066\u304F\u3060\u3055\u3044",
          }),
        }),
        _jsxs(ContextMenuContent, {
          "aria-label": "\u64CD\u4F5C\u30E1\u30CB\u30E5\u30FC",
          children: [
            _jsx(ContextMenuItem, { children: "\u7DE8\u96C6" }),
            _jsx(ContextMenuSeparator, {}),
            _jsx(ContextMenuItem, { children: "\u30B3\u30D4\u30FC" }),
          ],
        }),
      ],
    }),
};
