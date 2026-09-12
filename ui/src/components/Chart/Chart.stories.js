import { Chart } from "./Chart";
const meta = {
  title: "Components/Chart",
  component: Chart,
  parameters: { layout: "centered" },
};
export default meta;
const data = [
  { label: "東京", value: 64 },
  { label: "大阪", value: 48 },
  { label: "札幌", value: 36 },
  { label: "福岡", value: 55 },
];
export const Bars = { args: { data, style: { width: 420 } } };
export const Line = {
  args: { data, type: "line", color: "var(--gdg-secondary)", style: { width: 420 } },
};
