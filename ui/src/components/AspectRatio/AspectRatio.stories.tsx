import type { Meta, StoryObj } from "@storybook/react-vite";
import { AspectRatio } from "./AspectRatio";

const meta = {
  title: "Components/AspectRatio",
  component: AspectRatio,
  parameters: { layout: "centered" },
} satisfies Meta<typeof AspectRatio>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <AspectRatio ratio={4 / 3} style={{ width: 280 }}>
      <img
        alt="GDG Apps のプレースホルダー"
        src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 4 3'%3E%3Crect width='4' height='3' fill='%234285f4'/%3E%3Ctext x='2' y='1.7' fill='white' text-anchor='middle' font-size='.45'%3EGDG Apps%3C/text%3E%3C/svg%3E"
      />
    </AspectRatio>
  ),
};
