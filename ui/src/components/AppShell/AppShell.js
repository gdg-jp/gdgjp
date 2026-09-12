import { Menu } from "lucide-react";
import { useState } from "react";
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
  SidebarTrigger,
} from "../Sidebar";
export function AppShell({
  navigation,
  header,
  children,
  brand,
  navigationLabel = "ナビゲーション",
  navigationDescription = "移動先を選択してください。",
  closeNavigationLabel = "閉じる",
  skipLinkLabel = "本文へ移動",
  collapsible = "icon",
  defaultSidebarOpen = true,
  sidebarOpen,
  onSidebarOpenChange,
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  return _jsxs(SidebarProvider, {
    className: "gdg-shell",
    defaultOpen: defaultSidebarOpen,
    open: sidebarOpen,
    onOpenChange: onSidebarOpenChange,
    children: [
      _jsx("a", { className: "gdg-skip-link", href: "#gdg-main", children: skipLinkLabel }),
      _jsxs(Sidebar, {
        "aria-label": navigationLabel,
        collapsible: collapsible,
        children: [
          _jsxs(SidebarHeader, {
            children: [
              _jsx("div", { className: "gdg-sidebar-title", children: brand }),
              _jsx(SidebarTrigger, {}),
            ],
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
                        _jsx(SheetDescription, { children: navigationDescription }),
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
                            children: closeNavigationLabel,
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
