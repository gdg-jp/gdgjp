import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ThemeProvider, ThemeToggle } from "./theme";
const meta = {
  title: "Theme/ThemeProvider",
  component: ThemeProvider,
  parameters: { layout: "centered" },
};
export default meta;
export const Toggle = {
  render: () =>
    _jsx(ThemeProvider, {
      children: _jsxs("div", {
        className: "gdg-stack",
        children: [
          _jsx(ThemeToggle, {}),
          _jsx("p", {
            className: "gdg-text",
            children:
              "\u30C6\u30FC\u30DE\u3092\u5207\u308A\u66FF\u3048\u308B\u3068\u3001\u3053\u306E\u6587\u66F8\u306E\u8272\u304C\u5909\u308F\u308A\u307E\u3059\u3002",
          }),
        ],
      }),
    }),
};
