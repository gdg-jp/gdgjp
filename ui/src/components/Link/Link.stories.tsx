import type { Meta, StoryObj } from "@storybook/react-vite";
import { Link } from "./Link";

const meta = {
  title: "Components/Link",
  component: Link,
  parameters: { layout: "centered" },
  args: { href: "#events", children: "イベント一覧" },
} satisfies Meta<typeof Link>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const AsChild: Story = {
  render: () => (
    <Link asChild>
      <a href="#composed">合成されたリンク</a>
    </Link>
  ),
};
