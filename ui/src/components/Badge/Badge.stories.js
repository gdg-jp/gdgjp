import { jsx as _jsx } from "react/jsx-runtime";
import { Badge } from "./Badge";
const meta = {
  title: "Components/Badge",
  component: Badge,
  parameters: { layout: "centered" },
  args: { children: "公開中" },
};
export default meta;
export const Neutral = { args: { tone: "neutral", children: "下書き" } };
export const Statuses = {
  render: () =>
    _jsx("div", {
      className: "gdg-inline",
      children: ["neutral", "info", "success", "warning", "danger"].map((tone) =>
        _jsx(Badge, { tone: tone, children: tone }, tone),
      ),
    }),
};
