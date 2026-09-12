import type { Meta, StoryObj } from "@storybook/react-vite";
import { FormField } from "../FormField";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./Select";

const meta = {
  title: "Components/Select",
  component: Select,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Select>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <FormField label="開催形式" description="参加方法を選択してください。">
      <Select defaultValue="hybrid">
        <SelectTrigger>
          <SelectValue placeholder="形式を選択" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="venue">会場</SelectItem>
          <SelectItem value="online">オンライン</SelectItem>
          <SelectItem value="hybrid">ハイブリッド</SelectItem>
        </SelectContent>
      </Select>
    </FormField>
  ),
};
