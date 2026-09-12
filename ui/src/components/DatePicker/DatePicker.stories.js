import { DatePicker } from "./DatePicker";
const meta = {
  title: "Components/DatePicker",
  component: DatePicker,
  parameters: { layout: "centered" },
};
export default meta;
export const Default = {
  args: {
    "aria-label": "日付",
    defaultValue: new Date(2026, 8, 12),
    calendarProps: { defaultMonth: new Date(2026, 8, 1) },
  },
};
