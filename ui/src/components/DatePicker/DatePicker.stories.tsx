import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
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

export const ControlledEmpty: Story = {
  render: () => (
    <DatePicker
      aria-label="空の期限"
      value={undefined}
      defaultValue={new Date(2026, 8, 12, 12)}
      calendarProps={{ defaultMonth: new Date(2026, 8, 1, 12) }}
    />
  ),
};

function ControlledLifecycleStory() {
  const [value, setValue] = useState<Date | undefined>(new Date(2026, 8, 12, 12));
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button type="button" onClick={() => setValue(undefined)}>
          Clear value
        </button>
        <button type="button" onClick={() => setValue(new Date(2026, 10, 3, 12))}>
          Replace value
        </button>
      </div>
      <DatePicker
        aria-label="Controlled date"
        value={value}
        onChange={setValue}
        calendarProps={{ defaultMonth: new Date(2026, 8, 1, 12) }}
      />
      <output data-testid="date-picker-value">
        {value ? value.toLocaleDateString("sv-SE") : "(empty)"}
      </output>
    </div>
  );
}

export const ControlledLifecycle: Story = { render: () => <ControlledLifecycleStory /> };

export const RejectedChange: Story = {
  render: () => (
    <DatePicker
      aria-label="Rejected date"
      value={new Date(2026, 8, 12, 12)}
      onChange={() => {}}
      calendarProps={{ defaultMonth: new Date(2026, 8, 1, 12) }}
    />
  ),
};
