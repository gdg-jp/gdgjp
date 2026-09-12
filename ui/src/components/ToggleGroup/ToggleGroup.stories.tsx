import type { Meta, StoryObj } from "@storybook/react-vite";
import { ToggleGroup, ToggleGroupItem } from "./ToggleGroup";

const meta = {
  title: "Components/ToggleGroup",
  component: ToggleGroup,
  parameters: { layout: "centered" },
} satisfies Meta<typeof ToggleGroup>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Alignment: Story = {
  args: { type: "single" },
  render: () => (
    <ToggleGroup type="single" defaultValue="center" aria-label="配置">
      <ToggleGroupItem value="start">左</ToggleGroupItem>
      <ToggleGroupItem value="center">中央</ToggleGroupItem>
      <ToggleGroupItem value="end">右</ToggleGroupItem>
    </ToggleGroup>
  ),
};
