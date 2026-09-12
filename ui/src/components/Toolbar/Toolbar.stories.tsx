import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../Button";
import { Heading } from "../Heading";
import { Toolbar } from "./Toolbar";

const meta = {
  title: "Components/Toolbar",
  component: Toolbar,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Toolbar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Toolbar style={{ width: 420 }}>
      <Heading level={2}>イベント一覧</Heading>
      <div className="gdg-inline">
        <Button variant="outline">絞り込み</Button>
        <Button>新規作成</Button>
      </div>
    </Toolbar>
  ),
};
