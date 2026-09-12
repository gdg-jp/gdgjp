import type { Meta, StoryObj } from "@storybook/react-vite";
import { Kbd, KbdGroup } from "./Kbd";

const meta = {
  title: "Components/Kbd",
  component: Kbd,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Kbd>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Shortcut: Story = {
  render: () => (
    <KbdGroup aria-label="キーボードショートカット">
      <Kbd>⌘</Kbd>
      <Kbd>K</Kbd>
    </KbdGroup>
  ),
};
