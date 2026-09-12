import type { Meta, StoryObj } from "@storybook/react-vite";
import { FormField } from "../FormField";
import { NativeSelect, NativeSelectOption } from "./NativeSelect";

const meta = {
  title: "Components/NativeSelect",
  component: NativeSelect,
  parameters: { layout: "centered" },
} satisfies Meta<typeof NativeSelect>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <FormField label="開催地">
      <NativeSelect defaultValue="tokyo">
        <NativeSelectOption value="tokyo">Tokyo</NativeSelectOption>
        <NativeSelectOption value="osaka">Osaka</NativeSelectOption>
      </NativeSelect>
    </FormField>
  ),
};
