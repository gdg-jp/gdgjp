import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../Button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./AlertDialog";

const meta: Meta = {
  title: "Components/AlertDialog",
  component: AlertDialog,
  parameters: { layout: "centered" },
} satisfies Meta<typeof AlertDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Confirmation: Story = {
  render: () => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="danger">イベントを削除</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>イベントを削除しますか？</AlertDialogTitle>
        <AlertDialogDescription>
          この操作は取り消せません。削除する前に内容を確認してください。
        </AlertDialogDescription>
        <div className="gdg-inline">
          <AlertDialogCancel asChild>
            <Button variant="outline">キャンセル</Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button variant="danger">削除する</Button>
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  ),
};
