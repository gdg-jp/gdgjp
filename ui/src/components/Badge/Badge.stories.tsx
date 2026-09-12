import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge, type Tone } from "./Badge";

const meta = {
  title: "Components/Badge",
  component: Badge,
  parameters: { layout: "centered" },
  args: { children: "公開中" },
} satisfies Meta<typeof Badge>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Neutral: Story = { args: { tone: "neutral", children: "下書き" } };
export const Statuses: Story = {
  render: () => (
    <div className="gdg-inline">
      {(["neutral", "info", "success", "warning", "danger"] as Tone[]).map((tone) => (
        <Badge key={tone} tone={tone}>
          {tone}
        </Badge>
      ))}
    </div>
  ),
};
