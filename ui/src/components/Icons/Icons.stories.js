import { Icons } from "./Icons";
const meta = {
  title: "Components/Icons",
  component: Icons,
  parameters: { layout: "centered" },
  args: { name: "Heart", size: 24, "aria-label": "お気に入り" },
};
export default meta;
export const Default = {};
export const Static = { args: { animateOnHover: false } };
export const Decorative = { args: { name: "Sparkles", "aria-hidden": true } };
