import { Slider } from "./Slider";
const meta = {
  title: "Components/Slider",
  component: Slider,
  parameters: { layout: "centered" },
};
export default meta;
export const Volume = {
  args: { defaultValue: [64], "aria-label": "音量", style: { width: 320 } },
};
export const Range = {
  args: { defaultValue: [20, 80], "aria-label": "価格帯", style: { width: 320 } },
};
