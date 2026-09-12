import { Calendar } from "./Calendar";
const meta = {
  title: "Components/Calendar",
  component: Calendar,
  parameters: { layout: "centered" },
};
export default meta;
export const Single = {
  args: { defaultMonth: new Date(2026, 8, 1), defaultSelected: new Date(2026, 8, 12) },
};
export const Range = {
  args: {
    mode: "range",
    defaultMonth: new Date(2026, 8, 1),
    defaultSelected: { from: new Date(2026, 8, 8), to: new Date(2026, 8, 12) },
  },
};
