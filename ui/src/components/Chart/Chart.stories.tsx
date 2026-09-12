import type { Meta, StoryObj } from "@storybook/react-vite";
import { Chart } from "./Chart";

const meta = {
  title: "Components/Chart",
  component: Chart,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Chart>;
export default meta;
type Story = StoryObj<typeof meta>;

const data = [
  { label: "東京", value: 64 },
  { label: "大阪", value: 48 },
  { label: "札幌", value: 36 },
  { label: "福岡", value: 55 },
];

export const Bars: Story = { args: { data, style: { width: 420 } } };
export const Line: Story = {
  args: { data, type: "line", color: "var(--gdg-secondary)", style: { width: 420 } },
};
