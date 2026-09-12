import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./Command";
const meta = {
  title: "Components/Command",
  component: Command,
  parameters: { layout: "centered" },
};
export default meta;
export const Palette = {
  render: () =>
    _jsxs(Command, {
      style: { width: 360 },
      children: [
        _jsx(CommandInput, { placeholder: "\u64CD\u4F5C\u3092\u691C\u7D22" }),
        _jsxs(CommandList, {
          children: [
            _jsx(CommandEmpty, {}),
            _jsxs(CommandGroup, {
              heading: "\u30A4\u30D9\u30F3\u30C8",
              children: [
                _jsx(CommandItem, {
                  value: "create",
                  children: "\u30A4\u30D9\u30F3\u30C8\u3092\u4F5C\u6210",
                }),
                _jsx(CommandItem, {
                  value: "settings",
                  children: "\u8A2D\u5B9A\u3092\u958B\u304F",
                }),
              ],
            }),
          ],
        }),
      ],
    }),
};
