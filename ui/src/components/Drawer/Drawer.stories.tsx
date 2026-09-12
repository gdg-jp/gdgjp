import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../Button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "./Drawer";

const meta: Meta<typeof Drawer> = {
  title: "Components/Drawer",
  component: Drawer,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Drawer>;
export default meta;
type Story = StoryObj<typeof meta>;

export const BottomSheet: Story = {
  render: () => (
    <Drawer>
      <DrawerTrigger asChild>
        <Button variant="outline">詳細を開く</Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>参加方法</DrawerTitle>
          <DrawerDescription>イベントページから参加登録できます。</DrawerDescription>
        </DrawerHeader>
        <DrawerFooter>
          <DrawerClose asChild>
            <Button variant="outline">閉じる</Button>
          </DrawerClose>
          <Button>登録する</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  ),
};
