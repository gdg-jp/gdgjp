import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "../Badge";
import { Card } from "./Card";

const meta = {
  title: "Components/Card",
  component: Card,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Card>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Card style={{ width: 320 }}>
      <div className="gdg-stack">
        <div className="gdg-toolbar">
          <h2 className="gdg-heading">次回のイベント</h2>
          <Badge tone="success">公開中</Badge>
        </div>
        <p className="gdg-text gdg-muted">開発者同士で学び、つながる一日。</p>
      </div>
    </Card>
  ),
};
