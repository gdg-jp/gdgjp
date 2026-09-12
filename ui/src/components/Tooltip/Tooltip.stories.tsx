import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../Button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./Tooltip";

const meta: Meta = {
  title: "Components/Tooltip",
  component: Tooltip,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Tooltip>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline">カーソルを合わせる</Button>
      </TooltipTrigger>
      <TooltipContent>短い補足説明を表示します。</TooltipContent>
    </Tooltip>
  ),
};
