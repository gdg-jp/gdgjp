import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../Button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./Collapsible";

const meta: Meta<typeof Collapsible> = {
  title: "Components/Collapsible",
  component: Collapsible,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Collapsible>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Collapsible defaultOpen style={{ width: 320 }}>
      <CollapsibleTrigger asChild>
        <Button variant="outline">詳細を表示</Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p style={{ margin: "12px 0 0" }}>参加者にはイベントページから案内を送ります。</p>
      </CollapsibleContent>
    </Collapsible>
  ),
};
