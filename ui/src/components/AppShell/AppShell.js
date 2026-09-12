import { Menu } from "lucide-react";
import { useEffect, useState } from "react";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from "../Button";
import { IconButton } from "../IconButton";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "../Sheet";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
} from "../Sidebar";
export function AppShell({
  navigation,
  header,
  children,
  brand,
  navigationLabel = "ナビゲーション",
}) {
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window === "undefined" || window.innerWidth >= 768,
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const syncSidebar = () => setSidebarOpen(media.matches);
    syncSidebar();
    media.addEventListener("change", syncSidebar);
    return () => media.removeEventListener("change", syncSidebar);
  }, []);
  return _jsxs(SidebarProvider, {
    className: "gdg-shell",
    open: sidebarOpen,
    onOpenChange: setSidebarOpen,
    children: [
      _jsx("a", {
        className: "gdg-skip-link",
        href: "#gdg-main",
        children: "\u672C\u6587\u3078\u79FB\u52D5",
      }),
      _jsxs(Sidebar, {
        "aria-label": navigationLabel,
        collapsible: "offcanvas",
        children: [
          _jsx(SidebarHeader, {
            children: _jsx("div", { className: "gdg-sidebar-title", children: brand }),
          }),
          _jsx(SidebarContent, {
            children: _jsx(SidebarGroup, {
              children: _jsx(SidebarGroupContent, { children: navigation }),
            }),
          }),
        ],
      }),
      _jsxs("div", {
        className: "gdg-shell-body",
        children: [
          _jsxs("header", {
            className: "gdg-shell-header",
            children: [
              _jsx("div", {
                className: "gdg-mobile-only",
                children: _jsxs(Sheet, {
                  open: mobileNavOpen,
                  onOpenChange: setMobileNavOpen,
                  children: [
                    _jsx(SheetTrigger, {
                      asChild: true,
                      children: _jsx(IconButton, {
                        variant: "ghost",
                        "aria-label": navigationLabel,
                        children: _jsx(Menu, { size: 20 }),
                      }),
                    }),
                    _jsxs(SheetContent, {
                      children: [
                        _jsx(SheetTitle, { children: navigationLabel }),
                        _jsx(SheetDescription, {
                          children:
                            "\u79FB\u52D5\u5148\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
                        }),
                        _jsx("div", {
                          onClick: (e) => {
                            if (e.target.closest("a")) setMobileNavOpen(false);
                          },
                          onKeyDown: (e) => {
                            if (e.key === "Enter" && e.target.closest("a")) setMobileNavOpen(false);
                          },
                          children: navigation,
                        }),
                        _jsx(SheetClose, {
                          asChild: true,
                          children: _jsx(Button, {
                            variant: "outline",
                            children: "\u9589\u3058\u308B",
                          }),
                        }),
                      ],
                    }),
                  ],
                }),
              }),
              header,
            ],
          }),
          _jsx(SidebarInset, {
            id: "gdg-main",
            tabIndex: -1,
            className: "gdg-main",
            children: children,
          }),
        ],
      }),
    ],
  });
}
