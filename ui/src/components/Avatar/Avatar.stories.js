import { Avatar } from "./Avatar";
const meta = {
  title: "Components/Avatar",
  component: Avatar,
  parameters: { layout: "centered" },
  args: { alt: "GDG Japan", fallback: "GD" },
};
export default meta;
export const Fallback = {};
export const WithImage = {
  args: {
    src: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=96&fit=crop",
    alt: "プロフィール画像のサンプル",
    fallback: "サ",
  },
};
