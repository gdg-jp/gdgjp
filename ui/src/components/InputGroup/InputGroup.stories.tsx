import type { Meta, StoryObj } from "@storybook/react-vite";
import { Search as SearchIcon } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "./InputGroup";

const meta = {
  title: "Components/InputGroup",
  component: InputGroup,
  parameters: { layout: "centered" },
} satisfies Meta<typeof InputGroup>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Search: Story = {
  render: () => (
    <InputGroup style={{ width: 360 }}>
      <InputGroupAddon>
        <SearchIcon size={16} aria-hidden="true" />
        <InputGroupText>検索</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput aria-label="イベントを検索" placeholder="イベント名" />
      <InputGroupButton aria-label="検索を実行">実行</InputGroupButton>
    </InputGroup>
  ),
};
