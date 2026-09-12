import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as UI from "../index.ts";
function Catalog() {
  return _jsxs("div", {
    className: "gdg-catalog",
    children: [
      _jsx(UI.PageHeader, {
        title: "GDG Apps",
        description:
          "\u660E\u77AD\u3067\u3001\u89AA\u3057\u307F\u3084\u3059\u304F\u3001\u4E00\u8CAB\u3057\u305F\u30A4\u30F3\u30BF\u30FC\u30D5\u30A7\u30FC\u30B9\u3002",
      }),
      _jsx(UI.Card, {
        children: _jsxs(UI.Stack, {
          children: [
            _jsx(UI.Heading, { children: "\u64CD\u4F5C" }),
            ["primary", "secondary", "outline", "ghost", "danger"].map((variant) =>
              _jsxs(
                UI.Inline,
                {
                  children: [
                    _jsx(UI.Button, { variant: variant, children: variant }),
                    _jsx(UI.Button, { variant: variant, disabled: true, children: "\u7121\u52B9" }),
                    _jsx(UI.Button, {
                      variant: variant,
                      loading: true,
                      children: "\u4FDD\u5B58\u4E2D",
                    }),
                  ],
                },
                variant,
              ),
            ),
            _jsxs(UI.Inline, {
              children: [
                _jsx(UI.Button, { size: "sm", children: "\u5C0F" }),
                _jsx(UI.Button, { children: "\u6A19\u6E96" }),
                _jsx(UI.Button, { size: "lg", children: "\u5927" }),
                _jsx(UI.Button, {
                  asChild: true,
                  children: _jsx("a", {
                    href: "#link",
                    children: "\u30EA\u30F3\u30AF\u30DC\u30BF\u30F3",
                  }),
                }),
              ],
            }),
          ],
        }),
      }),
      _jsx(UI.Card, {
        children: _jsxs(UI.Stack, {
          children: [
            _jsx(UI.Heading, { children: "\u30D5\u30A9\u30FC\u30E0" }),
            _jsx(UI.FormField, {
              label: "\u8868\u793A\u540D",
              description:
                "\u30B3\u30DF\u30E5\u30CB\u30C6\u30A3\u3067\u4F7F\u3046\u540D\u524D\u3067\u3059\u3002",
              required: true,
              children: _jsx(UI.Input, { placeholder: "\u4F8B\uFF1AGDG Japan" }),
            }),
            _jsx(UI.FormField, {
              label: "\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9",
              error:
                "\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9\u306E\u5F62\u5F0F\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
              children: _jsx(UI.Input, { type: "email", defaultValue: "invalid" }),
            }),
            _jsx(UI.FormField, {
              label: "\u8AAD\u307F\u53D6\u308A\u5C02\u7528",
              children: _jsx(UI.Input, {
                readOnly: true,
                value: "\u5909\u66F4\u3067\u304D\u306A\u3044\u5185\u5BB9",
              }),
            }),
            _jsx(UI.FormField, {
              label: "\u7121\u52B9\u306A\u5165\u529B",
              disabled: true,
              children: _jsx(UI.Input, {
                value: "\u5229\u7528\u3067\u304D\u307E\u305B\u3093",
                readOnly: true,
              }),
            }),
            _jsx(UI.FormField, { label: "\u8AAC\u660E", children: _jsx(UI.Textarea, {}) }),
            _jsx(UI.FormField, {
              label: "\u516C\u958B\u8A2D\u5B9A",
              children: _jsxs(UI.Select, {
                defaultValue: "draft",
                children: [
                  _jsx(UI.SelectTrigger, { children: _jsx(UI.SelectValue, {}) }),
                  _jsxs(UI.SelectContent, {
                    children: [
                      _jsx(UI.SelectItem, { value: "draft", children: "\u4E0B\u66F8\u304D" }),
                      _jsx(UI.SelectItem, { value: "public", children: "\u516C\u958B" }),
                    ],
                  }),
                ],
              }),
            }),
            _jsxs(UI.Inline, {
              children: [
                _jsx(UI.Checkbox, { id: "agree" }),
                _jsx("label", {
                  htmlFor: "agree",
                  children: "\u53C2\u52A0\u898F\u7D04\u306B\u540C\u610F\u3059\u308B",
                }),
                _jsx(UI.Switch, { id: "notify" }),
                _jsx("label", {
                  htmlFor: "notify",
                  children: "\u901A\u77E5\u3092\u53D7\u3051\u53D6\u308B",
                }),
              ],
            }),
            _jsx(UI.RadioGroup, {
              "aria-label": "\u53C2\u52A0\u65B9\u6CD5",
              defaultValue: "venue",
              children: _jsxs(UI.Inline, {
                children: [
                  _jsx(UI.RadioGroupItem, { value: "venue", id: "venue" }),
                  _jsx("label", { htmlFor: "venue", children: "\u4F1A\u5834" }),
                  _jsx(UI.RadioGroupItem, { value: "online", id: "online" }),
                  _jsx("label", { htmlFor: "online", children: "\u30AA\u30F3\u30E9\u30A4\u30F3" }),
                ],
              }),
            }),
          ],
        }),
      }),
      _jsx(UI.Card, {
        children: _jsxs(UI.Stack, {
          children: [
            _jsx(UI.Heading, { children: "\u30AA\u30FC\u30D0\u30FC\u30EC\u30A4" }),
            _jsxs(UI.Inline, {
              children: [
                _jsxs(UI.Dialog, {
                  children: [
                    _jsx(UI.DialogTrigger, {
                      asChild: true,
                      children: _jsx(UI.Button, { children: "Dialog" }),
                    }),
                    _jsxs(UI.DialogContent, {
                      children: [
                        _jsx(UI.DialogTitle, { children: "\u78BA\u8A8D\u3068\u7DE8\u96C6" }),
                        _jsx(UI.DialogDescription, {
                          children:
                            "Esc\u3067\u9589\u3058\u3001\u8D77\u70B9\u3078\u623B\u308A\u307E\u3059\u3002",
                        }),
                        _jsx(UI.Input, {
                          "aria-label": "\u30C0\u30A4\u30A2\u30ED\u30B0\u5185\u306E\u5165\u529B",
                        }),
                      ],
                    }),
                  ],
                }),
                _jsxs(UI.Popover, {
                  children: [
                    _jsx(UI.PopoverTrigger, {
                      asChild: true,
                      children: _jsx(UI.Button, { variant: "outline", children: "Popover" }),
                    }),
                    _jsxs(UI.PopoverContent, {
                      "aria-label": "\u88DC\u8DB3\u60C5\u5831",
                      children: [
                        _jsx(UI.Text, {
                          children:
                            "\u8D77\u70B9\u306B\u7D10\u3065\u3044\u305F\u88DC\u8DB3\u60C5\u5831\u3067\u3059\u3002",
                        }),
                        _jsx(UI.PopoverClose, {
                          asChild: true,
                          children: _jsx(UI.Button, {
                            variant: "ghost",
                            children: "\u9589\u3058\u308B",
                          }),
                        }),
                      ],
                    }),
                  ],
                }),
                _jsxs(UI.Tooltip, {
                  children: [
                    _jsx(UI.TooltipTrigger, {
                      asChild: true,
                      children: _jsx(UI.Button, { variant: "outline", children: "Tooltip" }),
                    }),
                    _jsx(UI.TooltipContent, {
                      children: "\u64CD\u4F5C\u306E\u88DC\u8DB3\u8AAC\u660E",
                    }),
                  ],
                }),
                _jsxs(UI.DropdownMenu, {
                  children: [
                    _jsx(UI.DropdownMenuTrigger, {
                      asChild: true,
                      children: _jsx(UI.Button, { variant: "outline", children: "Menu" }),
                    }),
                    _jsxs(UI.DropdownMenuContent, {
                      children: [
                        _jsx(UI.DropdownMenuItem, { children: "\u7DE8\u96C6" }),
                        _jsx(UI.DropdownMenuItem, {
                          disabled: true,
                          children: "\u5229\u7528\u4E0D\u53EF",
                        }),
                      ],
                    }),
                  ],
                }),
                _jsxs(UI.Sheet, {
                  children: [
                    _jsx(UI.SheetTrigger, {
                      asChild: true,
                      children: _jsx(UI.Button, { variant: "outline", children: "Sheet" }),
                    }),
                    _jsxs(UI.SheetContent, {
                      children: [
                        _jsx(UI.SheetTitle, {
                          children: "\u30CA\u30D3\u30B2\u30FC\u30B7\u30E7\u30F3",
                        }),
                        _jsx(UI.SheetDescription, {
                          children:
                            "\u753B\u9762\u7AEF\u304B\u3089\u8868\u793A\u3059\u308B\u88DC\u52A9\u30D1\u30CD\u30EB\u3002",
                        }),
                      ],
                    }),
                  ],
                }),
                _jsx(UI.Button, {
                  variant: "secondary",
                  onClick: () => UI.toast.success("保存しました"),
                  children: "Toast",
                }),
              ],
            }),
          ],
        }),
      }),
      _jsx(UI.Card, {
        children: _jsxs(UI.Stack, {
          children: [
            _jsx(UI.Heading, { children: "\u72B6\u614B\u3068\u69CB\u9020" }),
            ["info", "success", "warning", "danger"].map((tone) =>
              _jsx(
                UI.Alert,
                {
                  tone: tone,
                  title: `${tone} の状態`,
                  children:
                    "\u6B21\u306E\u64CD\u4F5C\u304C\u5206\u304B\u308B\u30E1\u30C3\u30BB\u30FC\u30B8\u3092\u8868\u793A\u3057\u307E\u3059\u3002",
                },
                tone,
              ),
            ),
            _jsxs(UI.Inline, {
              children: [
                _jsx(UI.Avatar, { alt: "\u30B5\u30F3\u30D7\u30EB", fallback: "GD" }),
                _jsx(UI.Badge, { children: "\u4E0B\u66F8\u304D" }),
                _jsx(UI.Badge, { tone: "success", children: "\u516C\u958B\u4E2D" }),
                _jsx(UI.Spinner, {}),
                _jsx(UI.Skeleton, { style: { width: 120 } }),
              ],
            }),
            _jsx(UI.Separator, {}),
            _jsxs(UI.Tabs, {
              defaultValue: "overview",
              children: [
                _jsxs(UI.TabsList, {
                  "aria-label": "\u8868\u793A\u5185\u5BB9",
                  children: [
                    _jsx(UI.TabsTrigger, { value: "overview", children: "\u6982\u8981" }),
                    _jsx(UI.TabsTrigger, { value: "details", children: "\u8A73\u7D30" }),
                  ],
                }),
                _jsx(UI.TabsContent, {
                  value: "overview",
                  children: "\u6982\u8981\u306E\u5185\u5BB9",
                }),
                _jsx(UI.TabsContent, {
                  value: "details",
                  children: "\u8A73\u7D30\u306E\u5185\u5BB9",
                }),
              ],
            }),
            _jsx(UI.Accordion, {
              type: "single",
              collapsible: true,
              children: _jsxs(UI.AccordionItem, {
                value: "one",
                children: [
                  _jsx(UI.AccordionTrigger, {
                    children:
                      "\u53C2\u52A0\u65B9\u6CD5\u3092\u6559\u3048\u3066\u304F\u3060\u3055\u3044",
                  }),
                  _jsx(UI.AccordionContent, {
                    children:
                      "\u30A4\u30D9\u30F3\u30C8\u30DA\u30FC\u30B8\u304B\u3089\u767B\u9332\u3067\u304D\u307E\u3059\u3002",
                  }),
                ],
              }),
            }),
            _jsxs(UI.Breadcrumb, {
              children: [
                _jsx("li", {
                  children: _jsx(UI.Link, { href: "#home", children: "\u30DB\u30FC\u30E0" }),
                }),
                _jsx("li", { "aria-current": "page", children: "\u30A4\u30D9\u30F3\u30C8" }),
              ],
            }),
            _jsx(UI.EmptyState, {
              title: "\u307E\u3060\u9805\u76EE\u304C\u3042\u308A\u307E\u305B\u3093",
              description:
                "\u6700\u521D\u306E\u9805\u76EE\u3092\u8FFD\u52A0\u3057\u307E\u3057\u3087\u3046\u3002",
              action: _jsx(UI.Button, { children: "\u8FFD\u52A0" }),
            }),
          ],
        }),
      }),
      _jsx(UI.Toaster, {}),
    ],
  });
}
const meta = { title: "Components/Catalog", component: Catalog };
export default meta;
export const All = {};
export function Foundations() {
  return _jsxs("div", {
    className: "gdg-catalog",
    children: [
      _jsx(UI.Heading, { level: 1, children: "Foundations" }),
      _jsx(UI.Text, {
        children:
          "\u30D6\u30E9\u30F3\u30C9\u8272\u306F\u56FA\u5B9A\u3057\u3001\u7528\u9014\u3054\u3068\u306E\u610F\u5473\u30C8\u30FC\u30AF\u30F3\u3092\u30C6\u30FC\u30DE\u3067\u5207\u308A\u66FF\u3048\u307E\u3059\u3002",
      }),
      _jsx("div", {
        className: "gdg-swatch-grid",
        children: ["blue", "red", "green", "yellow", "white", "white-2", "black", "black-2"].map(
          (color) =>
            _jsxs(
              UI.Card,
              {
                children: [
                  _jsx("div", {
                    className: "gdg-swatch",
                    style: { background: `var(--gdg-${color})` },
                  }),
                  _jsx(UI.Text, { children: color }),
                ],
              },
              color,
            ),
        ),
      }),
      _jsx(UI.Card, {
        children: _jsxs(UI.Stack, {
          children: [
            _jsx(UI.Heading, {
              level: 1,
              children: "\u30B3\u30DF\u30E5\u30CB\u30C6\u30A3\u306E\u6B21\u306E\u4E00\u6B69\u3092",
            }),
            _jsx(UI.Heading, {
              children: "\u5B66\u3073\u3001\u3064\u306A\u304C\u308A\u3001\u5171\u6709\u3059\u308B",
            }),
            _jsx(UI.Heading, { level: 3, children: "Google Developer Groups" }),
            _jsx(UI.Text, { children: "\u672C\u6587 16px / Google Sans + Noto Sans JP" }),
            _jsx(UI.Text, {
              size: "sm",
              children:
                "\u64CD\u4F5C 14px / \u660E\u78BA\u3067\u7C21\u6F54\u306A\u30E9\u30D9\u30EB",
            }),
            _jsx(UI.Text, {
              size: "xs",
              children: "\u88DC\u52A9 12px / \u72B6\u614B\u3068\u6642\u523B",
            }),
          ],
        }),
      }),
      _jsx(UI.Text, {
        children:
          "\u4F59\u767D: 4px\u5358\u4F4D / \u89D2\u4E38: 12\u30FB16\u30FB20\u30FB24px / \u64CD\u4F5C: 40px\u3001\u30BF\u30C3\u30C144px",
      }),
    ],
  });
}
