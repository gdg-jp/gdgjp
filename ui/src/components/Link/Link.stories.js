import { jsx as _jsx } from "react/jsx-runtime";
import { Link } from "./Link";
const meta = {
  title: "Components/Link",
  component: Link,
  parameters: { layout: "centered" },
  args: { href: "#events", children: "イベント一覧" },
};
export default meta;
export const Default = {};
export const AsChild = {
  render: () =>
    _jsx(Link, {
      asChild: true,
      children: _jsx("a", {
        href: "#composed",
        children: "\u5408\u6210\u3055\u308C\u305F\u30EA\u30F3\u30AF",
      }),
    }),
};
