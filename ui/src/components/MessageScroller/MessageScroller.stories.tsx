import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "./MessageScroller";

const meta = {
  title: "Components/MessageScroller",
  component: MessageScroller,
  parameters: { layout: "centered" },
} satisfies Meta<typeof MessageScroller>;
export default meta;
type Story = StoryObj<typeof meta>;

export const LatestMessages: Story = {
  render: () => (
    <MessageScrollerProvider initialPosition="end">
      <MessageScroller style={{ width: 400, height: 220, flex: "none" }}>
        <MessageScrollerViewport aria-label="メッセージ履歴">
          <MessageScrollerContent>
            {Array.from({ length: 8 }, (_, index) => (
              <MessageScrollerItem key={`message-${index + 1}`} messageId={`message-${index + 1}`}>
                {index + 1}. イベント運営チームからのお知らせです。
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  ),
};
