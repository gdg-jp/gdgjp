import type { Meta, StoryObj } from "@storybook/react-vite";
import { Progress, ProgressIndicator } from "./Progress";

const meta = {
  title: "Components/Progress",
  component: Progress,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Progress>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Determinate: Story = {
  render: () => (
    <Progress value={68} aria-label="アップロードの進捗" style={{ width: 320 }}>
      <ProgressIndicator />
    </Progress>
  ),
};

export const Indeterminate: Story = {
  render: () => (
    <Progress value={null} aria-label="処理中" style={{ width: 320 }}>
      <ProgressIndicator />
    </Progress>
  ),
};
