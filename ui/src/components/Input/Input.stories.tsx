import type { Meta, StoryObj } from "@storybook/react-vite";
import { Input } from "./Input";

const meta = {
  title: "Components/Input",
  component: Input,
  parameters: { layout: "centered" },
  args: { placeholder: "入力してください" },
} satisfies Meta<typeof Input>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const States: Story = {
  render: () => (
    <div className="gdg-stack" style={{ width: 320 }}>
      <Input defaultValue="入力済み" aria-label="入力済み" />
      <Input defaultValue="読み取り専用" readOnly aria-label="読み取り専用" />
      <Input defaultValue="利用できません" disabled aria-label="無効" />
    </div>
  ),
};
