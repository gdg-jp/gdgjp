import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Calendar } from "./Calendar";

const meta = {
  title: "Components/Calendar",
  component: Calendar,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Calendar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Single: Story = {
  args: { defaultMonth: new Date(2026, 8, 1), defaultSelected: new Date(2026, 8, 12) },
};

export const Range: Story = {
  args: {
    mode: "range",
    defaultMonth: new Date(2026, 8, 1),
    defaultSelected: { from: new Date(2026, 8, 8), to: new Date(2026, 8, 12) },
  },
};

export const ControlledEmpty: Story = {
  args: {
    defaultMonth: new Date(2026, 8, 1, 12),
    defaultSelected: new Date(2026, 8, 12, 12),
    selected: undefined,
  },
};

function ControlledLifecycleStory() {
  const [selected, setSelected] = useState<Date | undefined>(new Date(2026, 8, 12, 12));
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button type="button" onClick={() => setSelected(undefined)}>
          Clear selection
        </button>
        <button type="button" onClick={() => setSelected(new Date(2026, 10, 3, 12))}>
          Replace selection
        </button>
      </div>
      <Calendar
        defaultMonth={new Date(2026, 8, 1, 12)}
        selected={selected}
        onSelect={(next) => setSelected(next instanceof Date ? next : undefined)}
      />
    </div>
  );
}

export const ControlledLifecycle: Story = { render: () => <ControlledLifecycleStory /> };
