import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from "../Button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./HoverCard";
const meta = {
  title: "Components/HoverCard",
  component: HoverCard,
  parameters: { layout: "centered" },
};
export default meta;
export const Profile = {
  render: () =>
    _jsxs(HoverCard, {
      open: true,
      children: [
        _jsx(HoverCardTrigger, {
          asChild: true,
          children: _jsx(Button, { variant: "ghost", children: "@gdgjp" }),
        }),
        _jsxs(HoverCardContent, {
          children: [
            _jsx("strong", { children: "GDG Japan" }),
            _jsx("p", {
              className: "gdg-muted",
              children:
                "\u958B\u767A\u8005\u30B3\u30DF\u30E5\u30CB\u30C6\u30A3\u306E\u30A4\u30D9\u30F3\u30C8\u60C5\u5831\u3092\u767A\u4FE1\u3057\u3066\u3044\u307E\u3059\u3002",
            }),
          ],
        }),
      ],
    }),
};
