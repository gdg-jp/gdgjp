import type { Meta, StoryObj } from "@storybook/react-vite";
import { CalendarDays, Link2, Settings } from "lucide-react";
import { SidebarNav } from "./SidebarNav";

const meta = {
  title: "Components/SidebarNav",
  component: SidebarNav,
  parameters: { layout: "centered" },
} satisfies Meta<typeof SidebarNav>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <SidebarNav aria-label="メインナビゲーション">
      <a href="#events" aria-current="page">
        <CalendarDays size={18} />
        イベント
      </a>
      <a href="#links">
        <Link2 size={18} />
        リンク
      </a>
      <a href="#settings">
        <Settings size={18} />
        設定
      </a>
    </SidebarNav>
  ),
};
