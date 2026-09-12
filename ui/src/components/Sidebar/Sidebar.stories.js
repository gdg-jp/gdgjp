import { CalendarDays, Settings } from "lucide-react";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
};
export default meta;
export const Navigation = {
  render: () =>
    _jsxs(SidebarProvider, {
      style: { minHeight: 360 },
      children: [
        _jsxs(Sidebar, {
          children: [
            _jsxs(SidebarHeader, {
              children: [
                _jsx("strong", { className: "gdg-sidebar-title", children: "GDG Apps" }),
                _jsx(SidebarTrigger, {}),
              ],
            }),
            _jsx(SidebarContent, {
              children: _jsxs(SidebarGroup, {
                children: [
                  _jsx(SidebarGroupLabel, { children: "\u7BA1\u7406" }),
                  _jsx(SidebarGroupContent, {
                    children: _jsxs(SidebarMenu, {
                      children: [
                        _jsx(SidebarMenuItem, {
                          children: _jsxs(SidebarMenuButton, {
                            isActive: true,
                            children: [
                              _jsx(CalendarDays, { size: 16, "aria-hidden": "true" }),
                              "\u30A4\u30D9\u30F3\u30C8",
                            ],
                          }),
                        }),
                        _jsx(SidebarMenuItem, {
                          children: _jsxs(SidebarMenuButton, {
                            children: [
                              _jsx(Settings, { size: 16, "aria-hidden": "true" }),
                              "\u8A2D\u5B9A",
                            ],
                          }),
                        }),
                      ],
                    }),
                  }),
                ],
              }),
            }),
          ],
        }),
        _jsxs(SidebarInset, {
          children: [
            _jsx("h2", { style: { marginTop: 0 }, children: "\u30A4\u30D9\u30F3\u30C8" }),
            _jsx("p", {
              className: "gdg-muted",
              children:
                "\u30A4\u30D9\u30F3\u30C8\u4E00\u89A7\u3092\u7BA1\u7406\u3057\u307E\u3059\u3002",
            }),
          ],
        }),
      ],
    }),
};
