import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../Button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./ContextMenu";

const meta: Meta<typeof ContextMenu> = {
  title: "Components/ContextMenu",
  component: ContextMenu,
  parameters: { layout: "centered" },
} satisfies Meta<typeof ContextMenu>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Actions: Story = {
  render: () => (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Button variant="outline">右クリックしてください</Button>
      </ContextMenuTrigger>
      <ContextMenuContent aria-label="操作メニュー">
        <ContextMenuItem>編集</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem>コピー</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  ),
};
