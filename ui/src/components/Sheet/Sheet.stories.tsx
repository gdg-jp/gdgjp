import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../Button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "./Sheet";

const meta: Meta = {
  title: "Components/Sheet",
  component: Sheet,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Sheet>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Right: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">設定を開く</Button>
      </SheetTrigger>
      <SheetContent side="right">
        <SheetTitle>表示設定</SheetTitle>
        <SheetDescription>表示に関する設定を変更します。</SheetDescription>
        <SheetClose asChild>
          <Button variant="outline">閉じる</Button>
        </SheetClose>
      </SheetContent>
    </Sheet>
  ),
};
