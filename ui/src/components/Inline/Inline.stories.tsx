import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { Inline } from "./Inline";

const meta = {
  title: "Components/Inline",
  component: Inline,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Inline>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Inline>
      <Badge tone="info">情報</Badge>
      <Button size="sm">アクション</Button>
      <Button size="sm" variant="outline">
        キャンセル
      </Button>
    </Inline>
  ),
};
