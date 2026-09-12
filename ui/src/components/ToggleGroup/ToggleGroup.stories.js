import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ToggleGroup, ToggleGroupItem } from "./ToggleGroup";
const meta = {
  title: "Components/ToggleGroup",
  component: ToggleGroup,
  parameters: { layout: "centered" },
};
export default meta;
export const Alignment = {
  args: { type: "single" },
  render: () =>
    _jsxs(ToggleGroup, {
      type: "single",
      defaultValue: "center",
      "aria-label": "\u914D\u7F6E",
      children: [
        _jsx(ToggleGroupItem, { value: "start", children: "\u5DE6" }),
        _jsx(ToggleGroupItem, { value: "center", children: "\u4E2D\u592E" }),
        _jsx(ToggleGroupItem, { value: "end", children: "\u53F3" }),
      ],
    }),
};
