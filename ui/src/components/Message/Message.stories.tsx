import type { Meta, StoryObj } from "@storybook/react-vite";
import { Avatar } from "../Avatar";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageGroup,
  MessageHeader,
} from "./Message";

const meta = {
  title: "Components/Message",
  component: Message,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Message>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Conversation: Story = {
  render: () => (
    <MessageGroup style={{ width: 420 }}>
      <Message>
        <MessageAvatar>
          <Avatar alt="GDG" fallback="GD" />
        </MessageAvatar>
        <MessageContent>
          <MessageHeader>GDG Japan · 14:20</MessageHeader>
          <div className="gdg-bubble-content">資料を共有しました。</div>
          <MessageFooter>既読</MessageFooter>
        </MessageContent>
      </Message>
      <Message align="end">
        <MessageContent>
          <MessageHeader>あなた · 14:22</MessageHeader>
          <div className="gdg-bubble-content">確認します。</div>
        </MessageContent>
      </Message>
    </MessageGroup>
  ),
};
