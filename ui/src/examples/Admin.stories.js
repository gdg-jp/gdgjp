import {
  CalendarDays,
  Link2,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as UI from "../index.ts";
const pages = [
  { id: "events", label: "イベント", icon: CalendarDays },
  { id: "links", label: "リンク", icon: Link2 },
  { id: "members", label: "メンバー", icon: Users },
  { id: "settings", label: "設定", icon: Settings },
];
const eventFormats = [
  { value: "all", label: "すべての開催形式" },
  { value: "venue", label: "会場" },
  { value: "online", label: "オンライン" },
  { value: "hybrid", label: "ハイブリッド" },
];
function isEventFormat(value) {
  return eventFormats.some((format) => format.value === value);
}
function pageFromHash(hash) {
  const id = hash.slice(1);
  return pages.some((page) => page.id === id) ? id : "events";
}
function OtherPage({ page }) {
  if (page === "links")
    return _jsxs(UI.Stack, {
      id: "links",
      children: [
        _jsx(UI.PageHeader, {
          title: "\u30EA\u30F3\u30AF",
          description:
            "\u30B3\u30DF\u30E5\u30CB\u30C6\u30A3\u3067\u5171\u6709\u3059\u308B\u30EA\u30F3\u30AF\u3092\u7BA1\u7406\u3057\u307E\u3059\u3002",
        }),
        _jsx(UI.Card, {
          children: _jsxs(UI.Stack, {
            children: [
              _jsx(UI.Heading, {
                level: 2,
                children: "\u516C\u958B\u4E2D\u306E\u30EA\u30F3\u30AF",
              }),
              _jsx(UI.Link, { href: "https://gdg.community.dev/", children: "GDG Community" }),
              _jsx(UI.Text, {
                size: "sm",
                tone: "muted",
                children:
                  "\u30A4\u30D9\u30F3\u30C8\u3084\u30B3\u30DF\u30E5\u30CB\u30C6\u30A3\u306E\u6700\u65B0\u60C5\u5831\u3078\u6848\u5185\u3057\u307E\u3059\u3002",
              }),
            ],
          }),
        }),
      ],
    });
  if (page === "members")
    return _jsxs(UI.Stack, {
      id: "members",
      children: [
        _jsx(UI.PageHeader, {
          title: "\u30E1\u30F3\u30D0\u30FC",
          description:
            "\u904B\u55B6\u30E1\u30F3\u30D0\u30FC\u3068\u6A29\u9650\u3092\u78BA\u8A8D\u3057\u307E\u3059\u3002",
        }),
        _jsx(UI.Card, {
          children: _jsxs(UI.Stack, {
            children: [
              _jsx(UI.Heading, { level: 2, children: "\u904B\u55B6\u30C1\u30FC\u30E0" }),
              _jsxs(UI.Inline, {
                children: [
                  _jsx(UI.Avatar, {
                    alt: "\u30B5\u30F3\u30D7\u30EB\u30E6\u30FC\u30B6\u30FC",
                    fallback: "GD",
                  }),
                  _jsxs("div", {
                    children: [
                      _jsx(UI.Text, {
                        children: "\u30B5\u30F3\u30D7\u30EB\u30E6\u30FC\u30B6\u30FC",
                      }),
                      _jsx(UI.Text, {
                        size: "sm",
                        tone: "muted",
                        children: "\u30AA\u30FC\u30AC\u30CA\u30A4\u30B6\u30FC",
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        }),
      ],
    });
  return _jsxs(UI.Stack, {
    id: "settings",
    children: [
      _jsx(UI.PageHeader, {
        title: "\u8A2D\u5B9A",
        description:
          "\u30B3\u30DF\u30E5\u30CB\u30C6\u30A3\u306E\u57FA\u672C\u60C5\u5831\u3092\u7DE8\u96C6\u3057\u307E\u3059\u3002",
      }),
      _jsx(UI.Card, {
        children: _jsxs(UI.Stack, {
          children: [
            _jsx(UI.FormField, {
              label: "\u30B3\u30DF\u30E5\u30CB\u30C6\u30A3\u540D",
              children: _jsx(UI.Input, { defaultValue: "GDG Apps" }),
            }),
            _jsx(UI.FormField, {
              label: "\u8AAC\u660E",
              children: _jsx(UI.Textarea, {
                defaultValue:
                  "\u958B\u767A\u8005\u540C\u58EB\u3067\u5B66\u3073\u3001\u3064\u306A\u304C\u308B\u30B3\u30DF\u30E5\u30CB\u30C6\u30A3\u3067\u3059\u3002",
              }),
            }),
            _jsx(UI.Inline, {
              children: _jsx(UI.Button, { children: "\u5909\u66F4\u3092\u4FDD\u5B58" }),
            }),
          ],
        }),
      }),
    ],
  });
}
export function AdminDemo() {
  const [page, setPage] = useState("events");
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState("all");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState("コミュニティミートアップ");
  const [deleted, setDeleted] = useState(false);
  useEffect(() => {
    const syncPage = () => setPage(pageFromHash(window.location.hash));
    syncPage();
    window.addEventListener("hashchange", syncPage);
    return () => window.removeEventListener("hashchange", syncPage);
  }, []);
  const showEvent =
    !deleted && (!query || name.includes(query)) && (format === "all" || format === "hybrid");
  const navigation = (onNavigate) =>
    _jsx(UI.SidebarMenu, {
      children: pages.map(({ id, label, icon: Icon }) =>
        _jsx(
          UI.SidebarMenuItem,
          {
            children: _jsx(UI.SidebarMenuButton, {
              asChild: true,
              isActive: page === id,
              children: _jsxs("a", {
                href: `#${id}`,
                "aria-current": page === id ? "page" : undefined,
                onClick: onNavigate,
                children: [
                  _jsx(Icon, { size: 18, "aria-hidden": "true" }),
                  _jsx("span", { children: label }),
                ],
              }),
            }),
          },
          id,
        ),
      ),
    });
  return _jsxs(UI.SidebarProvider, {
    className: "gdg-shell",
    defaultOpen: true,
    children: [
      _jsx("a", {
        className: "gdg-skip-link",
        href: "#gdg-main",
        children: "\u672C\u6587\u3078\u79FB\u52D5",
      }),
      _jsxs(UI.Sidebar, {
        "aria-label": "\u30E1\u30A4\u30F3\u30CA\u30D3\u30B2\u30FC\u30B7\u30E7\u30F3",
        collapsible: "icon",
        children: [
          _jsxs(UI.SidebarHeader, {
            children: [
              _jsx("strong", { className: "gdg-sidebar-title", children: "GDG Apps" }),
              _jsx(UI.SidebarTrigger, {}),
            ],
          }),
          _jsx(UI.SidebarContent, {
            children: _jsxs(UI.SidebarGroup, {
              children: [
                _jsx(UI.SidebarGroupLabel, { children: "\u30E1\u30A4\u30F3" }),
                _jsx(UI.SidebarGroupContent, { children: navigation() }),
              ],
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
                children: _jsxs(UI.Sheet, {
                  open: mobileNavOpen,
                  onOpenChange: setMobileNavOpen,
                  children: [
                    _jsx(UI.SheetTrigger, {
                      asChild: true,
                      children: _jsx(UI.IconButton, {
                        variant: "ghost",
                        "aria-label": "\u30CA\u30D3\u30B2\u30FC\u30B7\u30E7\u30F3",
                        children: _jsx(Menu, { size: 20 }),
                      }),
                    }),
                    _jsxs(UI.SheetContent, {
                      children: [
                        _jsx(UI.SheetTitle, {
                          children: "\u30CA\u30D3\u30B2\u30FC\u30B7\u30E7\u30F3",
                        }),
                        _jsx(UI.SheetDescription, {
                          children:
                            "\u79FB\u52D5\u5148\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
                        }),
                        _jsx(UI.SidebarGroup, {
                          children: _jsx(UI.SidebarGroupContent, {
                            children: navigation(() => setMobileNavOpen(false)),
                          }),
                        }),
                        _jsx(UI.SheetClose, {
                          asChild: true,
                          children: _jsx(UI.Button, {
                            variant: "outline",
                            children: "\u9589\u3058\u308B",
                          }),
                        }),
                      ],
                    }),
                  ],
                }),
              }),
              _jsx(UI.Text, {
                size: "sm",
                tone: "muted",
                children:
                  "\u30C7\u30B6\u30A4\u30F3\u30B7\u30B9\u30C6\u30E0 / \u30B5\u30F3\u30D7\u30EB",
              }),
              _jsx(UI.ThemeToggle, {}),
              _jsx(UI.Avatar, {
                alt: "\u30B5\u30F3\u30D7\u30EB\u30E6\u30FC\u30B6\u30FC",
                fallback: "GD",
              }),
            ],
          }),
          _jsxs(UI.SidebarInset, {
            id: "gdg-main",
            className: "gdg-main",
            tabIndex: -1,
            children: [
              page === "events"
                ? _jsxs(UI.Stack, {
                    id: "events",
                    children: [
                      _jsx(UI.PageHeader, {
                        title: "\u30A4\u30D9\u30F3\u30C8",
                        description:
                          "\u30B3\u30DF\u30E5\u30CB\u30C6\u30A3\u306E\u6B21\u306E\u4E00\u6B69\u3092\u3001\u3053\u3053\u304B\u3089\u3002",
                        actions: _jsxs(UI.Button, {
                          onClick: () => setEdit(true),
                          children: [
                            _jsx(Plus, { size: 16 }),
                            "\u30A4\u30D9\u30F3\u30C8\u3092\u4F5C\u6210",
                          ],
                        }),
                      }),
                      _jsx("div", {
                        className: "gdg-stat-grid",
                        children: [
                          ["開催予定", "3", "次回は9月26日"],
                          ["参加登録", "128", "コミュニティ全体"],
                          ["公開中のリンク", "24", "最新の情報を共有"],
                        ].map(([label, value, description]) =>
                          _jsxs(
                            UI.Card,
                            {
                              children: [
                                _jsx(UI.Text, { tone: "muted", size: "sm", children: label }),
                                _jsx("p", { className: "gdg-stat-value", children: value }),
                                _jsx(UI.Text, { size: "sm", tone: "muted", children: description }),
                              ],
                            },
                            label,
                          ),
                        ),
                      }),
                      _jsx(UI.Card, {
                        children: _jsxs(UI.Stack, {
                          children: [
                            _jsxs(UI.Toolbar, {
                              children: [
                                _jsx(UI.Heading, {
                                  level: 2,
                                  children: "\u30A4\u30D9\u30F3\u30C8\u4E00\u89A7",
                                }),
                                _jsxs(UI.Inline, {
                                  children: [
                                    _jsx(Search, { size: 18, "aria-hidden": "true" }),
                                    _jsx(UI.Input, {
                                      "aria-label": "\u30A4\u30D9\u30F3\u30C8\u3092\u691C\u7D22",
                                      placeholder: "\u30A4\u30D9\u30F3\u30C8\u3092\u691C\u7D22",
                                      value: query,
                                      onChange: (e) => setQuery(e.target.value),
                                    }),
                                    _jsxs(UI.Select, {
                                      value: format,
                                      onValueChange: (value) => {
                                        if (isEventFormat(value)) setFormat(value);
                                      },
                                      children: [
                                        _jsx(UI.SelectTrigger, {
                                          "aria-label": "\u958B\u50AC\u5F62\u5F0F",
                                          children: _jsx(UI.SelectValue, {}),
                                        }),
                                        _jsx(UI.SelectContent, {
                                          children: eventFormats.map((option) =>
                                            _jsx(
                                              UI.SelectItem,
                                              { value: option.value, children: option.label },
                                              option.value,
                                            ),
                                          ),
                                        }),
                                      ],
                                    }),
                                  ],
                                }),
                              ],
                            }),
                            !showEvent
                              ? _jsx(UI.EmptyState, {
                                  title:
                                    "\u30A4\u30D9\u30F3\u30C8\u304C\u3042\u308A\u307E\u305B\u3093",
                                  description:
                                    "\u6761\u4EF6\u3092\u5909\u3048\u308B\u304B\u3001\u65B0\u3057\u3044\u30A4\u30D9\u30F3\u30C8\u3092\u4F5C\u6210\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
                                })
                              : _jsxs(UI.Table, {
                                  children: [
                                    _jsx("caption", {
                                      className: "gdg-sr-only",
                                      children:
                                        "\u958B\u50AC\u4E88\u5B9A\u306E\u30A4\u30D9\u30F3\u30C8",
                                    }),
                                    _jsx("thead", {
                                      children: _jsxs("tr", {
                                        children: [
                                          _jsx("th", {
                                            scope: "col",
                                            children: "\u30A4\u30D9\u30F3\u30C8\u540D",
                                          }),
                                          _jsx("th", {
                                            scope: "col",
                                            children: "\u958B\u50AC\u65E5",
                                          }),
                                          _jsx("th", { scope: "col", children: "\u72B6\u614B" }),
                                          _jsx("th", { scope: "col", children: "\u64CD\u4F5C" }),
                                        ],
                                      }),
                                    }),
                                    _jsx("tbody", {
                                      children: _jsxs("tr", {
                                        children: [
                                          _jsxs("td", {
                                            children: [
                                              _jsx(UI.Link, { href: "#event", children: name }),
                                              _jsx(UI.Text, {
                                                size: "xs",
                                                tone: "muted",
                                                children:
                                                  "\u958B\u767A\u8005\u540C\u58EB\u3067\u5B66\u3073\u3001\u3064\u306A\u304C\u308B\u4E00\u65E5",
                                              }),
                                            ],
                                          }),
                                          _jsx("td", { children: "2026/09/26" }),
                                          _jsx("td", {
                                            children: _jsx(UI.Badge, {
                                              tone: "success",
                                              children: "\u516C\u958B\u4E2D",
                                            }),
                                          }),
                                          _jsx("td", {
                                            children: _jsxs(UI.DropdownMenu, {
                                              children: [
                                                _jsx(UI.DropdownMenuTrigger, {
                                                  asChild: true,
                                                  children: _jsx(UI.IconButton, {
                                                    "aria-label":
                                                      "\u30A4\u30D9\u30F3\u30C8\u64CD\u4F5C",
                                                    variant: "ghost",
                                                    children: _jsx(MoreHorizontal, { size: 18 }),
                                                  }),
                                                }),
                                                _jsxs(UI.DropdownMenuContent, {
                                                  children: [
                                                    _jsx(UI.DropdownMenuItem, {
                                                      onSelect: () => setEdit(true),
                                                      children: "\u7DE8\u96C6",
                                                    }),
                                                    _jsx(UI.DropdownMenuItem, {
                                                      onSelect: () =>
                                                        UI.toast("リンクをコピーしました"),
                                                      children:
                                                        "\u30EA\u30F3\u30AF\u3092\u30B3\u30D4\u30FC",
                                                    }),
                                                  ],
                                                }),
                                              ],
                                            }),
                                          }),
                                        ],
                                      }),
                                    }),
                                  ],
                                }),
                            _jsxs(UI.Toolbar, {
                              children: [
                                _jsxs(UI.Text, {
                                  size: "sm",
                                  tone: "muted",
                                  children: [
                                    showEvent ? 1 : 0,
                                    " \u4EF6\u306E\u30A4\u30D9\u30F3\u30C8",
                                  ],
                                }),
                                _jsx(UI.Pagination, {
                                  page: 1,
                                  pageCount: 1,
                                  onPageChange: () => {},
                                }),
                              ],
                            }),
                          ],
                        }),
                      }),
                      _jsx(UI.Alert, {
                        tone: "info",
                        title: "\u3053\u308C\u306F\u30B5\u30F3\u30D7\u30EB\u753B\u9762\u3067\u3059",
                        children:
                          "\u67B6\u7A7A\u306E\u30C7\u30FC\u30BF\u3092\u4F7F\u7528\u3057\u3066\u3044\u307E\u3059\u3002\u64CD\u4F5C\u306F\u3053\u306E\u753B\u9762\u5185\u3060\u3051\u306B\u53CD\u6620\u3055\u308C\u307E\u3059\u3002",
                      }),
                      _jsxs(UI.AlertDialog, {
                        children: [
                          _jsx(UI.AlertDialogTrigger, {
                            asChild: true,
                            children: _jsx(UI.Button, {
                              variant: "ghost",
                              children: "\u30A4\u30D9\u30F3\u30C8\u3092\u524A\u9664",
                            }),
                          }),
                          _jsxs(UI.AlertDialogContent, {
                            children: [
                              _jsx(UI.AlertDialogTitle, {
                                children:
                                  "\u30A4\u30D9\u30F3\u30C8\u3092\u524A\u9664\u3057\u307E\u3059\u304B\uFF1F",
                              }),
                              _jsx(UI.AlertDialogDescription, {
                                children:
                                  "\u3053\u306E\u30B5\u30F3\u30D7\u30EB\u4E00\u89A7\u304B\u3089\u30A4\u30D9\u30F3\u30C8\u3092\u53D6\u308A\u9664\u304D\u307E\u3059\u3002",
                              }),
                              _jsxs(UI.Inline, {
                                children: [
                                  _jsx(UI.AlertDialogCancel, {
                                    asChild: true,
                                    children: _jsx(UI.Button, {
                                      variant: "outline",
                                      children: "\u30AD\u30E3\u30F3\u30BB\u30EB",
                                    }),
                                  }),
                                  _jsx(UI.AlertDialogAction, {
                                    asChild: true,
                                    children: _jsx(UI.Button, {
                                      variant: "danger",
                                      onClick: () => {
                                        setDeleted(true);
                                        UI.toast.success("削除しました");
                                      },
                                      children: "\u524A\u9664\u3059\u308B",
                                    }),
                                  }),
                                ],
                              }),
                            ],
                          }),
                        ],
                      }),
                    ],
                  })
                : _jsx(OtherPage, { page: page }),
              _jsx(UI.Dialog, {
                open: edit,
                onOpenChange: setEdit,
                children: _jsxs(UI.DialogContent, {
                  children: [
                    _jsx(UI.DialogTitle, {
                      children: "\u30A4\u30D9\u30F3\u30C8\u3092\u7DE8\u96C6",
                    }),
                    _jsx(UI.DialogDescription, {
                      children:
                        "\u53C2\u52A0\u8005\u306B\u4F1D\u308F\u308B\u540D\u524D\u3092\u8A2D\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
                    }),
                    _jsx("form", {
                      onSubmit: (e) => {
                        e.preventDefault();
                        setEdit(false);
                        setDeleted(false);
                        UI.toast.success("保存しました");
                      },
                      children: _jsxs(UI.Stack, {
                        children: [
                          _jsx(UI.FormField, {
                            label: "\u30A4\u30D9\u30F3\u30C8\u540D",
                            required: true,
                            children: _jsx(UI.Input, {
                              value: name,
                              onChange: (e) => setName(e.target.value),
                            }),
                          }),
                          _jsx(UI.FormField, {
                            label: "\u8AAC\u660E",
                            description:
                              "\u53C2\u52A0\u8005\u306B\u8868\u793A\u3059\u308B\u77ED\u3044\u8AAC\u660E\u3067\u3059\u3002",
                            children: _jsx(UI.Textarea, {
                              defaultValue:
                                "\u958B\u767A\u8005\u540C\u58EB\u3067\u5B66\u3073\u3001\u3064\u306A\u304C\u308B\u4E00\u65E5",
                            }),
                          }),
                          _jsxs(UI.Inline, {
                            children: [
                              _jsx(UI.Button, { type: "submit", children: "\u4FDD\u5B58" }),
                              _jsx(UI.DialogClose, {
                                asChild: true,
                                children: _jsx(UI.Button, {
                                  variant: "outline",
                                  children: "\u30AD\u30E3\u30F3\u30BB\u30EB",
                                }),
                              }),
                            ],
                          }),
                        ],
                      }),
                    }),
                  ],
                }),
              }),
              _jsx(UI.Toaster, {}),
            ],
          }),
        ],
      }),
    ],
  });
}
const meta = { title: "Patterns/Admin", component: AdminDemo };
export default meta;
export const Default = {};
