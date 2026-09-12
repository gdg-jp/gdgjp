import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Heading } from "./Heading";
const meta = {
  title: "Components/Heading",
  component: Heading,
  parameters: { layout: "centered" },
  args: { children: "GDG Apps のデザインシステム" },
};
export default meta;
export const Default = {};
export const Levels = {
  render: () =>
    _jsxs("div", {
      className: "gdg-stack",
      children: [
        _jsx(Heading, { level: 1, children: "\u898B\u51FA\u3057 1" }),
        _jsx(Heading, { level: 2, children: "\u898B\u51FA\u3057 2" }),
        _jsx(Heading, { level: 3, children: "\u898B\u51FA\u3057 3" }),
        _jsx(Heading, { level: 4, children: "\u898B\u51FA\u3057 4" }),
        _jsx(Heading, { level: 5, children: "\u898B\u51FA\u3057 5" }),
        _jsx(Heading, { level: 6, children: "\u898B\u51FA\u3057 6" }),
      ],
    }),
};
