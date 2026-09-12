import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../Button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./HoverCard";

const meta: Meta<typeof HoverCard> = {
  title: "Components/HoverCard",
  component: HoverCard,
  parameters: { layout: "centered" },
} satisfies Meta<typeof HoverCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Profile: Story = {
  render: () => (
    <HoverCard open>
      <HoverCardTrigger asChild>
        <Button variant="ghost">@gdgjp</Button>
      </HoverCardTrigger>
      <HoverCardContent>
        <strong>GDG Japan</strong>
        <p className="gdg-muted">開発者コミュニティのイベント情報を発信しています。</p>
      </HoverCardContent>
    </HoverCard>
  ),
};
