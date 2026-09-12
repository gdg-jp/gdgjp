import type { Meta, StoryObj } from "@storybook/react-vite";
import { Switch } from "./Switch";

const meta = {
  title: "Components/Switch",
  component: Switch,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Switch>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="gdg-inline">
      <Switch id="notifications-switch" defaultChecked />
      <label htmlFor="notifications-switch">通知を受け取る</label>
    </div>
  ),
};
