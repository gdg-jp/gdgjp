import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { FormField } from "../FormField";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./Select";
const meta = {
  title: "Components/Select",
  component: Select,
  parameters: { layout: "centered" },
};
export default meta;
export const Default = {
  render: () =>
    _jsx(FormField, {
      label: "\u958B\u50AC\u5F62\u5F0F",
      description:
        "\u53C2\u52A0\u65B9\u6CD5\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      children: _jsxs(Select, {
        defaultValue: "hybrid",
        children: [
          _jsx(SelectTrigger, {
            children: _jsx(SelectValue, { placeholder: "\u5F62\u5F0F\u3092\u9078\u629E" }),
          }),
          _jsxs(SelectContent, {
            children: [
              _jsx(SelectItem, { value: "venue", children: "\u4F1A\u5834" }),
              _jsx(SelectItem, { value: "online", children: "\u30AA\u30F3\u30E9\u30A4\u30F3" }),
              _jsx(SelectItem, {
                value: "hybrid",
                children: "\u30CF\u30A4\u30D6\u30EA\u30C3\u30C9",
              }),
            ],
          }),
        ],
      }),
    }),
};
