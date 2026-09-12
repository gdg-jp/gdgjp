import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { FormField } from "../FormField";
import { NativeSelect, NativeSelectOption } from "./NativeSelect";
const meta = {
  title: "Components/NativeSelect",
  component: NativeSelect,
  parameters: { layout: "centered" },
};
export default meta;
export const Default = {
  render: () =>
    _jsx(FormField, {
      label: "\u958B\u50AC\u5730",
      children: _jsxs(NativeSelect, {
        defaultValue: "tokyo",
        children: [
          _jsx(NativeSelectOption, { value: "tokyo", children: "Tokyo" }),
          _jsx(NativeSelectOption, { value: "osaka", children: "Osaka" }),
        ],
      }),
    }),
};
