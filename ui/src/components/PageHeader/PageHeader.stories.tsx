import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../Button";
import { PageHeader } from "./PageHeader";

const meta = {
  title: "Components/PageHeader",
  component: PageHeader,
  parameters: { layout: "centered" },
} satisfies Meta<typeof PageHeader>;
export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <PageHeader
      title="イベント"
      description="コミュニティの次の一歩を、ここから。"
      actions={<Button>イベントを作成</Button>}
    />
  ),
};
