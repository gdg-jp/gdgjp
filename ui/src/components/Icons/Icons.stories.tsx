import type { Meta, StoryObj } from "@storybook/react-vite";
import { Icons } from "./Icons";

const meta = {
  title: "Components/Icons",
  component: Icons,
  parameters: { layout: "centered" },
  args: { name: "Heart", size: 24, "aria-label": "お気に入り" },
} satisfies Meta<typeof Icons>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Static: Story = { args: { animateOnHover: false } };
export const Decorative: Story = { args: { name: "Sparkles", "aria-hidden": true } };
