import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../Button";
import { EmptyState } from "./EmptyState";

const meta = {
  title: "Components/EmptyState",
  component: EmptyState,
  parameters: { layout: "centered" },
} satisfies Meta<typeof EmptyState>;
export default meta;
type Story = StoryObj;

export const WithAction: Story = {
  render: () => (
    <EmptyState
      title="まだイベントがありません"
      description="最初のイベントを作成して、コミュニティに共有しましょう。"
      action={<Button>イベントを作成</Button>}
    />
  ),
};

export const WithoutDescription: Story = { args: { title: "結果がありません" } };
