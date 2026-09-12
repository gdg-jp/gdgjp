import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import {
  Typography,
  TypographyBlockquote,
  TypographyH1,
  TypographyH2,
  TypographyInlineCode,
  TypographyLead,
  TypographyList,
} from "./Typography";
const meta = {
  title: "Components/Typography",
  component: Typography,
  parameters: { layout: "centered" },
};
export default meta;
export const Scale = {
  render: () =>
    _jsxs("div", {
      style: { width: 520 },
      children: [
        _jsx(TypographyH1, { children: "GDG Apps" }),
        _jsx(TypographyLead, {
          children:
            "\u30B3\u30DF\u30E5\u30CB\u30C6\u30A3\u306E\u6D3B\u52D5\u3092\u3001\u660E\u77AD\u306B\u4F1D\u3048\u308B\u3002",
        }),
        _jsx(TypographyH2, { children: "\u30A4\u30D9\u30F3\u30C8\u3092\u63A2\u3059" }),
        _jsx(Typography, {
          variant: "p",
          children:
            "\u672C\u6587\u306E\u8AAD\u307F\u3084\u3059\u3055\u3068\u64CD\u4F5C\u306E\u5206\u304B\u308A\u3084\u3059\u3055\u3092\u305D\u308D\u3048\u307E\u3059\u3002",
        }),
        _jsx(TypographyBlockquote, {
          children:
            "\u5B66\u3073\u3001\u3064\u306A\u304C\u308A\u3001\u5171\u6709\u3059\u308B\u3002",
        }),
        _jsxs(TypographyList, {
          children: [
            _jsx("li", { children: "\u30A2\u30AF\u30BB\u30B7\u30D3\u30EA\u30C6\u30A3" }),
            _jsx("li", { children: "\u30C6\u30FC\u30DE\u5BFE\u5FDC" }),
          ],
        }),
        _jsx(TypographyInlineCode, { children: "pnpm test" }),
      ],
    }),
};
