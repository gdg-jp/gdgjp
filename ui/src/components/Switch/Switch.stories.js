import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Switch } from "./Switch";
const meta = {
  title: "Components/Switch",
  component: Switch,
  parameters: { layout: "centered" },
};
export default meta;
export const Default = {
  render: () =>
    _jsxs("div", {
      className: "gdg-inline",
      children: [
        _jsx(Switch, { id: "notifications-switch", defaultChecked: true }),
        _jsx("label", {
          htmlFor: "notifications-switch",
          children: "\u901A\u77E5\u3092\u53D7\u3051\u53D6\u308B",
        }),
      ],
    }),
};
