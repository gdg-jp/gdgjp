import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Inline } from "../Inline";
import { RadioGroup, RadioGroupItem } from "./RadioGroup";
const meta = {
  title: "Components/RadioGroup",
  component: RadioGroup,
  parameters: { layout: "centered" },
};
export default meta;
export const Default = {
  render: () =>
    _jsx(RadioGroup, {
      "aria-label": "\u53C2\u52A0\u65B9\u6CD5",
      defaultValue: "venue",
      children: _jsxs(Inline, {
        children: [
          _jsx(RadioGroupItem, { id: "venue-option", value: "venue" }),
          _jsx("label", { htmlFor: "venue-option", children: "\u4F1A\u5834" }),
          _jsx(RadioGroupItem, { id: "online-option", value: "online" }),
          _jsx("label", { htmlFor: "online-option", children: "\u30AA\u30F3\u30E9\u30A4\u30F3" }),
        ],
      }),
    }),
};
