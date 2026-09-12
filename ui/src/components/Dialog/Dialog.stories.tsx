import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../Button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "./Dialog";

const meta: Meta = {
  title: "Components/Dialog",
  component: Dialog,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Dialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button>イベントを編集</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>イベントを編集</DialogTitle>
        <DialogDescription>参加者に伝わる名前を設定してください。</DialogDescription>
        <input className="gdg-input" aria-label="イベント名" defaultValue="GDG Apps Meetup" />
        <div className="gdg-inline">
          <Button>保存</Button>
          <DialogClose asChild>
            <Button variant="outline">キャンセル</Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  ),
};
