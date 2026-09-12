import type { Meta, StoryObj } from "@storybook/react-vite";
import { CalendarDays, Settings, Users } from "lucide-react";
import { AppShell } from "./AppShell";

const navigation = (
  <nav className="gdg-sidebar-nav" aria-label="メイン">
    <a href="#events" aria-current="page">
      <CalendarDays size={18} />
      イベント
    </a>
    <a href="#members">
      <Users size={18} />
      メンバー
    </a>
    <a href="#settings">
      <Settings size={18} />
      設定
    </a>
  </nav>
);

const meta = {
  title: "Components/AppShell",
  component: AppShell,
  parameters: { layout: "fullscreen" },
  args: {
    brand: "GDG Apps",
    navigation,
    header: <span className="gdg-muted">コミュニティ管理</span>,
    children: (
      <div className="gdg-stack">
        <h1 className="gdg-heading">イベント</h1>
        <p className="gdg-text">コミュニティの次の一歩を、ここから。</p>
      </div>
    ),
  },
} satisfies Meta<typeof AppShell>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
