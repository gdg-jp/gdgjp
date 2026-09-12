import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from "../Button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./Collapsible";
const meta = {
  title: "Components/Collapsible",
  component: Collapsible,
  parameters: { layout: "centered" },
};
export default meta;
export const Default = {
  render: () =>
    _jsxs(Collapsible, {
      defaultOpen: true,
      style: { width: 320 },
      children: [
        _jsx(CollapsibleTrigger, {
          asChild: true,
          children: _jsx(Button, {
            variant: "outline",
            children: "\u8A73\u7D30\u3092\u8868\u793A",
          }),
        }),
        _jsx(CollapsibleContent, {
          children: _jsx("p", {
            style: { margin: "12px 0 0" },
            children:
              "\u53C2\u52A0\u8005\u306B\u306F\u30A4\u30D9\u30F3\u30C8\u30DA\u30FC\u30B8\u304B\u3089\u6848\u5185\u3092\u9001\u308A\u307E\u3059\u3002",
          }),
        }),
      ],
    }),
};
