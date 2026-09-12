import type { Meta, StoryObj } from "@storybook/react-vite";
import { Skeleton } from "./Skeleton";

const meta = {
  title: "Components/Skeleton",
  component: Skeleton,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Skeleton>;
export default meta;
type Story = StoryObj<typeof meta>;

export const CardPlaceholder: Story = {
  render: () => (
    <div className="gdg-card gdg-stack" aria-label="読み込み中">
      <Skeleton style={{ width: 180, height: 24 }} />
      <Skeleton style={{ width: 280, height: 16 }} />
      <Skeleton style={{ width: 120, height: 40 }} />
    </div>
  ),
};
