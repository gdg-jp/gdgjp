import { jsx as _jsx } from "react/jsx-runtime";
import { AspectRatio } from "./AspectRatio";
const meta = {
  title: "Components/AspectRatio",
  component: AspectRatio,
  parameters: { layout: "centered" },
};
export default meta;
export const Default = {
  render: () =>
    _jsx(AspectRatio, {
      ratio: 4 / 3,
      style: { width: 280 },
      children: _jsx("img", {
        alt: "GDG Apps \u306E\u30D7\u30EC\u30FC\u30B9\u30DB\u30EB\u30C0\u30FC",
        src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 4 3'%3E%3Crect width='4' height='3' fill='%234285f4'/%3E%3Ctext x='2' y='1.7' fill='white' text-anchor='middle' font-size='.45'%3EGDG Apps%3C/text%3E%3C/svg%3E",
      }),
    }),
};
