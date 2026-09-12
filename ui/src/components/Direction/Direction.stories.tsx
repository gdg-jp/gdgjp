import type { Meta, StoryObj } from "@storybook/react-vite";
import { DirectionProvider } from "./Direction";

const meta: Meta<typeof DirectionProvider> = {
  title: "Components/Direction",
  component: DirectionProvider,
  parameters: { layout: "centered" },
} satisfies Meta<typeof DirectionProvider>;
export default meta;
type Story = StoryObj<typeof meta>;

export const RightToLeft: Story = {
  args: {},
  render: () => (
    <DirectionProvider dir="rtl">
      <div
        className="gdg-story-surface"
        style={{ width: 260, padding: 16, borderRadius: 16, background: "var(--gdg-surface)" }}
      >
        方向を切り替えたレイアウト
      </div>
    </DirectionProvider>
  ),
};
