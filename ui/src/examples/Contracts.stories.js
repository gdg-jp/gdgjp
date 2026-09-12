import { useEffect, useRef, useState } from "react";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as UI from "../index.ts";
function ContractExamples() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectOpen, setSelectOpen] = useState(false);
  const [clicks, setClicks] = useState(0);
  const [submitted, setSubmitted] = useState("");
  const timer = useRef(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return _jsxs("main", {
    className: "gdg-catalog",
    children: [
      _jsx(UI.Heading, { level: 1, children: "\u64CD\u4F5C\u5951\u7D04" }),
      _jsx(UI.Text, {
        children:
          "\u9023\u7D9A\u64CD\u4F5C\u3001\u5FC5\u9808\u5165\u529B\u3001\u30EA\u30F3\u30AF\u5408\u6210\u3092\u78BA\u8A8D\u3059\u308B\u4F8B\u3067\u3059\u3002",
      }),
      _jsx(UI.Card, {
        children: _jsxs(UI.Stack, {
          children: [
            _jsx(UI.Button, {
              asChild: true,
              disabled: true,
              children: _jsx("a", {
                href: "#unexpected",
                onClick: () => setClicks((c) => c + 1),
                children: "\u7121\u52B9\u306A\u30EA\u30F3\u30AF",
              }),
            }),
            _jsx("output", {
              "aria-label": "\u30AF\u30EA\u30C3\u30AF\u56DE\u6570",
              children: clicks,
            }),
            _jsxs(UI.Dialog, {
              open: dialogOpen,
              onOpenChange: setDialogOpen,
              children: [
                _jsx(UI.DialogTrigger, {
                  asChild: true,
                  children: _jsx(UI.Button, { children: "\u9023\u7D9A\u958B\u9589Dialog" }),
                }),
                _jsxs(UI.DialogContent, {
                  children: [
                    _jsx(UI.DialogTitle, { children: "\u518D\u30AA\u30FC\u30D7\u30F3" }),
                    _jsx(UI.DialogDescription, {
                      children:
                        "\u9000\u51FA\u4E2D\u306E\u518D\u30AA\u30FC\u30D7\u30F3\u3092\u78BA\u8A8D\u3057\u307E\u3059\u3002",
                    }),
                    _jsx(UI.Button, {
                      onClick: () => {
                        setDialogOpen(false);
                        clearTimeout(timer.current);
                        timer.current = setTimeout(() => setDialogOpen(true), 60);
                      },
                      children: "\u9589\u3058\u3066\u3059\u3050\u958B\u304F",
                    }),
                  ],
                }),
              ],
            }),
            _jsx(UI.FormField, {
              label: "\u9023\u7D9A\u958B\u9589Select",
              children: _jsxs(UI.Select, {
                open: selectOpen,
                onOpenChange: setSelectOpen,
                onValueChange: () => {
                  clearTimeout(timer.current);
                  timer.current = setTimeout(() => setSelectOpen(true), 60);
                },
                children: [
                  _jsx(UI.SelectTrigger, {
                    children: _jsx(UI.SelectValue, {
                      placeholder: "\u5019\u88DC\u3092\u9078\u629E",
                    }),
                  }),
                  _jsxs(UI.SelectContent, {
                    children: [
                      _jsx(UI.SelectItem, { value: "one", children: "\u5019\u88DC1" }),
                      _jsx(UI.SelectItem, { value: "two", children: "\u5019\u88DC2" }),
                    ],
                  }),
                ],
              }),
            }),
            _jsx("form", {
              onSubmit: (event) => {
                event.preventDefault();
                setSubmitted(String(new FormData(event.currentTarget).get("chapter")));
              },
              children: _jsxs(UI.Stack, {
                children: [
                  _jsx(UI.FormField, {
                    label: "\u5FC5\u9808\u30C1\u30E3\u30D7\u30BF\u30FC",
                    required: true,
                    children: _jsxs(UI.Select, {
                      name: "chapter",
                      children: [
                        _jsx(UI.SelectTrigger, {
                          children: _jsx(UI.SelectValue, {
                            placeholder: "\u30C1\u30E3\u30D7\u30BF\u30FC\u3092\u9078\u629E",
                          }),
                        }),
                        _jsxs(UI.SelectContent, {
                          children: [
                            _jsx(UI.SelectItem, { value: "tokyo", children: "Tokyo" }),
                            _jsx(UI.SelectItem, { value: "kyoto", children: "Kyoto" }),
                          ],
                        }),
                      ],
                    }),
                  }),
                  _jsx(UI.Button, { type: "submit", children: "\u9001\u4FE1" }),
                  _jsx("output", { "aria-label": "\u9001\u4FE1\u5024", children: submitted }),
                ],
              }),
            }),
            _jsx(UI.FormField, {
              label: "\u53C2\u52A0\u5834\u6240",
              children: _jsx(UI.RadioGroup, {
                defaultValue: "a",
                children: _jsxs(UI.Inline, {
                  children: [
                    _jsx(UI.RadioGroupItem, { id: "location-a", value: "a" }),
                    _jsx("label", { htmlFor: "location-a", children: "\u4F1A\u5834A" }),
                    _jsx(UI.RadioGroupItem, { id: "location-b", value: "b" }),
                    _jsx("label", { htmlFor: "location-b", children: "\u4F1A\u5834B" }),
                  ],
                }),
              }),
            }),
            _jsx(UI.Button, {
              onClick: () => UI.toast("トークンで描画する通知"),
              children: "\u901A\u77E5\u3092\u8868\u793A",
            }),
            _jsx(UI.Toaster, {}),
          ],
        }),
      }),
    ],
  });
}
const meta = { title: "Components/Contracts", component: ContractExamples };
export default meta;
export const Examples = {};
