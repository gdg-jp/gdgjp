import type { Meta, StoryObj } from "@storybook/react-vite";
import { Bubble, BubbleContent, BubbleGroup, BubbleReactions } from "./Bubble";

const meta = {
  title: "Components/Bubble",
  component: Bubble,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Bubble>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Conversation: Story = {
  render: () => (
    <BubbleGroup style={{ width: 360 }}>
      <Bubble>
        <BubbleContent>次回のGDGイベントについて確認しました。</BubbleContent>
        <BubbleReactions aria-label="リアクション">👍 3</BubbleReactions>
      </Bubble>
      <Bubble align="end" variant="tinted">
        <BubbleContent>ありがとうございます。公開準備を進めます。</BubbleContent>
      </Bubble>
    </BubbleGroup>
  ),
};
