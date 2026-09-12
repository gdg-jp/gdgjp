import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../Button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "./Combobox";

const meta = {
  title: "Components/Combobox",
  component: Combobox,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Combobox>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Searchable: Story = {
  render: () => (
    <Combobox defaultOpen>
      <ComboboxTrigger asChild>
        <Button variant="outline">チャプターを選択</Button>
      </ComboboxTrigger>
      <ComboboxContent aria-label="チャプター候補">
        <ComboboxInput placeholder="検索" />
        <ComboboxList>
          <ComboboxItem value="tokyo">Tokyo</ComboboxItem>
          <ComboboxItem value="osaka" keywords={["関西"]}>
            Osaka
          </ComboboxItem>
          <ComboboxItem value="sapporo">Sapporo</ComboboxItem>
          <ComboboxEmpty />
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  ),
};
