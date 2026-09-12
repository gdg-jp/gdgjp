import type { Meta, StoryObj } from "@storybook/react-vite";
import { ThemeToggle } from "./theme";

const meta = {
  title: "Theme/ThemeToggle",
  component: ThemeToggle,
  parameters: { layout: "centered" },
} satisfies Meta<typeof ThemeToggle>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
