import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScrollArea } from "./ScrollArea";

const meta = {
  title: "Components/ScrollArea",
  component: ScrollArea,
  parameters: { layout: "centered" },
} satisfies Meta<typeof ScrollArea>;
export default meta;
type Story = StoryObj<typeof meta>;

export const LongList: Story = {
  render: () => (
    <ScrollArea style={{ width: 320, height: 180 }}>
      <div style={{ display: "grid", gap: 12, padding: 16 }}>
        {[
          "オープニング",
          "基調講演",
          "Webパフォーマンス",
          "生成AIの活用",
          "コミュニティ運営",
          "クロージング",
        ].map((session) => (
          <div key={session}>{session}</div>
        ))}
      </div>
    </ScrollArea>
  ),
};
