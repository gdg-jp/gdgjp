import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../Button";
import { Toaster, toast } from "./Toaster";

const meta = {
  title: "Components/Toaster",
  component: Toaster,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Toaster>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Notifications: Story = {
  render: () => (
    <>
      <div className="gdg-inline">
        <Button onClick={() => toast.success("変更を保存しました")}>成功</Button>
        <Button variant="outline" onClick={() => toast.error("保存できませんでした")}>
          エラー
        </Button>
      </div>
      <Toaster />
    </>
  ),
};
