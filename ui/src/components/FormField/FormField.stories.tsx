import type { Meta, StoryObj } from "@storybook/react-vite";
import { Input } from "../Input";
import { Textarea } from "../Textarea";
import { FormField } from "./FormField";

const meta = {
  title: "Components/FormField",
  component: FormField,
  parameters: { layout: "centered" },
} satisfies Meta<typeof FormField>;
export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <FormField label="表示名" description="コミュニティで使う名前です。" required>
      <Input placeholder="例：GDG Japan" />
    </FormField>
  ),
};

export const Invalid: Story = {
  render: () => (
    <FormField
      id="email"
      label="メールアドレス"
      description="登録情報の更新に使います。"
      error="メールアドレスの形式を確認してください。"
    >
      <Input type="email" defaultValue="invalid" />
    </FormField>
  ),
};

export const TextareaField: Story = {
  render: () => (
    <FormField label="説明">
      <Textarea placeholder="イベントの説明を入力" />
    </FormField>
  ),
};
