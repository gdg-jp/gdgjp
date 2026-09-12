import type { Meta, StoryObj } from "@storybook/react-vite";
import { CalendarDays } from "lucide-react";
import { Button } from "../Button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "./Item";

const meta = {
  title: "Components/Item",
  component: Item,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Item>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Event: Story = {
  render: () => (
    <Item variant="outline" style={{ width: 420 }}>
      <ItemMedia>
        <CalendarDays size={20} aria-hidden="true" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>DevFest Kansai</ItemTitle>
        <ItemDescription>2026年10月17日 · 大阪</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button size="sm" variant="ghost">
          詳細
        </Button>
      </ItemActions>
    </Item>
  ),
};
