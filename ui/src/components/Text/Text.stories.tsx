import type { Meta, StoryObj } from "@storybook/react-vite";
import { Text } from "./Text";

const meta = {
  title: "Components/Text",
  component: Text,
  parameters: { layout: "centered" },
  args: { children: "学び、つながり、共有するコミュニティ。" },
} satisfies Meta<typeof Text>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const SizesAndTone: Story = {
  render: () => (
    <div className="gdg-stack">
      <Text size="md">本文のテキスト</Text>
      <Text size="sm">操作や補足に使うテキスト</Text>
      <Text size="xs" tone="muted">
        状態や時刻に使う補助テキスト
      </Text>
    </div>
  ),
};
