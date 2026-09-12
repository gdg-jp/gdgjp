import { Search as SearchIcon } from "lucide-react";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "./InputGroup";
const meta = {
  title: "Components/InputGroup",
  component: InputGroup,
  parameters: { layout: "centered" },
};
export default meta;
export const Search = {
  render: () =>
    _jsxs(InputGroup, {
      style: { width: 360 },
      children: [
        _jsxs(InputGroupAddon, {
          children: [
            _jsx(SearchIcon, { size: 16, "aria-hidden": "true" }),
            _jsx(InputGroupText, { children: "\u691C\u7D22" }),
          ],
        }),
        _jsx(InputGroupInput, {
          "aria-label": "\u30A4\u30D9\u30F3\u30C8\u3092\u691C\u7D22",
          placeholder: "\u30A4\u30D9\u30F3\u30C8\u540D",
        }),
        _jsx(InputGroupButton, {
          "aria-label": "\u691C\u7D22\u3092\u5B9F\u884C",
          children: "\u5B9F\u884C",
        }),
      ],
    }),
};
