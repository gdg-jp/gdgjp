import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button";

const meta = {
  title: "Components/Button",
  component: Button,
  parameters: { layout: "centered" },
  args: { children: "保存" },
} satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};
export const Variants: Story = {
  render: () => (
    <div className="gdg-inline">
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="danger">Danger</Button>
    </div>
  ),
};
export const Sizes: Story = {
  render: () => (
    <div className="gdg-inline">
      <Button size="sm">小</Button>
      <Button size="md">標準</Button>
      <Button size="lg">大</Button>
    </div>
  ),
};
export const Loading: Story = { args: { loading: true, children: "保存中" } };
export const AsLink: Story = {
  render: () => (
    <Button asChild variant="outline">
      <a href="#details">詳細を見る</a>
    </Button>
  ),
};
