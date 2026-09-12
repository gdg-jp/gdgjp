import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from "../Button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "./Combobox";
const meta = {
  title: "Components/Combobox",
  component: Combobox,
  parameters: { layout: "centered" },
};
export default meta;
export const Searchable = {
  render: () =>
    _jsxs(Combobox, {
      defaultOpen: true,
      children: [
        _jsx(ComboboxTrigger, {
          asChild: true,
          children: _jsx(Button, {
            variant: "outline",
            children: "\u30C1\u30E3\u30D7\u30BF\u30FC\u3092\u9078\u629E",
          }),
        }),
        _jsxs(ComboboxContent, {
          "aria-label": "\u30C1\u30E3\u30D7\u30BF\u30FC\u5019\u88DC",
          children: [
            _jsx(ComboboxInput, { placeholder: "\u691C\u7D22" }),
            _jsxs(ComboboxList, {
              children: [
                _jsx(ComboboxItem, { value: "tokyo", children: "Tokyo" }),
                _jsx(ComboboxItem, { value: "osaka", keywords: ["関西"], children: "Osaka" }),
                _jsx(ComboboxItem, { value: "sapporo", children: "Sapporo" }),
                _jsx(ComboboxEmpty, {}),
              ],
            }),
          ],
        }),
      ],
    }),
};
