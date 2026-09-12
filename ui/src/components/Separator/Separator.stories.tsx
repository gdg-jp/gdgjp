import type { Meta, StoryObj } from "@storybook/react-vite";
import { Separator } from "./Separator";

const meta = {
  title: "Components/Separator",
  component: Separator,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Separator>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {
  render: () => (
    <div style={{ width: 320 }}>
      <p className="gdg-text">イベント詳細</p>
      <Separator />
      <p className="gdg-text">参加登録</p>
    </div>
  ),
};

export const Vertical: Story = {
  render: () => (
    <div className="gdg-inline" style={{ height: 40 }}>
      <span>概要</span>
      <Separator orientation="vertical" />
      <span>詳細</span>
    </div>
  ),
};
