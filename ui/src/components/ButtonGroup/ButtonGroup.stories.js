import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from "../Button";
import { ButtonGroup, ButtonGroupSeparator, ButtonGroupText } from "./ButtonGroup";
const meta = {
  title: "Components/ButtonGroup",
  component: ButtonGroup,
  parameters: { layout: "centered" },
};
export default meta;
export const Actions = {
  render: () =>
    _jsxs(ButtonGroup, {
      "aria-label": "\u8868\u793A\u64CD\u4F5C",
      children: [
        _jsx(Button, { variant: "outline", children: "\u524D\u3078" }),
        _jsx(ButtonGroupSeparator, {}),
        _jsx(Button, { variant: "outline", children: "\u6B21\u3078" }),
        _jsx(ButtonGroupText, { children: "3 / 8" }),
      ],
    }),
};
