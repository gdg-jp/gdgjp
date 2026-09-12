import type { Meta, StoryObj } from "@storybook/react-vite";
import { Input } from "../Input";
import { Label } from "./Label";

const meta = {
  title: "Components/Label",
  component: Label,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Label>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="gdg-field">
      <Label htmlFor="label-example">イベント名</Label>
      <Input id="label-example" placeholder="DevFest" />
    </div>
  ),
};
