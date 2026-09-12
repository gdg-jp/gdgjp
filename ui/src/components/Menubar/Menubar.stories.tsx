import type { Meta, StoryObj } from "@storybook/react-vite";
import { Menubar, MenubarContent, MenubarItem, MenubarMenu, MenubarTrigger } from "./Menubar";

const meta = {
  title: "Components/Menubar",
  component: Menubar,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Menubar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Menu: Story = {
  render: () => (
    <Menubar>
      <MenubarMenu>
        <MenubarTrigger>ファイル</MenubarTrigger>
        <MenubarContent>
          <MenubarItem>新規作成</MenubarItem>
          <MenubarItem>開く</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>ヘルプ</MenubarTrigger>
        <MenubarContent>
          <MenubarItem>使い方</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  ),
};
