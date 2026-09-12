import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./Command";

const meta = {
  title: "Components/Command",
  component: Command,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Command>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Palette: Story = {
  render: () => (
    <Command style={{ width: 360 }}>
      <CommandInput placeholder="操作を検索" />
      <CommandList>
        <CommandEmpty />
        <CommandGroup heading="イベント">
          <CommandItem value="create">イベントを作成</CommandItem>
          <CommandItem value="settings">設定を開く</CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  ),
};
