import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Card } from "../Card";
import { Stack } from "./Stack";
const meta = {
  title: "Components/Stack",
  component: Stack,
  parameters: { layout: "centered" },
};
export default meta;
export const Default = {
  render: () =>
    _jsxs(Stack, {
      style: { width: 320 },
      children: [
        _jsx(Card, { children: "\u4E00\u3064\u76EE\u306E\u9762" }),
        _jsx(Card, { children: "\u4E8C\u3064\u76EE\u306E\u9762" }),
        _jsx(Card, { children: "\u4E09\u3064\u76EE\u306E\u9762" }),
      ],
    }),
};
