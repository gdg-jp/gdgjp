import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Input } from "./Input";
const meta = {
  title: "Components/Input",
  component: Input,
  parameters: { layout: "centered" },
  args: { placeholder: "入力してください" },
};
export default meta;
export const Default = {};
export const States = {
  render: () =>
    _jsxs("div", {
      className: "gdg-stack",
      style: { width: 320 },
      children: [
        _jsx(Input, {
          defaultValue: "\u5165\u529B\u6E08\u307F",
          "aria-label": "\u5165\u529B\u6E08\u307F",
        }),
        _jsx(Input, {
          defaultValue: "\u8AAD\u307F\u53D6\u308A\u5C02\u7528",
          readOnly: true,
          "aria-label": "\u8AAD\u307F\u53D6\u308A\u5C02\u7528",
        }),
        _jsx(Input, {
          defaultValue: "\u5229\u7528\u3067\u304D\u307E\u305B\u3093",
          disabled: true,
          "aria-label": "\u7121\u52B9",
        }),
      ],
    }),
};
