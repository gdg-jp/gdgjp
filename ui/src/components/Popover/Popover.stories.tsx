import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../Button";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "./Popover";

const meta: Meta = {
  title: "Components/Popover",
  component: Popover,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Popover>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">補足情報</Button>
      </PopoverTrigger>
      <PopoverContent aria-label="イベントの補足情報">
        <div className="gdg-stack">
          <strong>開催形式</strong>
          <span>会場とオンラインの同時開催です。</span>
          <PopoverClose asChild>
            <Button variant="ghost">閉じる</Button>
          </PopoverClose>
        </div>
      </PopoverContent>
    </Popover>
  ),
};
