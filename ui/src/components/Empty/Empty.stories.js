import { SearchX } from "lucide-react";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from "../Button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./Empty";
const meta = {
  title: "Components/Empty",
  component: Empty,
  parameters: { layout: "centered" },
};
export default meta;
export const NoResults = {
  render: () =>
    _jsxs(Empty, {
      style: { width: 420 },
      children: [
        _jsxs(EmptyHeader, {
          children: [
            _jsx(EmptyMedia, { children: _jsx(SearchX, { size: 22, "aria-hidden": "true" }) }),
            _jsx(EmptyTitle, {
              children:
                "\u8A72\u5F53\u3059\u308B\u30A4\u30D9\u30F3\u30C8\u304C\u3042\u308A\u307E\u305B\u3093",
            }),
            _jsx(EmptyDescription, {
              children:
                "\u691C\u7D22\u6761\u4EF6\u3092\u5909\u66F4\u3059\u308B\u304B\u3001\u65B0\u3057\u3044\u30A4\u30D9\u30F3\u30C8\u3092\u4F5C\u6210\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
            }),
          ],
        }),
        _jsx(EmptyContent, {
          children: _jsx(Button, { children: "\u30A4\u30D9\u30F3\u30C8\u3092\u4F5C\u6210" }),
        }),
      ],
    }),
};
