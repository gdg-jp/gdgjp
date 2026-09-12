import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./Tabs";
const meta = {
  title: "Components/Tabs",
  component: Tabs,
  parameters: { layout: "centered" },
};
export default meta;
export const Default = {
  render: () =>
    _jsxs(Tabs, {
      defaultValue: "overview",
      style: { width: 360 },
      children: [
        _jsxs(TabsList, {
          "aria-label": "\u30A4\u30D9\u30F3\u30C8\u60C5\u5831",
          children: [
            _jsx(TabsTrigger, { value: "overview", children: "\u6982\u8981" }),
            _jsx(TabsTrigger, {
              value: "schedule",
              children: "\u30BF\u30A4\u30E0\u30C6\u30FC\u30D6\u30EB",
            }),
            _jsx(TabsTrigger, { value: "access", children: "\u30A2\u30AF\u30BB\u30B9" }),
          ],
        }),
        _jsx(TabsContent, {
          value: "overview",
          children:
            "\u30A4\u30D9\u30F3\u30C8\u306E\u6982\u8981\u3092\u8868\u793A\u3057\u307E\u3059\u3002",
        }),
        _jsx(TabsContent, {
          value: "schedule",
          children:
            "\u5F53\u65E5\u306E\u30BF\u30A4\u30E0\u30C6\u30FC\u30D6\u30EB\u3092\u8868\u793A\u3057\u307E\u3059\u3002",
        }),
        _jsx(TabsContent, {
          value: "access",
          children:
            "\u4F1A\u5834\u307E\u3067\u306E\u30A2\u30AF\u30BB\u30B9\u3092\u8868\u793A\u3057\u307E\u3059\u3002",
        }),
      ],
    }),
};
