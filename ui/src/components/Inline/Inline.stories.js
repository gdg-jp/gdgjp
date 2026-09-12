import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { Inline } from "./Inline";
const meta = {
  title: "Components/Inline",
  component: Inline,
  parameters: { layout: "centered" },
};
export default meta;
export const Default = {
  render: () =>
    _jsxs(Inline, {
      children: [
        _jsx(Badge, { tone: "info", children: "\u60C5\u5831" }),
        _jsx(Button, { size: "sm", children: "\u30A2\u30AF\u30B7\u30E7\u30F3" }),
        _jsx(Button, {
          size: "sm",
          variant: "outline",
          children: "\u30AD\u30E3\u30F3\u30BB\u30EB",
        }),
      ],
    }),
};
