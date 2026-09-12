import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./Accordion";
const meta = {
  title: "Components/Accordion",
  component: Accordion,
  parameters: { layout: "centered" },
};
export default meta;
export const Default = {
  render: () =>
    _jsxs(Accordion, {
      type: "single",
      collapsible: true,
      defaultValue: "registration",
      children: [
        _jsxs(AccordionItem, {
          value: "registration",
          children: [
            _jsx(AccordionTrigger, {
              children: "\u53C2\u52A0\u65B9\u6CD5\u3092\u6559\u3048\u3066\u304F\u3060\u3055\u3044",
            }),
            _jsx(AccordionContent, {
              children:
                "\u30A4\u30D9\u30F3\u30C8\u30DA\u30FC\u30B8\u304B\u3089\u53C2\u52A0\u767B\u9332\u3067\u304D\u307E\u3059\u3002",
            }),
          ],
        }),
        _jsxs(AccordionItem, {
          value: "venue",
          children: [
            _jsx(AccordionTrigger, {
              children: "\u4F1A\u5834\u306F\u3069\u3053\u3067\u3059\u304B\uFF1F",
            }),
            _jsx(AccordionContent, {
              children:
                "\u958B\u50AC\u524D\u306B\u30E1\u30FC\u30EB\u3067\u4F1A\u5834\u306E\u8A73\u7D30\u3092\u304A\u77E5\u3089\u305B\u3057\u307E\u3059\u3002",
            }),
          ],
        }),
      ],
    }),
};
