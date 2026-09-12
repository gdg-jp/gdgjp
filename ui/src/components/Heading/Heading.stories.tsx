import type { Meta, StoryObj } from "@storybook/react-vite";
import { Heading } from "./Heading";

const meta = {
  title: "Components/Heading",
  component: Heading,
  parameters: { layout: "centered" },
  args: { children: "GDG Apps のデザインシステム" },
} satisfies Meta<typeof Heading>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Levels: Story = {
  render: () => (
    <div className="gdg-stack">
      <Heading level={1}>見出し 1</Heading>
      <Heading level={2}>見出し 2</Heading>
      <Heading level={3}>見出し 3</Heading>
      <Heading level={4}>見出し 4</Heading>
      <Heading level={5}>見出し 5</Heading>
      <Heading level={6}>見出し 6</Heading>
    </div>
  ),
};
