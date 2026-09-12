import type { Meta, StoryObj } from "@storybook/react-vite";
import { Slider } from "./Slider";

const meta = {
  title: "Components/Slider",
  component: Slider,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Slider>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Volume: Story = {
  args: { defaultValue: [64], "aria-label": "音量", style: { width: 320 } },
};

export const Range: Story = {
  args: { defaultValue: [20, 80], "aria-label": "価格帯", style: { width: 320 } },
};
