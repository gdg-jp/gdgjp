import type { Meta, StoryObj } from "@storybook/react-vite";
import { ThemeProvider, ThemeToggle } from "./theme";

const meta = {
  title: "Theme/ThemeProvider",
  component: ThemeProvider,
  parameters: { layout: "centered" },
} satisfies Meta<typeof ThemeProvider>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Toggle: Story = {
  render: () => (
    <ThemeProvider>
      <div className="gdg-stack">
        <ThemeToggle />
        <p className="gdg-text">テーマを切り替えると、この文書の色が変わります。</p>
      </div>
    </ThemeProvider>
  ),
};
