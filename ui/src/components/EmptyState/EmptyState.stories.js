import { jsx as _jsx } from "react/jsx-runtime";
import { Button } from "../Button";
import { EmptyState } from "./EmptyState";
const meta = {
  title: "Components/EmptyState",
  component: EmptyState,
  parameters: { layout: "centered" },
};
export default meta;
export const WithAction = {
  render: () =>
    _jsx(EmptyState, {
      title: "\u307E\u3060\u30A4\u30D9\u30F3\u30C8\u304C\u3042\u308A\u307E\u305B\u3093",
      description:
        "\u6700\u521D\u306E\u30A4\u30D9\u30F3\u30C8\u3092\u4F5C\u6210\u3057\u3066\u3001\u30B3\u30DF\u30E5\u30CB\u30C6\u30A3\u306B\u5171\u6709\u3057\u307E\u3057\u3087\u3046\u3002",
      action: _jsx(Button, { children: "\u30A4\u30D9\u30F3\u30C8\u3092\u4F5C\u6210" }),
    }),
};
export const WithoutDescription = { args: { title: "結果がありません" } };
