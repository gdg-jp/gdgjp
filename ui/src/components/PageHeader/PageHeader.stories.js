import { jsx as _jsx } from "react/jsx-runtime";
import { Button } from "../Button";
import { PageHeader } from "./PageHeader";
const meta = {
  title: "Components/PageHeader",
  component: PageHeader,
  parameters: { layout: "centered" },
};
export default meta;
export const Default = {
  render: () =>
    _jsx(PageHeader, {
      title: "\u30A4\u30D9\u30F3\u30C8",
      description:
        "\u30B3\u30DF\u30E5\u30CB\u30C6\u30A3\u306E\u6B21\u306E\u4E00\u6B69\u3092\u3001\u3053\u3053\u304B\u3089\u3002",
      actions: _jsx(Button, { children: "\u30A4\u30D9\u30F3\u30C8\u3092\u4F5C\u6210" }),
    }),
};
