import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Resizable, ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./Resizable";
const meta = {
  title: "Components/Resizable",
  component: Resizable,
  parameters: { layout: "centered" },
};
export default meta;
export const SplitView = {
  render: () =>
    _jsxs(ResizablePanelGroup, {
      style: { width: 480, height: 180 },
      children: [
        _jsx(ResizablePanel, {
          defaultSize: 38,
          style: { padding: 16, background: "var(--gdg-surface)" },
          children: "\u30CA\u30D3\u30B2\u30FC\u30B7\u30E7\u30F3",
        }),
        _jsx(ResizableHandle, { withHandle: true }),
        _jsx(ResizablePanel, {
          defaultSize: 62,
          style: { padding: 16, background: "var(--gdg-background)" },
          children: "\u30B3\u30F3\u30C6\u30F3\u30C4",
        }),
      ],
    }),
};
