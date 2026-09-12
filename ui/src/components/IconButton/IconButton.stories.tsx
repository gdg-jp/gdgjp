import type { Meta, StoryObj } from "@storybook/react-vite";
import { MoreHorizontal, Plus, Settings } from "lucide-react";
import { IconButton } from "./IconButton";

const meta = {
  title: "Components/IconButton",
  component: IconButton,
  parameters: { layout: "centered" },
  args: { "aria-label": "設定", children: <Settings size={18} /> },
} satisfies Meta<typeof IconButton>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Actions: Story = {
  render: () => (
    <div className="gdg-inline">
      <IconButton aria-label="追加">
        <Plus size={18} />
      </IconButton>
      <IconButton aria-label="その他" variant="ghost">
        <MoreHorizontal size={18} />
      </IconButton>
    </div>
  ),
};
