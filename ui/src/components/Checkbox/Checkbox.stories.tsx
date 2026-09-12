import type { Meta, StoryObj } from "@storybook/react-vite";
import { Checkbox } from "./Checkbox";

const meta = {
  title: "Components/Checkbox",
  component: Checkbox,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Checkbox>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="gdg-inline">
      <Checkbox id="terms" />
      <label htmlFor="terms">参加規約に同意する</label>
    </div>
  ),
};

export const Checked: Story = {
  render: () => (
    <div className="gdg-inline">
      <Checkbox id="notifications" defaultChecked />
      <label htmlFor="notifications">通知を受け取る</label>
    </div>
  ),
};

export const Indeterminate: Story = {
  render: () => (
    <div className="gdg-inline">
      <Checkbox id="partial" defaultChecked="indeterminate" />
      <label htmlFor="partial">一部選択</label>
    </div>
  ),
};
