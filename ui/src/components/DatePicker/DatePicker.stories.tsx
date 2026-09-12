import type { Meta, StoryObj } from "@storybook/react-vite";
import { DatePicker } from "./DatePicker";

const meta = {
  title: "Components/DatePicker",
  component: DatePicker,
  parameters: { layout: "centered" },
} satisfies Meta<typeof DatePicker>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    "aria-label": "日付",
    defaultValue: new Date(2026, 8, 12),
    calendarProps: { defaultMonth: new Date(2026, 8, 1) },
  },
};
