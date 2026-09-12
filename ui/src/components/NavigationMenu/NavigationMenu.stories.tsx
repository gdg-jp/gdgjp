import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "./NavigationMenu";

const meta = {
  title: "Components/NavigationMenu",
  component: NavigationMenu,
  parameters: { layout: "centered" },
} satisfies Meta<typeof NavigationMenu>;
export default meta;
type Story = StoryObj<typeof meta>;

export const MainNavigation: Story = {
  render: () => (
    <NavigationMenu>
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuTrigger>イベント</NavigationMenuTrigger>
          <NavigationMenuContent>
            <p style={{ margin: 0 }}>開催予定のイベントを探す</p>
          </NavigationMenuContent>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <NavigationMenuLink href="#about">GDGについて</NavigationMenuLink>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  ),
};
