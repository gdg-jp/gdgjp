import { jsx as _jsx } from "react/jsx-runtime";
import { ScrollArea } from "./ScrollArea";
const meta = {
  title: "Components/ScrollArea",
  component: ScrollArea,
  parameters: { layout: "centered" },
};
export default meta;
export const LongList = {
  render: () =>
    _jsx(ScrollArea, {
      style: { width: 320, height: 180 },
      children: _jsx("div", {
        style: { display: "grid", gap: 12, padding: 16 },
        children: [
          "オープニング",
          "基調講演",
          "Webパフォーマンス",
          "生成AIの活用",
          "コミュニティ運営",
          "クロージング",
        ].map((session) => _jsx("div", { children: session }, session)),
      }),
    }),
};
