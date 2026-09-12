import { jsx as _jsx } from "react/jsx-runtime";
import { Progress, ProgressIndicator } from "./Progress";
const meta = {
  title: "Components/Progress",
  component: Progress,
  parameters: { layout: "centered" },
};
export default meta;
export const Determinate = {
  render: () =>
    _jsx(Progress, {
      value: 68,
      "aria-label": "\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9\u306E\u9032\u6357",
      style: { width: 320 },
      children: _jsx(ProgressIndicator, {}),
    }),
};
export const Indeterminate = {
  render: () =>
    _jsx(Progress, {
      value: null,
      "aria-label": "\u51E6\u7406\u4E2D",
      style: { width: 320 },
      children: _jsx(ProgressIndicator, {}),
    }),
};
