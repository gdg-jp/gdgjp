import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Input } from "../Input";
import { Label } from "./Label";
const meta = {
  title: "Components/Label",
  component: Label,
  parameters: { layout: "centered" },
};
export default meta;
export const Default = {
  render: () =>
    _jsxs("div", {
      className: "gdg-field",
      children: [
        _jsx(Label, { htmlFor: "label-example", children: "\u30A4\u30D9\u30F3\u30C8\u540D" }),
        _jsx(Input, { id: "label-example", placeholder: "DevFest" }),
      ],
    }),
};
