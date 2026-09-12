import type { Meta, StoryObj } from "@storybook/react-vite";
import { Resizable, ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./Resizable";

const meta = {
  title: "Components/Resizable",
  component: Resizable,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Resizable>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SplitView: Story = {
  render: () => (
    <ResizablePanelGroup style={{ width: 480, height: 180 }}>
      <ResizablePanel defaultSize={38} style={{ padding: 16, background: "var(--gdg-surface)" }}>
        ナビゲーション
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={62} style={{ padding: 16, background: "var(--gdg-background)" }}>
        コンテンツ
      </ResizablePanel>
    </ResizablePanelGroup>
  ),
};
