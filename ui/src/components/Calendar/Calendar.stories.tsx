import type { Meta, StoryObj } from "@storybook/react-vite";
import { Calendar } from "./Calendar";

const meta = {
  title: "Components/Calendar",
  component: Calendar,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Calendar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Single: Story = {
  args: { defaultMonth: new Date(2026, 8, 1), defaultSelected: new Date(2026, 8, 12) },
};

export const Range: Story = {
  args: {
    mode: "range",
    defaultMonth: new Date(2026, 8, 1),
    defaultSelected: { from: new Date(2026, 8, 8), to: new Date(2026, 8, 12) },
  },
};
