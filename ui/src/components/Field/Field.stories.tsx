import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../Button";
import { Input } from "../Input";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "./Field";

const meta = {
  title: "Components/Field",
  component: Field,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Field>;
export default meta;
type Story = StoryObj<typeof meta>;

export const FormSection: Story = {
  render: () => (
    <FieldSet style={{ width: 360 }}>
      <FieldLegend>プロフィール</FieldLegend>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="field-display-name">表示名</FieldLabel>
          <FieldContent>
            <Input id="field-display-name" defaultValue="GDG Japan" />
            <FieldDescription>参加者に表示される名前です。</FieldDescription>
          </FieldContent>
        </Field>
        <Field>
          <FieldLabel htmlFor="field-email">メールアドレス</FieldLabel>
          <Input id="field-email" aria-invalid="true" defaultValue="invalid" />
          <FieldError errors={[{ message: "メールアドレスの形式を確認してください。" }]} />
        </Field>
        <Button type="button">保存</Button>
      </FieldGroup>
    </FieldSet>
  ),
};
