import type { Meta, StoryObj } from "@storybook/react-vite";
import { CalendarDays, Settings } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "./Sidebar";

const meta = {
  title: "Components/Sidebar",
  component: Sidebar,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Sidebar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Navigation: Story = {
  render: () => (
    <SidebarProvider style={{ minHeight: 360 }}>
      <Sidebar>
        <SidebarHeader>
          <strong className="gdg-sidebar-title">GDG Apps</strong>
          <SidebarTrigger />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>管理</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive>
                    <CalendarDays size={16} aria-hidden="true" />
                    イベント
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton>
                    <Settings size={16} aria-hidden="true" />
                    設定
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <h2 style={{ marginTop: 0 }}>イベント</h2>
        <p className="gdg-muted">イベント一覧を管理します。</p>
      </SidebarInset>
    </SidebarProvider>
  ),
};
