import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from "../Button";
import { Heading } from "../Heading";
import { Toolbar } from "./Toolbar";
const meta = {
  title: "Components/Toolbar",
  component: Toolbar,
  parameters: { layout: "centered" },
};
export default meta;
export const Default = {
  render: () =>
    _jsxs(Toolbar, {
      style: { width: 420 },
      children: [
        _jsx(Heading, { level: 2, children: "\u30A4\u30D9\u30F3\u30C8\u4E00\u89A7" }),
        _jsxs("div", {
          className: "gdg-inline",
          children: [
            _jsx(Button, { variant: "outline", children: "\u7D5E\u308A\u8FBC\u307F" }),
            _jsx(Button, { children: "\u65B0\u898F\u4F5C\u6210" }),
          ],
        }),
      ],
    }),
};
