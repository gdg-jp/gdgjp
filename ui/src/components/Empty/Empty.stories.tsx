import type { Meta, StoryObj } from "@storybook/react-vite";
import { SearchX } from "lucide-react";
import { Button } from "../Button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./Empty";

const meta = {
  title: "Components/Empty",
  component: Empty,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Empty>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NoResults: Story = {
  render: () => (
    <Empty style={{ width: 420 }}>
      <EmptyHeader>
        <EmptyMedia>
          <SearchX size={22} aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>該当するイベントがありません</EmptyTitle>
        <EmptyDescription>
          検索条件を変更するか、新しいイベントを作成してください。
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button>イベントを作成</Button>
      </EmptyContent>
    </Empty>
  ),
};
