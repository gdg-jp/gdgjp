import type { Meta, StoryObj } from "@storybook/react-vite";
import { Link } from "../Link";
import { Breadcrumb } from "./Breadcrumb";

const meta = {
  title: "Components/Breadcrumb",
  component: Breadcrumb,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Breadcrumb>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Breadcrumb>
      <li>
        <Link href="#home">ホーム</Link>
      </li>
      <li>
        <Link href="#events">イベント</Link>
      </li>
      <li aria-current="page">GDG Apps の紹介</li>
    </Breadcrumb>
  ),
};
