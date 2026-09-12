import type { Meta, StoryObj } from "@storybook/react-vite";
import { Card } from "../Card";
import { Stack } from "./Stack";

const meta = {
  title: "Components/Stack",
  component: Stack,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Stack>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Stack style={{ width: 320 }}>
      <Card>一つ目の面</Card>
      <Card>二つ目の面</Card>
      <Card>三つ目の面</Card>
    </Stack>
  ),
};
