import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Skeleton } from "./Skeleton";
const meta = {
  title: "Components/Skeleton",
  component: Skeleton,
  parameters: { layout: "centered" },
};
export default meta;
export const CardPlaceholder = {
  render: () =>
    _jsxs("div", {
      className: "gdg-card gdg-stack",
      "aria-label": "\u8AAD\u307F\u8FBC\u307F\u4E2D",
      children: [
        _jsx(Skeleton, { style: { width: 180, height: 24 } }),
        _jsx(Skeleton, { style: { width: 280, height: 16 } }),
        _jsx(Skeleton, { style: { width: 120, height: 40 } }),
      ],
    }),
};
