import type { Meta, StoryObj } from "@storybook/react-vite";
import { Toggle } from "./Toggle";

const meta = {
  title: "Components/Toggle",
  component: Toggle,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Toggle>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Pressed: Story = {
  args: { defaultPressed: true, "aria-label": "太字", children: "太字" },
};
